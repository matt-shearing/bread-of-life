const COMMANDS: &[&str] = &["launch_notification"];

fn main() {
    tauri_plugin::Builder::new(COMMANDS)
        .android_path("android")
        .build();
}
