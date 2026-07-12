package app.tauri.allfiles

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.Settings
import android.util.Log
import app.tauri.annotation.Command
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin

private const val TAG = "plugin/all-files"

@TauriPlugin
class AllFilesPlugin(private val activity: Activity) : Plugin(activity) {

    /** Whether the app currently holds "All files access"
     *  (`Environment.isExternalStorageManager()`, API 30+). Below API 30 the
     *  concept doesn't exist, so we report `true` (legacy external-storage rules
     *  apply and the app's own dirs are readable regardless). */
    @Command
    fun is_manager(invoke: Invoke) {
        val granted = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            runCatching { Environment.isExternalStorageManager() }.getOrDefault(false)
        } else {
            true
        }
        val res = JSObject()
        res.put("granted", granted)
        invoke.resolve(res)
    }

    /** Open the system "All files access" toggle for this app so the user can grant
     *  it. Deep-links to this app's page, falling back to the generic all-apps list.
     *  No-op below API 30. Resolves once the intent is launched (the frontend
     *  re-checks `is_manager` when the user returns to the app). */
    @Command
    fun request_manage(invoke: Invoke) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) {
            invoke.resolve()
            return
        }
        try {
            val appIntent = Intent(
                Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION,
                Uri.parse("package:${activity.packageName}"),
            ).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            if (appIntent.resolveActivity(activity.packageManager) != null) {
                activity.startActivity(appIntent)
            } else {
                val listIntent = Intent(Settings.ACTION_MANAGE_ALL_FILES_ACCESS_PERMISSION)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                activity.startActivity(listIntent)
            }
            invoke.resolve()
        } catch (e: Exception) {
            Log.w(TAG, "request_manage failed", e)
            // Best-effort: don't reject in a way that could surface as an error toast;
            // the UI re-checks is_manager on focus and just keeps showing the prompt.
            invoke.resolve()
        }
    }
}
