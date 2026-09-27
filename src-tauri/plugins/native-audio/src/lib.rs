//! Bread of Life's native audio for Android: Media3 ExoPlayer in a MediaLibraryService, with
//! Android Auto. A vendored fork of tauri-plugin-native-audio 1.0.5; the Kotlin side does all
//! the work (android/src/main/java/app/tauri/nativeaudio). See docs/NATIVE-AUDIO.md.

use tauri::{
    plugin::{Builder, TauriPlugin},
    Runtime,
};

#[cfg(target_os = "android")]
const PLUGIN_IDENTIFIER: &str = "app.tauri.nativeaudio";

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("native-audio")
        .setup(|_app, _api| {
            #[cfg(target_os = "android")]
            {
                let _ = _api.register_android_plugin(PLUGIN_IDENTIFIER, "NativeAudioPlugin")?;
            }
            Ok(())
        })
        .build()
}
