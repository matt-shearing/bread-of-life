//! Android "All files access" (MANAGE_EXTERNAL_STORAGE) bridge.
//!
//! Scoped storage means the app can only read its OWN sandboxed dirs by default,
//! which strands a Missler library dropped anywhere else (Downloads, a USB-copied
//! folder, another app's Android/media dir). With the manifest permission granted
//! at runtime, the app can read the library IN PLACE — no network import needed.
//!
//! The manifest permission is added by the Android CI workflow (it patches the
//! generated AndroidManifest.xml, since gen/android isn't in the repo). Here we
//! expose two Tauri commands the Settings screen calls:
//!   - `has_all_files_access` → `Environment.isExternalStorageManager()`
//!   - `request_all_files_access` → open the system "All files access" toggle
//!
//! All JNI lives behind `#[cfg(target_os = "android")]`; on desktop these compile
//! to a `true`/no-op so `cargo check` passes with no NDK.

/// Whether the app currently holds "All files access" (MANAGE_EXTERNAL_STORAGE).
/// Non-Android platforms have unrestricted local file access already → `true`.
#[tauri::command]
pub fn has_all_files_access() -> bool {
    #[cfg(target_os = "android")]
    {
        android::is_external_storage_manager().unwrap_or(false)
    }
    #[cfg(not(target_os = "android"))]
    {
        true
    }
}

/// Open the system settings page where the user grants "All files access" to this
/// app. No-op off Android (and best-effort on Android — the UI re-checks
/// `has_all_files_access` when the user returns, so a failure just shows the note).
#[tauri::command]
pub fn request_all_files_access() {
    #[cfg(target_os = "android")]
    {
        if let Err(e) = android::request_manage_external_storage() {
            // Nothing actionable from Rust; log for `adb logcat` and let the UI's
            // re-check on focus reflect the (un)granted state.
            eprintln!("request_all_files_access failed: {e:?}");
        }
    }
}

#[cfg(target_os = "android")]
mod android {
    use jni::errors::Result;
    use jni::objects::{JObject, JValue};
    use jni::{JNIEnv, JavaVM};

    // Settings action constants (hardcoded to avoid reading static fields over JNI).
    const ACTION_APP_ALL_FILES: &str = "android.settings.MANAGE_APP_ALL_FILES_ACCESS_PERMISSION";
    const ACTION_ALL_FILES: &str = "android.settings.MANAGE_ALL_FILES_ACCESS_PERMISSION";
    const APP_URI: &str = "package:com.breadoflife.app";
    // Intent.FLAG_ACTIVITY_NEW_TASK — required to start an activity from a non-activity context.
    const FLAG_ACTIVITY_NEW_TASK: i32 = 0x1000_0000;

    /// `android.os.Environment.isExternalStorageManager()` (static, returns boolean).
    pub fn is_external_storage_manager() -> Result<bool> {
        let ctx = ndk_context::android_context();
        let vm = unsafe { JavaVM::from_raw(ctx.vm().cast()) }?;
        let mut env = vm.attach_current_thread()?;
        let res = env.call_static_method(
            "android/os/Environment",
            "isExternalStorageManager",
            "()Z",
            &[],
        )?;
        res.z()
    }

    /// Launch the "All files access" toggle for this app, falling back to the
    /// generic all-apps list if the app-specific intent can't be resolved.
    pub fn request_manage_external_storage() -> Result<()> {
        let ctx = ndk_context::android_context();
        let vm = unsafe { JavaVM::from_raw(ctx.vm().cast()) }?;
        let mut env = vm.attach_current_thread()?;
        let activity = unsafe { JObject::from_raw(ctx.context().cast()) };

        // Preferred: deep-link straight to this app's toggle.
        if start_activity(&mut env, &activity, ACTION_APP_ALL_FILES, Some(APP_URI)).is_err() {
            // A thrown Java exception (e.g. ActivityNotFoundException) stays pending
            // and would poison the next JNI call — clear it before the fallback.
            let _ = env.exception_clear();
            // Generic list of all apps' "All files access" toggles (no data URI).
            start_activity(&mut env, &activity, ACTION_ALL_FILES, None)?;
        }
        Ok(())
    }

    /// Build `new Intent(action)`, optionally `setData(Uri.parse(uri))`, add the
    /// NEW_TASK flag, and `activity.startActivity(intent)`.
    fn start_activity(
        env: &mut JNIEnv,
        activity: &JObject,
        action: &str,
        uri: Option<&str>,
    ) -> Result<()> {
        let action_str: JObject = env.new_string(action)?.into();
        let intent = env.new_object(
            "android/content/Intent",
            "(Ljava/lang/String;)V",
            &[JValue::Object(&action_str)],
        )?;

        if let Some(uri) = uri {
            let uri_str: JObject = env.new_string(uri)?.into();
            let parsed = env
                .call_static_method(
                    "android/net/Uri",
                    "parse",
                    "(Ljava/lang/String;)Landroid/net/Uri;",
                    &[JValue::Object(&uri_str)],
                )?
                .l()?;
            env.call_method(
                &intent,
                "setData",
                "(Landroid/net/Uri;)Landroid/content/Intent;",
                &[JValue::Object(&parsed)],
            )?;
        }

        env.call_method(
            &intent,
            "addFlags",
            "(I)Landroid/content/Intent;",
            &[JValue::Int(FLAG_ACTIVITY_NEW_TASK)],
        )?;
        env.call_method(
            activity,
            "startActivity",
            "(Landroid/content/Intent;)V",
            &[JValue::Object(&intent)],
        )?;
        Ok(())
    }
}
