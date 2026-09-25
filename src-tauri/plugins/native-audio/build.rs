const COMMANDS: &[&str] = &[
    "initialize",
    "register_listener",
    "remove_listener",
    "set_source",
    "set_queue",
    "next",
    "previous",
    "play",
    "pause",
    "seek_to",
    "set_rate",
    "get_state",
    "get_progress_checkpoint",
    "clear_progress_checkpoint",
    "get_debug_log",
    "set_car_snapshot",
    "take_car_completions",
    "ack_car_completions",
    "get_queue",
    "dispose",
];

fn main() {
    tauri_plugin::Builder::new(COMMANDS)
        .android_path("android")
        .ios_path("ios")
        .build();
}
