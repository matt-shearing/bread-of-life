//! Android "All files access" (MANAGE_EXTERNAL_STORAGE) bridge for Tauri.
//!
//! Doing this from Rust via `ndk_context` crashes under Tauri (Tauri doesn't use
//! ndk-glue, so the context is never initialized and `android_context()` panics).
//! The blessed path is a Kotlin plugin, which gets the Activity/context from Tauri
//! naturally — this crate is that plugin's Rust side. It just registers the Android
//! plugin; the two commands are invoked straight from JS as
//! `plugin:all-files|is_manager` / `plugin:all-files|request_manage` and handled by
//! the Kotlin `AllFilesPlugin` (see android/.../AllFilesPlugin.kt).
//!
//! Android-only. On any other platform the plugin registers nothing and the
//! frontend never calls it (it guards on `isAndroid`).

use tauri::{
    plugin::{Builder, TauriPlugin},
    Runtime,
};

#[cfg(target_os = "android")]
const PLUGIN_IDENTIFIER: &str = "app.tauri.allfiles";

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("all-files")
        .setup(|_app, _api| {
            #[cfg(target_os = "android")]
            {
                let _ = _api.register_android_plugin(PLUGIN_IDENTIFIER, "AllFilesPlugin")?;
            }
            Ok(())
        })
        .build()
}
