package app.tauri.allfiles

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.DocumentsContract
import android.provider.Settings
import android.util.Log
import androidx.activity.result.ActivityResult
import app.tauri.annotation.ActivityCallback
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
    // NB: Kotlin @Command method names must be camelCase — Tauri's Android bridge
    // maps the snake_case command (is_manager) to a camelCase method (isManager).
    // build.rs COMMANDS, the JS invoke strings and the permission ids stay snake_case.
    @Command
    fun isManager(invoke: Invoke) {
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
    fun requestManage(invoke: Invoke) {
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

    /** Open the system folder picker (ACTION_OPEN_DOCUMENT_TREE) and return the
     *  chosen folder as an ABSOLUTE filesystem path — the form the app's library
     *  reader uses (with "All files access" granted, it reads the path directly; the
     *  content-tree URI itself isn't usable for the app's join()+readTextFile reads).
     *  Resolves `{ path: "/storage/emulated/0/…" }`, or `{ path: null }` if the user
     *  cancels or the pick can't be mapped to a real path (e.g. an exotic provider). */
    @Command
    fun pickFolder(invoke: Invoke) {
        try {
            val intent = Intent(Intent.ACTION_OPEN_DOCUMENT_TREE)
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            startActivityForResult(invoke, intent, "folderPickerResult")
        } catch (e: Exception) {
            // Reject (not resolve-null) so the UI shows a real error instead of a
            // silent "no folder" — a failure to LAUNCH is different from a cancel.
            Log.w(TAG, "pick_folder failed to launch", e)
            invoke.reject(e.message ?: "could not open the folder picker")
        }
    }

    @ActivityCallback
    fun folderPickerResult(invoke: Invoke, result: ActivityResult) {
        val uri: Uri? = if (result.resultCode == Activity.RESULT_OK) result.data?.data else null
        val path: String? = if (uri != null) treeUriToPath(uri) else null // null = cancelled/unmapped
        val res = JSObject()
        res.put("path", path)
        invoke.resolve(res)
    }

    /** Map a SAF tree URI (…/tree/primary%3ADownload%2Flib) to an absolute path
     *  (/storage/emulated/0/Download/lib). Handles the primary shared volume; a
     *  removable volume is best-effort (/storage/<volumeId>/…). Null if it can't
     *  be mapped. */
    private fun treeUriToPath(uri: Uri): String? {
        return try {
            val docId = DocumentsContract.getTreeDocumentId(uri) // e.g. "primary:Download/lib"
            // Some providers (notably Downloads) hand back an absolute path directly.
            if (docId.startsWith("raw:")) return docId.removePrefix("raw:")
            val parts = docId.split(":", limit = 2)
            val volume = parts.getOrNull(0) ?: return null
            val relative = parts.getOrNull(1).orEmpty()
            when {
                volume.equals("primary", ignoreCase = true) -> {
                    val base = Environment.getExternalStorageDirectory().absolutePath
                    if (relative.isEmpty()) base else "$base/$relative"
                }
                // "home:" is the Documents dir on some OEM document providers.
                volume.equals("home", ignoreCase = true) -> {
                    val docs = Environment
                        .getExternalStoragePublicDirectory(Environment.DIRECTORY_DOCUMENTS).absolutePath
                    if (relative.isEmpty()) docs else "$docs/$relative"
                }
                // A removable volume (SD card / USB): best-effort.
                else -> if (relative.isEmpty()) "/storage/$volume" else "/storage/$volume/$relative"
            }
        } catch (e: Exception) {
            Log.w(TAG, "treeUriToPath failed for $uri", e)
            null
        }
    }
}
