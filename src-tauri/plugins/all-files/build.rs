const COMMANDS: &[&str] = &["is_manager", "request_manage", "pick_folder"];

fn main() {
    tauri_plugin::Builder::new(COMMANDS)
        .android_path("android")
        .build();
}
