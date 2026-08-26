//! Desktop audio playback that never touches the webview.
//!
//! WebKitGTK plays an `<audio>` element through GStreamer. Arch's `webkit2gtk-4.1` does
//! not depend on `gst-plugins-good`, so on a stock box there is no HTTP source, no MP3
//! parser and no audio sink at all — and instead of failing the element, WebKit hits its
//! own `RELEASE_ASSERT` and aborts the whole web process. The window goes white the
//! moment you press Listen. See `docs/DESKTOP.md`.
//!
//! So on desktop the app decodes and plays audio here in Rust: rodio on top of cpal,
//! which talks to ALSA / CoreAudio / WASAPI directly. GStreamer is out of the picture,
//! and the webview only ever sees numbers coming back from `desktop_audio_state`.
//!
//! Mobile is untouched — this module is `#[cfg(desktop)]`, and rodio/cpal are pulled in
//! only for non-Android/iOS targets (see `Cargo.toml`), so the mobile dependency graph
//! is exactly what it was.

use std::io::Cursor;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError, Sender};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;

use rodio::{Decoder, DeviceSinkBuilder, MixerDeviceSink, Player, Source};
use serde::Serialize;
use tauri::State;

/// How often the audio thread refreshes the position/ended snapshot. The webview polls
/// `desktop_audio_state` roughly every 250 ms, so this only has to be finer than that.
const TICK: Duration = Duration::from_millis(50);

/* --------------------------------- messages --------------------------------- */

enum Cmd {
    /// Decode `bytes` and queue them, paused, seeked to `start_sec`.
    Load {
        bytes: Vec<u8>,
        start_sec: f64,
        generation: u64,
    },
    Play,
    Pause,
    Seek(f64),
    Stop,
}

/// Everything `desktop_audio_state` reports. Written by the audio thread, read by the
/// command thread — plain atomics, no lock on the polling path.
#[derive(Default)]
struct Shared {
    position_ms: AtomicU64,
    duration_ms: AtomicU64,
    playing: AtomicBool,
    loading: AtomicBool,
    ended: AtomicBool,
    /// Bumped on every `load`. A fetch that finishes after a newer load started is dropped.
    generation: AtomicU64,
    error: Mutex<Option<String>>,
}

impl Shared {
    fn set_error(&self, message: impl Into<String>) {
        *self.error.lock().unwrap() = Some(message.into());
        self.loading.store(false, Ordering::Relaxed);
        self.playing.store(false, Ordering::Relaxed);
    }
}

/// Managed state. The rodio device sink owns a cpal stream that is not `Send` on every
/// backend, so it lives its whole life on one dedicated thread and is driven by messages.
#[derive(Default)]
pub struct DesktopAudio {
    shared: Arc<Shared>,
    tx: Mutex<Option<Sender<Cmd>>>,
}

impl DesktopAudio {
    /// Send a command, starting the audio thread on first use so a session that never
    /// plays anything never opens the sound device.
    fn send(&self, cmd: Cmd) {
        let mut guard = self.tx.lock().unwrap();
        if guard.is_none() {
            let (tx, rx) = mpsc::channel();
            let shared = self.shared.clone();
            match std::thread::Builder::new()
                .name("bol-audio".into())
                .spawn(move || audio_thread(rx, shared))
            {
                Ok(_) => *guard = Some(tx),
                // The build has panic = "abort", so an unwrap here would take the whole
                // app down over a track that will not play. Report it and stay up.
                Err(e) => {
                    self.shared.set_error(format!("cannot start the audio thread: {e}"));
                    return;
                }
            }
        }
        if let Some(tx) = guard.as_ref() {
            let _ = tx.send(cmd);
        }
    }
}

/* -------------------------------- audio thread ------------------------------- */

fn audio_thread(rx: Receiver<Cmd>, shared: Arc<Shared>) {
    let mut sink: Option<MixerDeviceSink> = None;
    let mut player: Option<Player> = None;
    // True while a track is queued and has not finished. Distinguishes "the source ran
    // out" (report `ended`, so the controller advances the queue) from "we stopped it".
    let mut active = false;

    loop {
        match rx.recv_timeout(TICK) {
            Ok(Cmd::Load {
                bytes,
                start_sec,
                generation,
            }) => {
                if generation != shared.generation.load(Ordering::SeqCst) {
                    continue; // superseded while the bytes were in flight
                }
                active = false;
                shared.playing.store(false, Ordering::Relaxed);
                match load_track(&mut sink, &mut player, bytes, start_sec) {
                    Ok(duration_ms) => {
                        shared.duration_ms.store(duration_ms, Ordering::Relaxed);
                        shared
                            .position_ms
                            .store(secs_to_ms(start_sec), Ordering::Relaxed);
                        shared.ended.store(false, Ordering::Relaxed);
                        shared.loading.store(false, Ordering::Relaxed);
                        *shared.error.lock().unwrap() = None;
                        active = true;
                    }
                    Err(e) => shared.set_error(e),
                }
            }
            Ok(Cmd::Play) => {
                if let Some(p) = &player {
                    p.play();
                }
            }
            Ok(Cmd::Pause) => {
                if let Some(p) = &player {
                    p.pause();
                }
                shared.playing.store(false, Ordering::Relaxed);
            }
            Ok(Cmd::Seek(seconds)) => {
                if let Some(p) = &player {
                    let target = Duration::from_secs_f64(seconds.max(0.0));
                    if p.try_seek(target).is_ok() {
                        shared
                            .position_ms
                            .store(secs_to_ms(seconds), Ordering::Relaxed);
                    }
                }
            }
            Ok(Cmd::Stop) => {
                active = false;
                if let Some(p) = player.take() {
                    p.stop();
                }
                shared.playing.store(false, Ordering::Relaxed);
                shared.position_ms.store(0, Ordering::Relaxed);
                shared.duration_ms.store(0, Ordering::Relaxed);
            }
            Err(RecvTimeoutError::Timeout) => {}
            Err(RecvTimeoutError::Disconnected) => return,
        }

        if let Some(p) = &player {
            shared
                .position_ms
                .store(p.get_pos().as_millis() as u64, Ordering::Relaxed);
            if active {
                if p.empty() {
                    // The decoder ran out: the track finished on its own.
                    active = false;
                    shared.playing.store(false, Ordering::Relaxed);
                    shared.ended.store(true, Ordering::Relaxed);
                } else {
                    shared.playing.store(!p.is_paused(), Ordering::Relaxed);
                }
            }
        }
    }
}

/// Open the sound device (once), then queue `bytes` on a fresh player, paused. Returns
/// the track duration in milliseconds, or 0 when the container does not declare one.
fn load_track(
    sink: &mut Option<MixerDeviceSink>,
    player: &mut Option<Player>,
    bytes: Vec<u8>,
    start_sec: f64,
) -> Result<u64, String> {
    if sink.is_none() {
        let mut opened = DeviceSinkBuilder::open_default_sink()
            .map_err(|e| format!("no audio output device: {e}"))?;
        // Rodio otherwise prints a "dropped without stopping" notice on shutdown.
        opened.log_on_drop(false);
        *sink = Some(opened);
    }
    let mixer = sink.as_ref().expect("sink opened above").mixer();

    // A new Player per track is the cheapest way to guarantee an empty queue; dropping
    // the old one stops it and detaches it from the mixer.
    if let Some(previous) = player.take() {
        previous.stop();
    }
    let fresh = Player::connect_new(mixer);
    fresh.pause(); // the webview asks for play() separately, so never blurt out audio here

    let scanned_ms = scan_mp3_duration(&bytes);
    let decoder = Decoder::new(Cursor::new(bytes)).map_err(|e| format!("cannot decode: {e}"))?;
    let duration_ms = decoder
        .total_duration()
        .map(|d| d.as_millis() as u64)
        .or(scanned_ms)
        .unwrap_or(0);
    fresh.append(decoder);

    if start_sec > 0.0 {
        // Missler chapters start mid-file; the "#t=" hint arrives as start_sec.
        let _ = fresh.try_seek(Duration::from_secs_f64(start_sec));
    }
    *player = Some(fresh);
    Ok(duration_ms)
}

/* -------------------------------- mp3 duration ------------------------------- */

/// Best-effort MP3 length in milliseconds, by walking the frame headers.
///
/// Symphonia only reports a duration when the file carries a Xing/Info/VBRI header, and
/// the narration MP3s do not — so without this the scrubber has nothing to scrub and the
/// Media Session position never makes sense. Summing frame durations is exact for CBR and
/// VBR alike and costs a few milliseconds even on a twenty-minute file. `None` when the
/// bytes are not layer-III MPEG audio at all, in which case the caller has a real answer
/// from the container anyway.
fn scan_mp3_duration(bytes: &[u8]) -> Option<u64> {
    let mut at = skip_id3(bytes);
    let mut seconds = 0.0_f64;
    let mut frames = 0_u32;

    while at + 4 <= bytes.len() {
        match Mp3Frame::parse(&bytes[at..]) {
            Some(frame) => {
                seconds += f64::from(frame.samples) / f64::from(frame.sample_rate);
                frames += 1;
                at += frame.length;
            }
            // Not a frame here — a tag, or junk between frames. Hunt for the next sync.
            None => at += 1,
        }
    }
    (frames > 0).then(|| (seconds * 1000.0) as u64)
}

struct Mp3Frame {
    length: usize,
    samples: u32,
    sample_rate: u32,
}

impl Mp3Frame {
    fn parse(header: &[u8]) -> Option<Self> {
        if header.len() < 4 || header[0] != 0xFF || header[1] & 0xE0 != 0xE0 {
            return None;
        }
        let version = (header[1] >> 3) & 0b11; // 0 = MPEG 2.5, 1 = reserved, 2 = MPEG 2, 3 = MPEG 1
        let layer = (header[1] >> 1) & 0b11; // 1 = layer III
        if version == 1 || layer != 0b01 {
            return None;
        }
        let bitrate_index = (header[2] >> 4) as usize;
        let rate_index = ((header[2] >> 2) & 0b11) as usize;
        let padding = usize::from((header[2] >> 1) & 1);
        if bitrate_index == 0 || bitrate_index == 15 || rate_index == 3 {
            return None; // "free" and "bad" bitrates, and the reserved sample rate
        }

        // Layer III bitrates, in kbit/s, indexed by the header's bitrate field.
        const MPEG1_KBPS: [u32; 15] = [
            0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320,
        ];
        const MPEG2_KBPS: [u32; 15] = [
            0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160,
        ];
        const SAMPLE_RATES: [[u32; 3]; 4] = [
            [11025, 12000, 8000], // MPEG 2.5
            [0, 0, 0],            // reserved
            [22050, 24000, 16000], // MPEG 2
            [44100, 48000, 32000], // MPEG 1
        ];

        let mpeg1 = version == 3;
        let sample_rate = SAMPLE_RATES[version as usize][rate_index];
        if sample_rate == 0 {
            return None;
        }
        let bitrate = if mpeg1 {
            MPEG1_KBPS[bitrate_index]
        } else {
            MPEG2_KBPS[bitrate_index]
        } * 1000;
        // Layer III packs 1152 samples per frame on MPEG 1, 576 on the half-rate versions.
        let (samples, coefficient) = if mpeg1 { (1152, 144) } else { (576, 72) };
        let length = (coefficient * bitrate / sample_rate) as usize + padding;
        if length < 4 {
            return None;
        }
        Some(Self {
            length,
            samples,
            sample_rate,
        })
    }
}

/// Byte offset of the first audio frame, past any ID3v2 tag at the head of the file.
fn skip_id3(bytes: &[u8]) -> usize {
    if bytes.len() < 10 || &bytes[..3] != b"ID3" {
        return 0;
    }
    // A syncsafe 32-bit size: seven bits per byte.
    let size = ((bytes[6] as usize & 0x7F) << 21)
        | ((bytes[7] as usize & 0x7F) << 14)
        | ((bytes[8] as usize & 0x7F) << 7)
        | (bytes[9] as usize & 0x7F);
    let footer = if bytes[5] & 0x10 != 0 { 10 } else { 0 };
    (10 + size + footer).min(bytes.len())
}

fn secs_to_ms(seconds: f64) -> u64 {
    if seconds.is_finite() && seconds > 0.0 {
        (seconds * 1000.0) as u64
    } else {
        0
    }
}

/* ---------------------------------- sources ---------------------------------- */

enum Origin {
    Remote(String),
    Local(PathBuf),
}

/// Work out what a track URL actually points at.
///
/// Narration URLs are plain `https://`. Local Missler files reach us as the asset URLs
/// `convertFileSrc()` produces — `asset://localhost/<percent-encoded path>` everywhere
/// except Windows, which uses `http://asset.localhost/<…>`. Either way the whole path is
/// percent-encoded, slashes included, so it has to be decoded before it is a path again.
fn resolve(raw: &str) -> Result<Origin, String> {
    let url = strip_media_fragment(raw);

    for prefix in [
        "asset://localhost/",
        "http://asset.localhost/",
        "https://asset.localhost/",
    ] {
        if let Some(rest) = url.strip_prefix(prefix) {
            return Ok(Origin::Local(decode_path(rest)));
        }
    }
    if let Some(rest) = url.strip_prefix("file://") {
        // file:///abs/path — the host is empty, so the leading slash of the path remains.
        return Ok(Origin::Local(decode_path(rest.trim_start_matches("localhost"))));
    }
    if url.starts_with("http://") || url.starts_with("https://") {
        return Ok(Origin::Remote(url.to_string()));
    }
    if url.starts_with('/') {
        return Ok(Origin::Local(PathBuf::from(url)));
    }
    Err(format!("unsupported audio URL: {url}"))
}

/// Drop a trailing `#t=<seconds>` start hint. The webview splits this off before calling
/// us, but a URL that arrives with one must still resolve.
fn strip_media_fragment(url: &str) -> &str {
    match url.find("#t=") {
        Some(at) => &url[..at],
        None => url,
    }
}

fn decode_path(encoded: &str) -> PathBuf {
    PathBuf::from(
        percent_encoding::percent_decode_str(encoded)
            .decode_utf8_lossy()
            .into_owned(),
    )
}

/// One shared HTTP client, built on the reqwest that `tauri-plugin-http` already vendors
/// so there is no second HTTP stack in the binary.
///
/// It has to name itself: reqwest sends no User-Agent by default, and the BSB narration
/// CDN answers 403 to a request without one. The webview never hit this because WebKit
/// sends a browser User-Agent of its own.
fn http() -> &'static tauri_plugin_http::reqwest::Client {
    static CLIENT: OnceLock<tauri_plugin_http::reqwest::Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        tauri_plugin_http::reqwest::Client::builder()
            .user_agent(concat!("bread-of-life/", env!("CARGO_PKG_VERSION")))
            .build()
            .unwrap_or_else(|_| tauri_plugin_http::reqwest::Client::new())
    })
}

async fn read_bytes(url: &str) -> Result<Vec<u8>, String> {
    match resolve(url)? {
        Origin::Local(path) => {
            std::fs::read(&path).map_err(|e| format!("cannot read {}: {e}", path.display()))
        }
        Origin::Remote(url) => {
            let response = http()
                .get(&url)
                .send()
                .await
                .map_err(|e| format!("cannot fetch audio: {e}"))?;
            if !response.status().is_success() {
                return Err(format!("audio request failed: HTTP {}", response.status()));
            }
            response
                .bytes()
                .await
                .map(|b| b.to_vec())
                .map_err(|e| format!("cannot read audio: {e}"))
        }
    }
}

/* ---------------------------------- commands --------------------------------- */

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopAudioState {
    /// Seconds.
    pub position: f64,
    /// Seconds; 0 when the file does not declare a duration.
    pub duration: f64,
    pub playing: bool,
    pub loading: bool,
    /// True once the current track has run to its end (cleared by the next `load`).
    pub ended: bool,
    pub error: Option<String>,
    /// Bumped by every `load`. The webview pairs it with `ended`/`error` so a poll that
    /// crosses a load cannot report the previous track's ending twice.
    pub generation: u64,
}

/// Fetch or read a track, decode it, and queue it paused at `start_sec`.
#[tauri::command]
pub async fn desktop_audio_load(
    state: State<'_, DesktopAudio>,
    url: String,
    start_sec: Option<f64>,
) -> Result<(), String> {
    let start_sec = start_sec.unwrap_or(0.0).max(0.0);
    let shared = state.shared.clone();

    let generation = shared.generation.fetch_add(1, Ordering::SeqCst) + 1;
    shared.loading.store(true, Ordering::Relaxed);
    shared.ended.store(false, Ordering::Relaxed);
    shared.playing.store(false, Ordering::Relaxed);
    shared.duration_ms.store(0, Ordering::Relaxed);
    shared
        .position_ms
        .store(secs_to_ms(start_sec), Ordering::Relaxed);
    *shared.error.lock().unwrap() = None;

    let bytes = match read_bytes(&url).await {
        Ok(bytes) => bytes,
        Err(e) => {
            if shared.generation.load(Ordering::SeqCst) == generation {
                shared.set_error(e.clone());
            }
            return Err(e);
        }
    };
    if shared.generation.load(Ordering::SeqCst) != generation {
        return Ok(()); // a newer load won the race
    }
    state.send(Cmd::Load {
        bytes,
        start_sec,
        generation,
    });
    Ok(())
}

#[tauri::command]
pub fn desktop_audio_play(state: State<'_, DesktopAudio>) {
    state.send(Cmd::Play);
}

#[tauri::command]
pub fn desktop_audio_pause(state: State<'_, DesktopAudio>) {
    state.send(Cmd::Pause);
}

#[tauri::command]
pub fn desktop_audio_seek(state: State<'_, DesktopAudio>, position: f64) {
    state.send(Cmd::Seek(position));
}

/// Release the device and forget the track. The next `load` reopens everything.
#[tauri::command]
pub fn desktop_audio_stop(state: State<'_, DesktopAudio>) {
    state.send(Cmd::Stop);
}

#[tauri::command]
pub fn desktop_audio_state(state: State<'_, DesktopAudio>) -> DesktopAudioState {
    let shared = &state.shared;
    DesktopAudioState {
        position: shared.position_ms.load(Ordering::Relaxed) as f64 / 1000.0,
        duration: shared.duration_ms.load(Ordering::Relaxed) as f64 / 1000.0,
        playing: shared.playing.load(Ordering::Relaxed),
        loading: shared.loading.load(Ordering::Relaxed),
        ended: shared.ended.load(Ordering::Relaxed),
        error: shared.error.lock().unwrap().clone(),
        generation: shared.generation.load(Ordering::SeqCst),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolves_asset_urls_back_to_paths() {
        let url = "asset://localhost/%2Fhome%2Fmatt%2FMissler%20Library%2F01.mp3";
        match resolve(url).unwrap() {
            Origin::Local(p) => assert_eq!(p, PathBuf::from("/home/matt/Missler Library/01.mp3")),
            _ => panic!("expected a local path"),
        }
    }

    #[test]
    fn drops_the_media_fragment_start_hint() {
        let url = "asset://localhost/%2Ftmp%2Fa.mp3#t=137";
        match resolve(url).unwrap() {
            Origin::Local(p) => assert_eq!(p, PathBuf::from("/tmp/a.mp3")),
            _ => panic!("expected a local path"),
        }
    }

    /// Four seconds of silent 128 kbit/s stereo MPEG-1 layer III behind an ID3v2 tag —
    /// enough to prove the frame walk lands on frame boundaries rather than resyncing.
    fn synthetic_mp3(frames: usize) -> Vec<u8> {
        let mut out = vec![b'I', b'D', b'3', 4, 0, 0, 0, 0, 0, 8];
        out.extend_from_slice(&[0; 8]); // the eight-byte tag body the header declares
        for _ in 0..frames {
            let mut frame = vec![0xFF, 0xFB, 0x90, 0x00]; // MPEG1 layer III, 128 kbps, 44.1 kHz
            frame.resize(417, 0); // 144 * 128000 / 44100 = 417 bytes, no padding
            out.extend_from_slice(&frame);
        }
        out
    }

    #[test]
    fn scans_a_duration_out_of_frame_headers() {
        // 1152 samples per frame at 44.1 kHz — 100 frames is a shade over 2.6 seconds.
        let ms = scan_mp3_duration(&synthetic_mp3(100)).expect("a duration");
        assert!((2600..=2650).contains(&ms), "got {ms}ms");
    }

    #[test]
    fn scans_nothing_out_of_non_mpeg_bytes() {
        assert_eq!(scan_mp3_duration(b"RIFF....WAVEfmt not audio at all"), None);
    }

    #[test]
    fn keeps_remote_urls_remote() {
        match resolve("https://example.test/JHN/1/audio/david.mp3#t=0").unwrap() {
            Origin::Remote(u) => assert_eq!(u, "https://example.test/JHN/1/audio/david.mp3"),
            _ => panic!("expected a remote URL"),
        }
    }
}
