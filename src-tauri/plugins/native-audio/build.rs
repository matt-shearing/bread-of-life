// Every command the app may call. Tauri turns each into an `allow-<name>` permission (see
// permissions/default.toml) and calls the Kotlin method with the camelCase name
// (`set_queue` -> `NativeAudioPlugin.setQueue`). `register_listener` / `remove_listener` are
// handled by Tauri's base Plugin class (the JS state listener needs them allowed).
const COMMANDS: &[&str] = &[
    "initialize",
    "register_listener",
    "remove_listener",
    "set_queue",
    "skip_to",
    "next",
    "previous",
    "play",
    "pause",
    "stop",
    "seek_to",
    "set_rate",
    "get_state",
    "get_debug_log",
    "set_car_snapshot",
    "take_completions",
    "ack_completions",
    // The v0.4.0 names of take_completions / ack_completions; remove in v0.5.
    "take_car_completions",
    "ack_car_completions",
    "get_queue",
];

fn main() {
    tauri_plugin::Builder::new(COMMANDS)
        .android_path("android")
        .build();
}
