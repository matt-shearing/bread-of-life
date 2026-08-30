// Desktop audio is played in Rust, not by the webview: WebKitGTK routes <audio>
// through GStreamer, and a host without gst-plugins-good aborts the whole web process.
// See docs/DESKTOP.md.
#[cfg(desktop)]
mod desktop_audio;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Work around a webkit2gtk blank-screen seen on some Linux GPU/driver combos
    // (and notably in AppImages): the DMABUF renderer. Must be set before the
    // webview initialises. Harmless where it isn't needed, and only if the user
    // hasn't set it themselves.
    #[cfg(target_os = "linux")]
    if std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_none() {
        std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
    }

    #[allow(unused_mut)]
    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        // Read-only access to the user's local Missler library folder (see
        // src/data/missler.ts). Scoped to $HOME and removable media in the
        // window capability; audio streams via the asset protocol.
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init());

    // Audio playback outside the webview — desktop only (mobile uses the native
    // Media3 plugin below, and the desktop crates are not in its dependency graph).
    #[cfg(desktop)]
    {
        builder = builder
            .manage(desktop_audio::DesktopAudio::default())
            .invoke_handler(tauri::generate_handler![
                desktop_audio::desktop_audio_load,
                desktop_audio::desktop_audio_play,
                desktop_audio::desktop_audio_pause,
                desktop_audio::desktop_audio_seek,
                desktop_audio::desktop_audio_stop,
                desktop_audio::desktop_audio_state,
            ]);
    }

    // Native background audio (foreground MediaSessionService) — mobile only.
    #[cfg(mobile)]
    {
        builder = builder.plugin(tauri_plugin_native_audio::init());
    }

    // "All files access" (MANAGE_EXTERNAL_STORAGE) bridge — Android only.
    #[cfg(target_os = "android")]
    {
        builder = builder.plugin(tauri_plugin_all_files::init());
    }

    builder
        .run(tauri::generate_context!())
        .expect("error while running Bread of Life");
}
