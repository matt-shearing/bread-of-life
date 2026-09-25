//! Android glue for Bread of Life's daily-reading reminders.
//!
//! The reminders themselves are scheduled through `tauri-plugin-notification`. Two
//! things it does not do are here:
//!
//! 1. **Exact alarms.** Its one-off schedules only fire on time when the app may set
//!    exact alarms (Android 12+); otherwise Android is free to deliver them late. The
//!    manifest in `android/` declares `USE_EXACT_ALARM` (Android 13+, granted at install)
//!    and `SCHEDULE_EXACT_ALARM` (Android 12, capped at API 32). It lives in a plugin
//!    because `gen/android` is scaffolded afresh in CI, and a plugin manifest is merged
//!    into the app's.
//! 2. **The tap that launched the app.** When a notification is tapped while the app is
//!    not running, the notification plugin reports the tap before the web view has
//!    subscribed, so the event is lost and the app opens on the dashboard. The Kotlin
//!    `launch_notification` command reads that notification back from the launch
//!    intent, once, so the app can open today's reading.
//!
//! Android-only; the frontend never calls it elsewhere. Kotlin @Command method names
//! are camelCase (`launchNotification`); the command, permission and JS names stay
//! snake_case.

use tauri::{
    plugin::{Builder, TauriPlugin},
    Runtime,
};

#[cfg(target_os = "android")]
const PLUGIN_IDENTIFIER: &str = "app.tauri.reminders";

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("reminders")
        .setup(|_app, _api| {
            #[cfg(target_os = "android")]
            {
                let _ = _api.register_android_plugin(PLUGIN_IDENTIFIER, "RemindersPlugin")?;
            }
            Ok(())
        })
        .build()
}
