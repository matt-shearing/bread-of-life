mod allfiles;

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
        .plugin(tauri_plugin_fs::init());

    // Native background audio (foreground MediaSessionService) — mobile only.
    #[cfg(mobile)]
    {
        builder = builder.plugin(tauri_plugin_native_audio::init());
    }

    builder
        // "All files access" bridge (Android MANAGE_EXTERNAL_STORAGE) so the
        // Missler library can be read in place from any shared-storage folder.
        .invoke_handler(tauri::generate_handler![
            allfiles::has_all_files_access,
            allfiles::request_all_files_access
        ])
        .run(tauri::generate_context!())
        .expect("error while running Bread of Life");
}
