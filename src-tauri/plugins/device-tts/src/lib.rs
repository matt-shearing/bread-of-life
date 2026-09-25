//! The phone's own text-to-speech voice, rendered to a file.
//!
//! Spoken devotionals are normally pre-recorded MP3s. When a recording is not available
//! (offline and never played, or missing from the manifest) the app falls back to the
//! phone's voice. Android's WebView has no usable `speechSynthesis`, and the audio has to
//! go through the same native player as everything else (lock screen, notification,
//! Android Auto), so the Kotlin side uses `TextToSpeech.synthesizeToFile` to render the
//! reading, segment by segment with the same pauses as the recordings, into one WAV in
//! the app's cache, and returns its path. The frontend plays it as a `file://` track,
//! exactly as it plays a downloaded Missler chapter.
//!
//! Android-only; the frontend never calls it elsewhere. Kotlin @Command method names are
//! camelCase (`synthesize`); the command, permission and JS names stay snake_case. Nothing
//! here touches the NDK context from Rust.

use tauri::{
    plugin::{Builder, TauriPlugin},
    Runtime,
};

#[cfg(target_os = "android")]
const PLUGIN_IDENTIFIER: &str = "app.tauri.devicetts";

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("device-tts")
        .setup(|_app, _api| {
            #[cfg(target_os = "android")]
            {
                let _ = _api.register_android_plugin(PLUGIN_IDENTIFIER, "DeviceTtsPlugin")?;
            }
            Ok(())
        })
        .build()
}
