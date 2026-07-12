const COMMANDS: &[&str] = &["is_manager", "request_manage"];

fn main() {
    tauri_plugin::Builder::new(COMMANDS)
        .android_path("android")
        .build();
}
