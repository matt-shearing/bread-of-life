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
//!
//! How it behaves:
//! - `desktop_audio_load` returns at once and fetches in the background. A newer load
//!   abandons an older fetch part-way, so skipping five chapters does not download four.
//!   A play asked for while the track loads is remembered and applied when it is ready.
//! - The sound device is opened for a track and closed when playback stops, fails or runs
//!   to its end, so a laptop's audio can suspend, and a device that went away (a USB DAC
//!   unplugged) is found afresh with the next track. While paused it stays open.
//! - The audio thread sleeps until the next command unless something is playing.
//! - Media keys and the desktop's media widget: see `media_keys.rs`.
//!
//! The release build has `panic = "abort"`, so a panic anywhere here ends the app. Values
//! from the webview are checked before they reach anything that could panic (durations
//! from seconds, above all). A malformed file that makes symphonia itself panic while
//! decoding cannot be caught this way: the decoding runs on cpal's callback thread, and
//! `catch_unwind` does nothing under `panic = "abort"`.

use std::io::Cursor;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError, Sender};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;

use rodio::{Decoder, DeviceSinkBuilder, MixerDeviceSink, Player, Source};
use serde::Serialize;
use tauri::{AppHandle, State};

use crate::media_keys::{MediaKeys, Playback};

/// How often the audio thread refreshes the position/ended snapshot while a track plays.
/// The webview polls `desktop_audio_state` roughly every 250 ms, so this only has to be
/// finer than that. Nothing plays: the thread blocks until the next command instead.
const TICK: Duration = Duration::from_millis(50);

/* --------------------------------- messages --------------------------------- */

enum Cmd {
    /// A new track is being fetched: silence the current one now, not when it arrives.
    Unload,
    /// Decode `bytes` and queue them, paused, seeked to `start_sec`.
    Load {
        bytes: Vec<u8>,
        start_sec: f64,
        generation: u64,
    },
    Play,
    Pause,
    Seek(f64),
    /// Output volume, 0–1 (the sleep timer's fade). Kept for later tracks too.
    Volume(f32),
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
    /// Play as soon as the track is ready: `play` arrived while it was still loading.
    want_play: AtomicBool,
    /// Bumped on every `load` (and `stop`). A fetch that finishes, or is still running,
    /// after a newer load started is dropped.
    generation: AtomicU64,
    error: Mutex<Option<String>>,
}

impl Shared {
    fn set_error(&self, message: impl Into<String>) {
        *self.error.lock().unwrap_or_else(|p| p.into_inner()) = Some(message.into());
        self.loading.store(false, Ordering::Relaxed);
        self.playing.store(false, Ordering::Relaxed);
    }
}

/// Managed state. The rodio device sink owns a cpal stream that is not `Send` on every
/// backend, so it lives its whole life on one dedicated thread and is driven by messages.
pub struct DesktopAudio {
    shared: Arc<Shared>,
    tx: Mutex<Option<Sender<Cmd>>>,
    media: Arc<MediaKeys>,
}

impl DesktopAudio {
    pub fn new(app: AppHandle) -> Self {
        Self {
            shared: Arc::default(),
            tx: Mutex::new(None),
            media: Arc::new(MediaKeys::new(app)),
        }
    }

    /// The audio thread's inbox, starting the thread on first use so a session that never
    /// plays anything never opens the sound device.
    fn sender(&self) -> Option<Sender<Cmd>> {
        let mut guard = self.tx.lock().unwrap_or_else(|p| p.into_inner());
        if guard.is_none() {
            let (tx, rx) = mpsc::channel();
            let shared = self.shared.clone();
            let media = self.media.clone();
            match std::thread::Builder::new()
                .name("bol-audio".into())
                .spawn(move || audio_thread(rx, shared, media))
            {
                Ok(_) => *guard = Some(tx),
                // The build has panic = "abort", so an unwrap here would take the whole
                // app down over a track that will not play. Report it and stay up.
                Err(e) => {
                    self.shared.set_error(format!("cannot start the audio thread: {e}"));
                    return None;
                }
            }
        }
        guard.clone()
    }

    fn send(&self, cmd: Cmd) {
        if let Some(tx) = self.sender() {
            let _ = tx.send(cmd);
        }
    }
}

/* -------------------------------- audio thread ------------------------------- */

fn audio_thread(rx: Receiver<Cmd>, shared: Arc<Shared>, media: Arc<MediaKeys>) {
    let mut sink: Option<MixerDeviceSink> = None;
    let mut player: Option<Player> = None;
    // True while a track is queued and has not finished. Distinguishes "the source ran
    // out" (report `ended`, so the controller advances the queue) from "we stopped it".
    let mut active = false;
    let mut reported = Playback::Stopped;
    // Each track gets a fresh Player, so the volume lives here and is applied to each.
    let mut volume: f32 = 1.0;

    loop {
        // Tick only while something plays; otherwise sleep until told to do something.
        let playing_now = active && player.as_ref().is_some_and(|p| !p.is_paused());
        let msg = if playing_now {
            rx.recv_timeout(TICK)
        } else {
            rx.recv().map_err(|_| RecvTimeoutError::Disconnected)
        };
        let mut seeked = false;
        match msg {
            Ok(Cmd::Unload) => {
                active = false;
                if let Some(p) = player.take() {
                    p.stop();
                }
                shared.playing.store(false, Ordering::Relaxed);
            }
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
                        if let Some(p) = &player {
                            p.set_volume(volume as rodio::Float);
                        }
                        shared.duration_ms.store(duration_ms, Ordering::Relaxed);
                        shared
                            .position_ms
                            .store(secs_to_ms(start_sec), Ordering::Relaxed);
                        shared.ended.store(false, Ordering::Relaxed);
                        shared.loading.store(false, Ordering::Relaxed);
                        *shared.error.lock().unwrap_or_else(|p| p.into_inner()) = None;
                        active = true;
                        media.duration(Duration::from_millis(duration_ms));
                        if shared.want_play.load(Ordering::SeqCst) {
                            if let Some(p) = &player {
                                p.play();
                            }
                        }
                    }
                    Err(e) => {
                        // Close the device too: the next load opens whatever is there then.
                        player = None;
                        sink = None;
                        shared.set_error(e);
                    }
                }
            }
            Ok(Cmd::Play) => {
                if let (true, Some(p)) = (active, &player) {
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
                if let (Some(p), Some(target)) = (&player, secs_to_duration(seconds)) {
                    if p.try_seek(target).is_ok() {
                        shared
                            .position_ms
                            .store(secs_to_ms(seconds), Ordering::Relaxed);
                        seeked = true;
                    }
                }
            }
            Ok(Cmd::Volume(v)) => {
                volume = v;
                if let Some(p) = &player {
                    p.set_volume(v as rodio::Float);
                }
            }
            Ok(Cmd::Stop) => {
                active = false;
                if let Some(p) = player.take() {
                    p.stop();
                }
                // Release the sound device; the next load opens it again.
                sink = None;
                shared.playing.store(false, Ordering::Relaxed);
                shared.position_ms.store(0, Ordering::Relaxed);
                shared.duration_ms.store(0, Ordering::Relaxed);
            }
            Err(RecvTimeoutError::Timeout) => {}
            Err(RecvTimeoutError::Disconnected) => return,
        }

        let mut finished = false;
        if let Some(p) = &player {
            shared
                .position_ms
                .store(p.get_pos().as_millis() as u64, Ordering::Relaxed);
            if active {
                // The decoder ran out: the track finished on its own.
                finished = p.empty();
                shared.playing.store(!finished && !p.is_paused(), Ordering::Relaxed);
            }
        }
        if finished {
            // Report `ended`, and close the device; the controller's next load (if any)
            // opens it again.
            active = false;
            shared.ended.store(true, Ordering::Relaxed);
            player = None;
            sink = None;
        }

        // Tell the media widget when that changes (it extrapolates the position itself).
        let now = if active && shared.playing.load(Ordering::Relaxed) {
            Playback::Playing
        } else if active || shared.loading.load(Ordering::Relaxed) {
            Playback::Paused
        } else {
            Playback::Stopped
        };
        if now != reported || seeked {
            reported = now;
            media.playback(now, Duration::from_millis(shared.position_ms.load(Ordering::Relaxed)));
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

    if let Some(start) = secs_to_duration(start_sec).filter(|d| !d.is_zero()) {
        // Missler chapters start mid-file; the "#t=" hint arrives as start_sec.
        let _ = fresh.try_seek(start);
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

/// A position from the webview as a `Duration`, or `None` when it is not one: NaN,
/// infinite, or too large. `Duration::from_secs_f64` panics on those, and with
/// `panic = "abort"` that took the whole app down. Negative values mean the start.
fn secs_to_duration(seconds: f64) -> Option<Duration> {
    if seconds.is_nan() {
        return None;
    }
    Duration::try_from_secs_f64(seconds.max(0.0)).ok()
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

/// Why a fetch did not produce a track.
enum Fetch {
    /// A newer load replaced this one; nothing to report.
    Superseded,
    Failed(String),
}

/// Read or download a track. Gives up part-way as soon as `still_wanted` says a newer
/// load has replaced it, so skipping ahead does not finish downloading every chapter
/// skipped over.
async fn read_bytes(url: &str, still_wanted: impl Fn() -> bool) -> Result<Vec<u8>, Fetch> {
    match resolve(url).map_err(Fetch::Failed)? {
        Origin::Local(path) => std::fs::read(&path)
            .map_err(|e| Fetch::Failed(format!("cannot read {}: {e}", path.display()))),
        Origin::Remote(url) => {
            let mut response = http()
                .get(&url)
                .send()
                .await
                .map_err(|e| Fetch::Failed(format!("cannot fetch audio: {e}")))?;
            if !response.status().is_success() {
                return Err(Fetch::Failed(format!("audio request failed: HTTP {}", response.status())));
            }
            let mut bytes = Vec::with_capacity(response.content_length().unwrap_or(0).min(64 << 20) as usize);
            loop {
                if !still_wanted() {
                    return Err(Fetch::Superseded);
                }
                match response.chunk().await {
                    Ok(Some(chunk)) => bytes.extend_from_slice(&chunk),
                    Ok(None) => return Ok(bytes),
                    Err(e) => return Err(Fetch::Failed(format!("cannot read audio: {e}"))),
                }
            }
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

/// Start fetching (or reading) a track to play, paused at `start_sec`, and return at once.
/// The webview polls `desktop_audio_state` for `loading`, then `playing` or `error`.
/// `title` and `artist` are for the desktop's media widget.
#[tauri::command]
pub fn desktop_audio_load(
    state: State<'_, DesktopAudio>,
    url: String,
    start_sec: Option<f64>,
    title: Option<String>,
    artist: Option<String>,
) {
    let start_sec = start_sec.filter(|s| s.is_finite()).unwrap_or(0.0).max(0.0);
    let shared = state.shared.clone();

    let generation = shared.generation.fetch_add(1, Ordering::SeqCst) + 1;
    shared.loading.store(true, Ordering::Relaxed);
    shared.ended.store(false, Ordering::Relaxed);
    shared.playing.store(false, Ordering::Relaxed);
    shared.want_play.store(false, Ordering::SeqCst);
    shared.duration_ms.store(0, Ordering::Relaxed);
    shared
        .position_ms
        .store(secs_to_ms(start_sec), Ordering::Relaxed);
    *shared.error.lock().unwrap_or_else(|p| p.into_inner()) = None;
    state
        .media
        .track(title.as_deref().unwrap_or(""), artist.as_deref().unwrap_or(""));

    let Some(tx) = state.sender() else { return };
    // The current track stops now; the new one plays when its bytes are here.
    let _ = tx.send(Cmd::Unload);
    tauri::async_runtime::spawn(async move {
        let current = || shared.generation.load(Ordering::SeqCst) == generation;
        match read_bytes(&url, current).await {
            Ok(bytes) if current() => {
                let _ = tx.send(Cmd::Load {
                    bytes,
                    start_sec,
                    generation,
                });
            }
            Ok(_) | Err(Fetch::Superseded) => {} // a newer load won the race
            Err(Fetch::Failed(e)) => {
                if current() {
                    shared.set_error(e);
                }
            }
        }
    });
}

/// Play, now or as soon as the loading track is ready.
#[tauri::command]
pub fn desktop_audio_play(state: State<'_, DesktopAudio>) {
    state.shared.want_play.store(true, Ordering::SeqCst);
    state.send(Cmd::Play);
}

#[tauri::command]
pub fn desktop_audio_pause(state: State<'_, DesktopAudio>) {
    state.shared.want_play.store(false, Ordering::SeqCst);
    state.send(Cmd::Pause);
}

#[tauri::command]
pub fn desktop_audio_seek(state: State<'_, DesktopAudio>, position: f64) {
    if position.is_finite() {
        state.send(Cmd::Seek(position));
    }
}

/// Set the output volume, 0–1: the sleep timer fades the last seconds out with it, then
/// pauses and sets it back to 1. It applies to later tracks as well.
#[tauri::command]
pub fn desktop_audio_volume(state: State<'_, DesktopAudio>, volume: f64) {
    if let Some(v) = volume_from_webview(volume) {
        state.send(Cmd::Volume(v));
    }
}

/// A volume from the webview, clamped to 0–1; None for NaN or infinity.
fn volume_from_webview(volume: f64) -> Option<f32> {
    volume.is_finite().then(|| volume.clamp(0.0, 1.0) as f32)
}

/// Forget the track, abandon any fetch, and release the sound device. The next `load`
/// opens it again.
#[tauri::command]
pub fn desktop_audio_stop(state: State<'_, DesktopAudio>) {
    let shared = &state.shared;
    shared.generation.fetch_add(1, Ordering::SeqCst);
    shared.want_play.store(false, Ordering::SeqCst);
    shared.loading.store(false, Ordering::Relaxed);
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
        error: shared.error.lock().unwrap_or_else(|p| p.into_inner()).clone(),
        generation: shared.generation.load(Ordering::SeqCst),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn volumes_from_the_webview_are_clamped_and_never_nan() {
        assert_eq!(volume_from_webview(0.5), Some(0.5));
        assert_eq!(volume_from_webview(-1.0), Some(0.0));
        assert_eq!(volume_from_webview(3.0), Some(1.0));
        assert_eq!(volume_from_webview(f64::NAN), None);
        assert_eq!(volume_from_webview(f64::INFINITY), None);
    }

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
    fn resolves_file_urls_with_and_without_localhost() {
        for url in ["file:///home/matt/a%20b.mp3", "file://localhost/home/matt/a%20b.mp3"] {
            match resolve(url).unwrap() {
                Origin::Local(p) => assert_eq!(p, PathBuf::from("/home/matt/a b.mp3"), "{url}"),
                _ => panic!("expected a local path for {url}"),
            }
        }
    }

    #[test]
    fn resolves_windows_asset_urls() {
        // convertFileSrc() on Windows: http://asset.localhost/<percent-encoded path>.
        let url = "http://asset.localhost/C%3A%5CUsers%5Cmatt%5CMissler%5C01.mp3";
        match resolve(url).unwrap() {
            Origin::Local(p) => assert_eq!(p, PathBuf::from("C:\\Users\\matt\\Missler\\01.mp3")),
            _ => panic!("expected a local path"),
        }
        assert!(resolve("ftp://example.test/a.mp3").is_err());
    }

    #[test]
    fn positions_from_the_webview_never_panic() {
        // Duration::from_secs_f64 panics on every one of these; with panic = "abort" that
        // closed the app.
        assert_eq!(secs_to_duration(f64::NAN), None);
        assert_eq!(secs_to_duration(f64::INFINITY), None);
        assert_eq!(secs_to_duration(1e300), None);
        assert_eq!(secs_to_duration(-5.0), Some(Duration::ZERO));
        assert_eq!(secs_to_duration(f64::NEG_INFINITY), Some(Duration::ZERO));
        assert_eq!(secs_to_duration(12.5), Some(Duration::from_millis(12_500)));
        assert_eq!(secs_to_ms(f64::NAN), 0);
        assert_eq!(secs_to_ms(-1.0), 0);
    }

    /// Frames of MPEG-2 layer III (the half-rate version: 576 samples a frame).
    #[test]
    fn scans_mpeg2_frames() {
        // MPEG-2, layer III, no CRC; 64 kbit/s at 22.05 kHz: 72 * 64000 / 22050 = 208 bytes.
        let mut bytes = Vec::new();
        for _ in 0..100 {
            let mut frame = vec![0xFF, 0xF3, 0x80, 0x00];
            frame.resize(208, 0);
            bytes.extend_from_slice(&frame);
        }
        // 100 * 576 / 22050 s = 2.612 s.
        let ms = scan_mp3_duration(&bytes).expect("a duration");
        assert!((2600..=2625).contains(&ms), "got {ms}ms");
    }

    /// Padded frames are one byte longer; a scan that ignored the padding bit would lose
    /// sync on every padded frame.
    #[test]
    fn scans_padded_frames() {
        let mut bytes = Vec::new();
        for i in 0..100 {
            let padded = i % 2 == 1;
            let mut frame = vec![0xFF, 0xFB, if padded { 0x92 } else { 0x90 }, 0x00];
            frame.resize(if padded { 418 } else { 417 }, 0);
            bytes.extend_from_slice(&frame);
        }
        let ms = scan_mp3_duration(&bytes).expect("a duration");
        // All 100 frames counted: 100 * 1152 / 44100 s = 2.612 s.
        assert!((2600..=2625).contains(&ms), "got {ms}ms");
    }

    #[test]
    fn keeps_remote_urls_remote() {
        match resolve("https://example.test/JHN/1/audio/david.mp3#t=0").unwrap() {
            Origin::Remote(u) => assert_eq!(u, "https://example.test/JHN/1/audio/david.mp3"),
            _ => panic!("expected a remote URL"),
        }
    }
}
