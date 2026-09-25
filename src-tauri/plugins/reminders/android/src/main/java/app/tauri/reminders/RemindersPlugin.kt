package app.tauri.reminders

import android.app.Activity
import android.content.Intent
import app.tauri.annotation.Command
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin

// Extras tauri-plugin-notification (2.3.x) puts on the intent a notification tap sends
// (TauriNotificationManager.buildIntent). Copied, not imported: they are top-level
// constants in another plugin's module.
private const val NOTIFICATION_ID_KEY = "NotificationId"
private const val NOTIFICATION_OBJ_KEY = "LocalNotficationObject"

@TauriPlugin
class RemindersPlugin(private val activity: Activity) : Plugin(activity) {

    /**
     * The notification whose tap launched the app, if any: `{ id, notification }`,
     * where `notification` is the JSON the app scheduled it with (or null). Consumed
     * on read, so a web-view reload does not navigate again. Resolves `{}` when the
     * app was opened some other way.
     */
    // Kotlin @Command names are camelCase; the JS command is `launch_notification`.
    @Command
    fun launchNotification(invoke: Invoke) {
        val res = JSObject()
        val intent: Intent? = activity.intent
        val id = intent?.getIntExtra(NOTIFICATION_ID_KEY, Int.MIN_VALUE) ?: Int.MIN_VALUE
        if (intent == null || id == Int.MIN_VALUE) {
            invoke.resolve(res) // no "id" key: not opened from a notification
            return
        }
        res.put("id", id)
        val json: String? = intent.getStringExtra(NOTIFICATION_OBJ_KEY)
        if (json != null) res.put("notification", json)
        intent.removeExtra(NOTIFICATION_ID_KEY)
        intent.removeExtra(NOTIFICATION_OBJ_KEY)
        invoke.resolve(res)
    }
}
