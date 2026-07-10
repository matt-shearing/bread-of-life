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

    tauri::Builder::default()
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_opener::init())
        .run(tauri::generate_context!())
        .expect("error while running Bread of Life");
}
