//! Media keys and the desktop's media widget for the Rust player (MPRIS on Linux).
//!
//! WebKitGTK only publishes an MPRIS player for a media element that is playing, and the
//! app never plays one on Linux (see `desktop_audio.rs`), so without this the keyboard's
//! play/pause/next keys, headset buttons and the shell's media widget did nothing. Here
//! the app registers itself as `org.mpris.MediaPlayer2.breadoflife` on the session bus
//! (through `souvlaki`, over the libdbus that tao already links), shows the chapter
//! playing, and turns the widget's commands into `desktop-media-control` events for the
//! webview, whose audio controller owns the queue (next, previous, mark-read).
//!
//! Registration waits for the first track, so a session that never plays anything never
//! appears in the widget. If there is no session bus (a bare X session, a sandbox) it
//! gives up quietly and playback works as before. Other desktops get a no-op stand-in:
//! macOS and Windows play through their webviews, whose Media Session does this already.

/// What the player is doing, for the widget.
#[derive(Clone, Copy, PartialEq, Debug)]
pub enum Playback {
    Stopped,
    Paused,
    Playing,
}

/// One transport command, as the webview receives it (`src/audio/engine.ts`).
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
#[derive(Clone, serde::Serialize, PartialEq, Debug)]
pub struct Control {
    /// "play", "pause", "toggle", "next", "previous", "stop", "seek" or "seekBy".
    pub action: &'static str,
    /// "seek": where to, in seconds.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub position: Option<f64>,
    /// "seekBy": how far, in seconds (negative is back).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub offset: Option<f64>,
}

/// How far the widget's plain "seek forward/back" goes.
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
const SEEK_STEP_SECS: f64 = 10.0;

#[cfg(target_os = "linux")]
pub use linux::MediaKeys;

#[cfg(not(target_os = "linux"))]
pub use other::MediaKeys;

/// Map a souvlaki event to the command the webview understands. `None` for what the app
/// does not support (volume, opening a URI, quitting).
#[cfg(target_os = "linux")]
fn control_for(event: souvlaki::MediaControlEvent) -> Option<Control> {
    use souvlaki::{MediaControlEvent as E, SeekDirection};
    let simple = |action| Some(Control { action, position: None, offset: None });
    let by = |dir: SeekDirection, secs: f64| Control {
        action: "seekBy",
        position: None,
        offset: Some(if dir == SeekDirection::Forward { secs } else { -secs }),
    };
    match event {
        E::Play => simple("play"),
        E::Pause => simple("pause"),
        E::Toggle => simple("toggle"),
        E::Next => simple("next"),
        E::Previous => simple("previous"),
        E::Stop => simple("stop"),
        E::Seek(dir) => Some(by(dir, SEEK_STEP_SECS)),
        E::SeekBy(dir, d) => Some(by(dir, d.as_secs_f64())),
        E::SetPosition(p) => Some(Control {
            action: "seek",
            position: Some(p.0.as_secs_f64()),
            offset: None,
        }),
        E::SetVolume(_) | E::OpenUri(_) | E::Raise | E::Quit => None,
    }
}

#[cfg(target_os = "linux")]
mod linux {
    use super::{control_for, Playback};
    use souvlaki::{MediaControls, MediaMetadata, MediaPlayback, MediaPosition, PlatformConfig};
    use std::sync::Mutex;
    use std::time::Duration;
    use tauri::{AppHandle, Emitter, Manager};

    #[derive(Default)]
    struct Inner {
        controls: Option<MediaControls>,
        /// Registration failed (no session bus): do not try again this run.
        unavailable: bool,
        title: String,
        artist: String,
        duration: Option<Duration>,
    }

    pub struct MediaKeys {
        app: AppHandle,
        inner: Mutex<Inner>,
    }

    impl MediaKeys {
        pub fn new(app: AppHandle) -> Self {
            Self {
                app,
                inner: Mutex::new(Inner::default()),
            }
        }

        /// Run `f` on the registered controls, registering on first use.
        fn with(&self, f: impl FnOnce(&mut MediaControls, &Inner)) {
            let Ok(mut inner) = self.inner.lock() else { return };
            if inner.unavailable {
                return;
            }
            if inner.controls.is_none() {
                match register(&self.app) {
                    Ok(c) => inner.controls = Some(c),
                    Err(e) => {
                        eprintln!("media keys unavailable: {e}");
                        inner.unavailable = true;
                        return;
                    }
                }
            }
            let mut controls = inner.controls.take();
            if let Some(c) = controls.as_mut() {
                f(c, &inner);
            }
            inner.controls = controls;
        }

        /// A new track: its title and artist (the duration follows once it is decoded).
        pub fn track(&self, title: &str, artist: &str) {
            if let Ok(mut inner) = self.inner.lock() {
                inner.title = title.to_string();
                inner.artist = artist.to_string();
                inner.duration = None;
            }
            self.publish_metadata();
        }

        pub fn duration(&self, duration: Duration) {
            if let Ok(mut inner) = self.inner.lock() {
                inner.duration = (!duration.is_zero()).then_some(duration);
            }
            self.publish_metadata();
        }

        fn publish_metadata(&self) {
            self.with(|c, inner| {
                let _ = c.set_metadata(MediaMetadata {
                    title: Some(&inner.title).filter(|t| !t.is_empty()).map(|t| t.as_str()),
                    artist: Some(&inner.artist).filter(|a| !a.is_empty()).map(|a| a.as_str()),
                    album: Some("Bread of Life"),
                    cover_url: None,
                    duration: inner.duration,
                });
            });
        }

        /// Playing, paused or stopped, and where (widgets extrapolate from here).
        pub fn playback(&self, playback: Playback, position: Duration) {
            // Nothing to show until something has been loaded at least once.
            if self.inner.lock().map(|i| i.controls.is_none()).unwrap_or(true) {
                return;
            }
            self.with(|c, _| {
                let progress = Some(MediaPosition(position));
                let _ = c.set_playback(match playback {
                    Playback::Playing => MediaPlayback::Playing { progress },
                    Playback::Paused => MediaPlayback::Paused { progress },
                    Playback::Stopped => MediaPlayback::Stopped,
                });
            });
        }
    }

    fn register(app: &AppHandle) -> Result<MediaControls, souvlaki::Error> {
        let mut controls = MediaControls::new(PlatformConfig {
            display_name: "Bread of Life",
            dbus_name: "breadoflife",
            hwnd: None,
        })?;
        let app = app.clone();
        controls.attach(move |event| {
            if matches!(event, souvlaki::MediaControlEvent::Raise) {
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.unminimize();
                    let _ = w.show();
                    let _ = w.set_focus();
                }
                return;
            }
            if let Some(control) = control_for(event) {
                let _ = app.emit("desktop-media-control", control);
            }
        })?;
        Ok(controls)
    }
}

#[cfg(not(target_os = "linux"))]
mod other {
    use super::Playback;
    use std::time::Duration;

    /// macOS and Windows play through the webview, whose Media Session covers this.
    pub struct MediaKeys;

    impl MediaKeys {
        pub fn new<R: tauri::Runtime>(_app: tauri::AppHandle<R>) -> Self {
            Self
        }
        pub fn track(&self, _title: &str, _artist: &str) {}
        pub fn duration(&self, _duration: Duration) {}
        pub fn playback(&self, _playback: Playback, _position: Duration) {}
    }
}

#[cfg(all(test, target_os = "linux"))]
mod tests {
    use super::*;
    use souvlaki::{MediaControlEvent as E, MediaPosition, SeekDirection};
    use std::time::Duration;

    #[test]
    fn widget_commands_become_the_webviews_commands() {
        assert_eq!(control_for(E::Toggle).unwrap().action, "toggle");
        assert_eq!(control_for(E::Next).unwrap().action, "next");
        let back = control_for(E::SeekBy(SeekDirection::Backward, Duration::from_secs(15))).unwrap();
        assert_eq!((back.action, back.offset), ("seekBy", Some(-15.0)));
        let fwd = control_for(E::Seek(SeekDirection::Forward)).unwrap();
        assert_eq!(fwd.offset, Some(SEEK_STEP_SECS));
        let to = control_for(E::SetPosition(MediaPosition(Duration::from_millis(90_500)))).unwrap();
        assert_eq!((to.action, to.position), ("seek", Some(90.5)));
        assert!(control_for(E::Quit).is_none());
        assert!(control_for(E::SetVolume(0.5)).is_none());
    }

    #[test]
    fn serializes_as_the_webview_expects() {
        let json = serde_json::to_string(&control_for(E::SetPosition(MediaPosition(Duration::from_secs(3)))).unwrap()).unwrap();
        assert_eq!(json, r#"{"action":"seek","position":3.0}"#);
        let json = serde_json::to_string(&control_for(E::Play).unwrap()).unwrap();
        assert_eq!(json, r#"{"action":"play"}"#);
    }
}
