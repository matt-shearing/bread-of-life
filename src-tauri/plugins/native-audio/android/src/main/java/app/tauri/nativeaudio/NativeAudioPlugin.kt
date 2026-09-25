package app.tauri.nativeaudio

import android.Manifest
import android.app.Activity
import android.app.PendingIntent
import android.content.ComponentName
import android.content.Context
import android.content.SharedPreferences
import android.content.Intent
import android.content.ServiceConnection
import android.content.pm.ApplicationInfo
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.Canvas
import android.net.Uri
import android.app.ActivityManager
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager
import android.os.SystemClock
import android.util.Log
import android.view.KeyEvent
import androidx.annotation.OptIn
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.ForwardingPlayer
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.util.BitmapLoader
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DataSourceBitmapLoader
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.session.CacheBitmapLoader
import androidx.media3.session.MediaSession
import androidx.media3.session.MediaSessionService
import androidx.media3.session.SessionResult
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import com.google.common.util.concurrent.Futures
import com.google.common.util.concurrent.ListenableFuture
import kotlin.math.max

private const val TAG = "plugin/native-audio"
private const val EVENT_STATE = "native_audio_state"
private const val NOTIFICATION_PERMISSION_REQUEST_CODE = 9512
private const val FOREGROUND_PROGRESS_TICK_MS = 25L
private const val BACKGROUND_PROGRESS_TICK_MS = 250L
private const val SEEK_INCREMENT_MS = 10_000L
private const val SEEK_STATE_STALE_MS = 1_500L
private const val PROGRESS_PERSIST_THROTTLE_MS = 1_000L
private const val PROGRESS_NEAR_START_EPSILON_SEC = 0.25
private const val PROGRESS_PERSIST_EPSILON_SEC = 0.05
private const val PROGRESS_PREFS_NAME = "tauri_native_audio_progress"
private const val PROGRESS_KEY_STORY_ID = "story_id"
private const val PROGRESS_KEY_CURRENT_TIME = "current_time"
private const val PROGRESS_KEY_UPDATED_AT_MS = "updated_at_ms"
private const val PROGRESS_KEY_STATUS = "status"
// Turn on logcat output in a release build with: adb shell setprop log.tag.BoLAudio DEBUG
private const val DEBUG_TAG = "BoLAudio"
private const val DEBUG_LOG_CAPACITY = 300
private const val ARTWORK_SIZE_PX = 256

data class NativeAudioState(
    val status: String,
    val currentTime: Double,
    val duration: Double,
    val isPlaying: Boolean,
    val buffering: Boolean,
    val rate: Double,
    val index: Int = 0,
    val error: String? = null,
    /** Monotonic time the snapshot was taken, so JS can drop events older than a getState. */
    val capturedAtMs: Long = SystemClock.elapsedRealtime(),
)

data class NativeAudioProgressCheckpoint(
    val id: Long,
    val currentTime: Double,
    val updatedAtMs: Long,
    val status: String? = null,
)

@InvokeArg
class SetSourceArgs {
    var src: String? = null
    var id: Long? = null
    var title: String? = null
    var artist: String? = null
    var artworkUrl: String? = null
}

@InvokeArg
class SeekToArgs {
    var position: Double? = null
}

@InvokeArg
class SetRateArgs {
    var rate: Double? = null
}

@InvokeArg
class QueueItemArg {
    var src: String? = null
    var id: Long? = null
    var title: String? = null
    var artist: String? = null
    var artworkUrl: String? = null
}

@InvokeArg
class SetQueueArgs {
    var items: List<QueueItemArg>? = null
    var startIndex: Int? = null
}

private data class PendingSeekState(
    val shouldResume: Boolean,
    val startedAtMs: Long,
)

@OptIn(UnstableApi::class)
object NativeAudioRuntime {
    private val lock = Any()
    private val tickHandler = Handler(Looper.getMainLooper())
    private var tickScheduled = false

    /** Tests swap in a player that needs no network or audio hardware. */
    @Volatile
    internal var playerFactory: (Context) -> ExoPlayer = { ctx ->
        ExoPlayer.Builder(ctx)
            .setSeekBackIncrementMs(SEEK_INCREMENT_MS)
            .setSeekForwardIncrementMs(SEEK_INCREMENT_MS)
            .build()
    }

    // The service is kept alive by this binding while a queue is loaded. A started-only service
    // is stopped by Android's background limits about a minute after it leaves the foreground
    // (i.e. during a pause), and nothing brought it back when an earphone press resumed playback.
    private var serviceBindRequested = false
    private var serviceRunning = false
    private val serviceConnection = object : ServiceConnection {
        override fun onServiceConnected(name: ComponentName?, service: IBinder?) {
            debugLog("service", "bound")
        }

        override fun onServiceDisconnected(name: ComponentName?) {
            debugLog("service", "binding lost (process of service died)")
        }

        override fun onNullBinding(name: ComponentName?) {
            debugLog("service", "bound (null binder)")
        }
    }

    private val debugLines = ArrayDeque<String>()
    @Volatile
    private var debugToLogcat: Boolean? = null
    private var appIconBitmap: Bitmap? = null

    private var player: ExoPlayer? = null
    private var appContext: Context? = null
    private var mediaSession: MediaSession? = null
    private var mediaSessionPlayer: Player? = null
    private var lastError: String? = null
    private var pendingSeekState: PendingSeekState? = null
    private var currentStoryId: Long? = null
    private var lastProgressPersistedAtMs = 0L
    private var lastProgressPersistedStoryId: Long? = null
    private var lastProgressPersistedTimeSec: Double? = null

    private val tickRunnable = object : Runnable {
        override fun run() {
            val shouldContinue = synchronized(lock) {
                val snapshot = snapshotLocked()
                appContext?.let { persistProgressCheckpointLocked(it, snapshot, force = false) }
                NativeAudioPlugin.emitToActive(snapshot)
                val isPlaying = player?.isPlaying == true
                tickScheduled = isPlaying
                isPlaying
            }
            if (shouldContinue) {
                val delay = synchronized(lock) { nextProgressTickDelayLocked() }
                tickHandler.postDelayed(this, delay)
            }
        }
    }

    private val playerListener = object : Player.Listener {
        override fun onPlayWhenReadyChanged(playWhenReady: Boolean, reason: Int) {
            debugLog("player", "playWhenReady=$playWhenReady reason=${playWhenReadyReasonName(reason)}")
        }

        override fun onPlaybackSuppressionReasonChanged(playbackSuppressionReason: Int) {
            // Non-zero = playWhenReady is true but audio is held back (e.g. transient focus loss).
            debugLog("player", "suppressionReason=$playbackSuppressionReason")
        }

        override fun onPlaybackStateChanged(playbackState: Int) {
            debugLog("player", "playbackState=${playbackStateName(playbackState)}")
            if (playbackState == Player.STATE_ENDED) {
                synchronized(lock) {
                    appContext?.let { persistProgressCheckpointLocked(it, snapshotLocked(), force = true) }
                }
            }
            syncTicking()
            emitState()
        }

        override fun onMediaItemTransition(mediaItem: MediaItem?, reason: Int) {
            // ExoPlayer advanced to the next playlist item on its own — tell JS so it can
            // update the mini-player + mark the finished chapter read.
            appContext?.let {
                synchronized(lock) { persistProgressCheckpointLocked(it, snapshotLocked(), force = true) }
            }
            syncTicking()
            emitState()
        }

        override fun onIsPlayingChanged(isPlaying: Boolean) {
            debugLog("player", "isPlaying=$isPlaying serviceRunning=${synchronized(lock) { serviceRunning }}")
            syncTicking()
            emitState()
        }

        override fun onPlaybackParametersChanged(playbackParameters: androidx.media3.common.PlaybackParameters) {
            emitState()
        }

        override fun onPositionDiscontinuity(
            oldPosition: Player.PositionInfo,
            newPosition: Player.PositionInfo,
            reason: Int,
        ) {
            if (reason == Player.DISCONTINUITY_REASON_SEEK || reason == Player.DISCONTINUITY_REASON_SEEK_ADJUSTMENT) {
                synchronized(lock) {
                    val exoPlayer = player ?: return@synchronized
                    val pendingSeek = pendingSeekState
                    val shouldResume = pendingSeek?.shouldResume ?: exoPlayer.playWhenReady
                    if (!shouldResume && exoPlayer.playWhenReady) exoPlayer.pause()
                    val shouldRecoverPlayback =
                        shouldResume &&
                            !exoPlayer.isPlaying &&
                            exoPlayer.playbackState == Player.STATE_READY &&
                            lastError == null
                    if (shouldRecoverPlayback) exoPlayer.play()
                    appContext?.let { persistProgressCheckpointLocked(it, snapshotLocked(), force = true) }
                }
            }
            syncTicking()
            emitState()
        }

        override fun onPlayerError(error: PlaybackException) {
            Log.e(TAG, "onPlayerError code=${error.errorCodeName} message=${error.message}", error)
            debugLog("player", "error ${error.errorCodeName}: ${error.message}")
            synchronized(lock) {
                lastError = error.message ?: "unknown"
                pendingSeekState = null
            }
            syncTicking()
            emitState()
        }
    }

    fun ensure(context: Context) {
        synchronized(lock) {
            if (player != null && mediaSession != null) return

            val ctx = context.applicationContext
            appContext = ctx

            val audioAttributes = AudioAttributes.Builder()
                .setUsage(C.USAGE_MEDIA)
                .setContentType(C.AUDIO_CONTENT_TYPE_MUSIC)
                .build()

            val exoPlayer = playerFactory(ctx)
            exoPlayer.setAudioAttributes(audioAttributes, true)
            exoPlayer.setHandleAudioBecomingNoisy(true)
            // Chapters stream over the network: hold a Wi-Fi lock as well as a CPU wake lock
            // while playing, so a locked phone does not let the connection sleep.
            exoPlayer.setWakeMode(C.WAKE_MODE_NETWORK)
            exoPlayer.addListener(playerListener)
            player = exoPlayer
            // Every play command reaches ExoPlayer through this wrapper: the app's own Play
            // button (via play() below), the notification, the lock screen and earphone or
            // Bluetooth buttons (via Media3's MediaSession). So the set-up a play needs lives
            // here, once, instead of only on the app's path.
            mediaSessionPlayer = object : ForwardingPlayer(exoPlayer) {
                override fun play() {
                    onPlayRequested("play")
                    super.play()
                }

                override fun setPlayWhenReady(playWhenReady: Boolean) {
                    if (playWhenReady) onPlayRequested("setPlayWhenReady") else onPauseRequested("setPlayWhenReady")
                    super.setPlayWhenReady(playWhenReady)
                }

                override fun pause() {
                    onPauseRequested("pause")
                    super.pause()
                }

                override fun getAvailableCommands(): Player.Commands {
                    return super.getAvailableCommands()
                        .buildUpon()
                        .add(Player.COMMAND_SEEK_BACK)
                        .add(Player.COMMAND_SEEK_FORWARD)
                        .add(Player.COMMAND_SEEK_TO_PREVIOUS)
                        .add(Player.COMMAND_SEEK_TO_PREVIOUS_MEDIA_ITEM)
                        .add(Player.COMMAND_SEEK_TO_NEXT)
                        .add(Player.COMMAND_SEEK_TO_NEXT_MEDIA_ITEM)
                        .build()
                }

                override fun isCommandAvailable(command: Int): Boolean {
                    if (command == Player.COMMAND_SEEK_BACK || command == Player.COMMAND_SEEK_FORWARD) return true
                    if (command == Player.COMMAND_SEEK_TO_PREVIOUS || command == Player.COMMAND_SEEK_TO_PREVIOUS_MEDIA_ITEM) return true
                    if (command == Player.COMMAND_SEEK_TO_NEXT || command == Player.COMMAND_SEEK_TO_NEXT_MEDIA_ITEM) return true
                    return super.isCommandAvailable(command)
                }

                override fun seekToPrevious() {
                    exoPlayer.seekBack()
                }

                override fun seekToPreviousMediaItem() {
                    exoPlayer.seekBack()
                }

                override fun seekToNext() {
                    exoPlayer.seekForward()
                }

                override fun seekToNextMediaItem() {
                    exoPlayer.seekForward()
                }
            }

            val launchIntent = ctx.packageManager.getLaunchIntentForPackage(ctx.packageName)
            val pendingIntent = launchIntent?.let {
                val flags = PendingIntent.FLAG_UPDATE_CURRENT or
                    (if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) PendingIntent.FLAG_IMMUTABLE else 0)
                PendingIntent.getActivity(ctx, 0, it, flags)
            }

            val sessionPlayer = mediaSessionPlayer ?: exoPlayer
            mediaSession = MediaSession.Builder(ctx, sessionPlayer)
                .setCallback(sessionCallback)
                .setBitmapLoader(AppIconBitmapLoader(CacheBitmapLoader(DataSourceBitmapLoader(ctx))) { appIcon(ctx) })
                .apply {
                    if (pendingIntent != null) setSessionActivity(pendingIntent)
                }
                .build()

            lastError = null
            syncTickingLocked()
        }
    }

    fun initialize(context: Context) {
        ensure(context)
        emitState()
    }

    /**
     * Keep [NativeAudioService] alive for as long as something is loaded. Binding is allowed from
     * the background (unlike startService), never needs a matching startForeground(), and a bound
     * service is not stopped by the background-service limits. Media3 promotes the service to the
     * foreground itself whenever the player plays.
     */
    private fun ensureServiceBoundLocked(context: Context) {
        if (serviceBindRequested) return
        val ctx = context.applicationContext
        val intent = Intent(ctx, NativeAudioService::class.java).setAction(MediaSessionService.SERVICE_INTERFACE)
        val bound = runCatching { ctx.bindService(intent, serviceConnection, Context.BIND_AUTO_CREATE) }
            .onFailure { Log.w(TAG, "bindService failed", it) }
            .getOrDefault(false)
        serviceBindRequested = bound
        debugLog("service", "bind requested ok=$bound")
    }

    /** Drop our binding so the service can stop (dispose, or the app swiped away while paused). */
    fun releaseServiceBinding(context: Context) {
        synchronized(lock) {
            if (!serviceBindRequested) return
            serviceBindRequested = false
            runCatching { context.applicationContext.unbindService(serviceConnection) }
                .onFailure { Log.w(TAG, "unbindService failed", it) }
            debugLog("service", "unbound")
        }
    }

    internal fun onServiceCreated(@Suppress("UNUSED_PARAMETER") service: NativeAudioService) {
        synchronized(lock) { serviceRunning = true }
        debugLog("service", "onCreate")
    }

    internal fun onServiceDestroyed(@Suppress("UNUSED_PARAMETER") service: NativeAudioService) {
        synchronized(lock) { serviceRunning = false }
    }

    internal fun isServiceBindRequested(): Boolean = synchronized(lock) { serviceBindRequested }

    /**
     * Runs for EVERY play, whatever sent it (see the ForwardingPlayer in [ensure]). Earphone and
     * lock-screen commands never pass through [play], so anything a play needs must happen here.
     */
    private fun onPlayRequested(via: String) {
        synchronized(lock) {
            debugLog("command", "play via=$via from=${currentController()}")
            pendingSeekState = null
            lastError = null
            appContext?.let { ensureServiceBoundLocked(it) }
        }
    }

    private fun onPauseRequested(via: String) {
        debugLog("command", "pause via=$via from=${currentController()}")
    }

    fun stopService(context: Context) {
        val serviceIntent = Intent(context.applicationContext, NativeAudioService::class.java)
        context.applicationContext.stopService(serviceIntent)
    }

    fun setSource(context: Context, src: String, storyId: Long?, title: String?, artist: String?, artworkUrl: String?) {
        synchronized(lock) {
            ensure(context)
            val exoPlayer = player ?: return

            val mediaItem = buildMediaItem(src, title, artist, artworkUrl)

            pendingSeekState = null
            currentStoryId = storyId?.takeIf { it > 0 }
            exoPlayer.setMediaItem(mediaItem)
            exoPlayer.prepare()
            lastError = null
            ensureServiceBoundLocked(context)
            syncTickingLocked()
        }
        emitState()
    }

    // Load a whole PLAYLIST so ExoPlayer advances chapter→chapter itself — no JS needed,
    // which is what makes it seamless when the app is backgrounded (the WebView/JS freezes).
    fun setQueue(context: Context, items: List<QueueItemArg>, startIndex: Int) {
        synchronized(lock) {
            ensure(context)
            val exoPlayer = player ?: return
            val mediaItems = items
                .filter { !it.src.isNullOrBlank() }
                .map { buildMediaItem(it.src!!.trim(), it.title, it.artist, it.artworkUrl) }
            if (mediaItems.isEmpty()) return
            pendingSeekState = null
            currentStoryId = null
            val start = startIndex.coerceIn(0, mediaItems.size - 1)
            exoPlayer.setMediaItems(mediaItems, start, 0L)
            exoPlayer.prepare()
            lastError = null
            ensureServiceBoundLocked(context)
            syncTickingLocked()
        }
        emitState()
    }

    fun next(context: Context) {
        synchronized(lock) {
            val exoPlayer = player ?: return
            if (exoPlayer.hasNextMediaItem()) exoPlayer.seekToNextMediaItem()
        }
        emitState()
    }

    fun previous(context: Context) {
        synchronized(lock) {
            val exoPlayer = player ?: return
            if (exoPlayer.currentPosition > 3000L || !exoPlayer.hasPreviousMediaItem()) {
                exoPlayer.seekTo(0L)
            } else {
                exoPlayer.seekToPreviousMediaItem()
            }
        }
        emitState()
    }

    /** The app's Play button. Goes through the same wrapper as every other play command. */
    fun play(context: Context) {
        synchronized(lock) {
            ensure(context)
            val exoPlayer = player ?: return
            val sessionPlayer = mediaSessionPlayer ?: exoPlayer
            if (exoPlayer.playbackState == Player.STATE_ENDED) {
                exoPlayer.seekTo(0L)
            }
            sessionPlayer.play()
            syncTickingLocked()
        }
        emitState()
    }

    fun pause(context: Context) {
        synchronized(lock) {
            ensure(context)
            pendingSeekState = null
            (mediaSessionPlayer ?: player)?.pause()
            syncTickingLocked()
            persistProgressCheckpointLocked(context.applicationContext, snapshotLocked(), force = true)
        }
        emitState()
    }

    fun seekTo(context: Context, positionSec: Double) {
        if (!positionSec.isFinite()) return
        synchronized(lock) {
            ensure(context)
            val safeMs = max(0L, (positionSec * 1000.0).toLong())
            val exoPlayer = player ?: return@synchronized
            val shouldResume = exoPlayer.playWhenReady || exoPlayer.isPlaying
            pendingSeekState = PendingSeekState(shouldResume = shouldResume, startedAtMs = System.currentTimeMillis())
            if (!shouldResume && exoPlayer.playWhenReady) exoPlayer.pause()
            exoPlayer.seekTo(safeMs)
        }
        emitState()
    }

    fun setRate(context: Context, rate: Double) {
        if (!rate.isFinite() || rate <= 0.0) return
        synchronized(lock) {
            ensure(context)
            player?.setPlaybackSpeed(rate.toFloat())
        }
        emitState()
    }

    fun getState(context: Context): NativeAudioState {
        synchronized(lock) {
            ensure(context)
            return snapshotLocked()
        }
    }

    fun getProgressCheckpoint(context: Context): NativeAudioProgressCheckpoint? {
        val prefs = progressPrefs(context.applicationContext)
        val storyId = prefs.getLong(PROGRESS_KEY_STORY_ID, 0L)
        if (storyId <= 0L) return null
        val currentTime = prefs.getFloat(PROGRESS_KEY_CURRENT_TIME, 0f).toDouble()
        val updatedAtMs = prefs.getLong(PROGRESS_KEY_UPDATED_AT_MS, 0L)
        if (!currentTime.isFinite() || currentTime <= 0.0 || updatedAtMs <= 0L) return null
        val status = prefs.getString(PROGRESS_KEY_STATUS, null)
        return NativeAudioProgressCheckpoint(
            id = storyId,
            currentTime = currentTime,
            updatedAtMs = updatedAtMs,
            status = status,
        )
    }

    fun clearProgressCheckpoint(context: Context) {
        synchronized(lock) {
            progressPrefs(context.applicationContext).edit()
                .remove(PROGRESS_KEY_STORY_ID)
                .remove(PROGRESS_KEY_CURRENT_TIME)
                .remove(PROGRESS_KEY_UPDATED_AT_MS)
                .remove(PROGRESS_KEY_STATUS)
                .apply()
            lastProgressPersistedAtMs = 0L
            lastProgressPersistedStoryId = null
            lastProgressPersistedTimeSec = null
        }
    }

    fun dispose(context: Context) {
        synchronized(lock) {
            persistProgressCheckpointLocked(context.applicationContext, snapshotLocked(), force = true)
            tickHandler.removeCallbacks(tickRunnable)
            tickScheduled = false

            player?.removeListener(playerListener)
            player?.release()
            player = null

            mediaSession?.release()
            mediaSession = null
            mediaSessionPlayer = null

            lastError = null
            pendingSeekState = null
            currentStoryId = null
            appContext = null
        }
        releaseServiceBinding(context)
        stopService(context)
        emitState()
    }

    fun mediaSession(): MediaSession? {
        synchronized(lock) {
            return mediaSession
        }
    }

    fun mediaSessionPlayer(): Player? {
        synchronized(lock) {
            return mediaSessionPlayer ?: player
        }
    }

    /**
     * Logs who asked the session to do what: the app, the media notification, the system UI,
     * Bluetooth/earphones, Android Auto… Media3 calls this for every controller command.
     */
    private val sessionCallback = object : MediaSession.Callback {
        override fun onPostConnect(session: MediaSession, controller: MediaSession.ControllerInfo) {
            debugLog("session", "connected ${describe(session, controller)}")
        }

        override fun onDisconnected(session: MediaSession, controller: MediaSession.ControllerInfo) {
            debugLog("session", "disconnected ${describe(session, controller)}")
        }

        override fun onMediaButtonEvent(
            session: MediaSession,
            controllerInfo: MediaSession.ControllerInfo,
            intent: Intent,
        ): Boolean {
            @Suppress("DEPRECATION")
            val key = intent.getParcelableExtra<KeyEvent>(Intent.EXTRA_KEY_EVENT)
            val keyName = key?.let { KeyEvent.keyCodeToString(it.keyCode) } ?: "none"
            val action = when (key?.action) {
                KeyEvent.ACTION_DOWN -> "down"
                KeyEvent.ACTION_UP -> "up"
                else -> "?"
            }
            debugLog("button", "$keyName $action repeat=${key?.repeatCount ?: 0} from=${describe(session, controllerInfo)}")
            return false // let Media3 handle it as usual
        }

        @Deprecated("Media3 still calls this for every player command in 1.4.x")
        override fun onPlayerCommandRequest(
            session: MediaSession,
            controller: MediaSession.ControllerInfo,
            playerCommand: Int,
        ): Int {
            debugLog("session", "command ${playerCommandName(playerCommand)} from=${describe(session, controller)}")
            return SessionResult.RESULT_SUCCESS
        }
    }

    private fun currentController(): String {
        val session = mediaSession ?: return "app"
        val controller = runCatching { session.controllerForCurrentRequest }.getOrNull() ?: return "app"
        return describe(session, controller)
    }

    private fun describe(session: MediaSession, controller: MediaSession.ControllerInfo): String {
        val role = when {
            session.isMediaNotificationController(controller) -> "media-notification"
            session.isAutomotiveController(controller) -> "automotive"
            session.isAutoCompanionController(controller) -> "android-auto"
            controller.controllerVersion == MediaSession.ControllerInfo.LEGACY_CONTROLLER_VERSION -> "legacy"
            else -> "media3"
        }
        return "${controller.packageName}($role uid=${controller.uid})"
    }

    /** Ring buffer of recent audio events, always kept (cheap); logcat only when debugging. */
    fun debugLog(tag: String, message: String) {
        val line = "${java.text.SimpleDateFormat("HH:mm:ss.SSS", java.util.Locale.US).format(java.util.Date())} [$tag] $message"
        synchronized(debugLines) {
            debugLines.addLast(line)
            while (debugLines.size > DEBUG_LOG_CAPACITY) debugLines.removeFirst()
        }
        if (isDebugLoggingEnabled()) Log.d(DEBUG_TAG, "[$tag] $message")
    }

    fun debugLogLines(): List<String> = synchronized(debugLines) { debugLines.toList() }

    private fun isDebugLoggingEnabled(): Boolean {
        val cached = debugToLogcat
        val debuggable = cached ?: run {
            val ctx = appContext ?: return Log.isLoggable(DEBUG_TAG, Log.DEBUG)
            ((ctx.applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE) != 0).also { debugToLogcat = it }
        }
        return debuggable || Log.isLoggable(DEBUG_TAG, Log.DEBUG)
    }

    /** The app's launcher icon as a bitmap: the notification and lock-screen artwork. */
    private fun appIcon(ctx: Context): Bitmap? {
        synchronized(lock) {
            appIconBitmap?.let { return it }
            val bitmap = runCatching {
                val drawable = ctx.packageManager.getApplicationIcon(ctx.applicationInfo)
                Bitmap.createBitmap(ARTWORK_SIZE_PX, ARTWORK_SIZE_PX, Bitmap.Config.ARGB_8888).also {
                    val canvas = Canvas(it)
                    drawable.setBounds(0, 0, canvas.width, canvas.height)
                    drawable.draw(canvas)
                }
            }.onFailure { Log.w(TAG, "app icon unavailable", it) }.getOrNull()
            appIconBitmap = bitmap
            return bitmap
        }
    }

    private fun playWhenReadyReasonName(reason: Int): String = when (reason) {
        Player.PLAY_WHEN_READY_CHANGE_REASON_USER_REQUEST -> "user"
        Player.PLAY_WHEN_READY_CHANGE_REASON_AUDIO_FOCUS_LOSS -> "audio-focus-loss"
        Player.PLAY_WHEN_READY_CHANGE_REASON_AUDIO_BECOMING_NOISY -> "becoming-noisy"
        Player.PLAY_WHEN_READY_CHANGE_REASON_REMOTE -> "remote"
        Player.PLAY_WHEN_READY_CHANGE_REASON_END_OF_MEDIA_ITEM -> "end-of-item"
        else -> reason.toString()
    }

    private fun playbackStateName(state: Int): String = when (state) {
        Player.STATE_IDLE -> "idle"
        Player.STATE_BUFFERING -> "buffering"
        Player.STATE_READY -> "ready"
        Player.STATE_ENDED -> "ended"
        else -> state.toString()
    }

    private fun playerCommandName(command: Int): String = when (command) {
        Player.COMMAND_PLAY_PAUSE -> "play/pause"
        Player.COMMAND_STOP -> "stop"
        Player.COMMAND_SEEK_BACK -> "seek-back"
        Player.COMMAND_SEEK_FORWARD -> "seek-forward"
        Player.COMMAND_SEEK_TO_PREVIOUS, Player.COMMAND_SEEK_TO_PREVIOUS_MEDIA_ITEM -> "previous"
        Player.COMMAND_SEEK_TO_NEXT, Player.COMMAND_SEEK_TO_NEXT_MEDIA_ITEM -> "next"
        Player.COMMAND_SEEK_IN_CURRENT_MEDIA_ITEM -> "seek"
        Player.COMMAND_PREPARE -> "prepare"
        else -> "command#$command"
    }

    private fun syncTicking() {
        synchronized(lock) {
            syncTickingLocked()
        }
    }

    private fun syncTickingLocked() {
        val isPlaying = player?.isPlaying == true
        if (isPlaying && !tickScheduled) {
            tickScheduled = true
            tickHandler.removeCallbacks(tickRunnable)
            tickHandler.post(tickRunnable)
            return
        }
        if (!isPlaying && tickScheduled) {
            tickScheduled = false
            tickHandler.removeCallbacks(tickRunnable)
        }
    }

    private fun nextProgressTickDelayLocked(): Long {
        val context = appContext ?: return BACKGROUND_PROGRESS_TICK_MS
        val isForeground = isAppInForeground()
        val isInteractive = isDeviceInteractive(context)
        return if (isForeground && isInteractive) FOREGROUND_PROGRESS_TICK_MS else BACKGROUND_PROGRESS_TICK_MS
    }

    private fun isAppInForeground(): Boolean {
        val processInfo = ActivityManager.RunningAppProcessInfo()
        ActivityManager.getMyMemoryState(processInfo)
        return processInfo.importance == ActivityManager.RunningAppProcessInfo.IMPORTANCE_FOREGROUND ||
            processInfo.importance == ActivityManager.RunningAppProcessInfo.IMPORTANCE_VISIBLE
    }

    private fun isDeviceInteractive(context: Context): Boolean {
        val powerManager = context.getSystemService(Context.POWER_SERVICE) as? PowerManager
        return powerManager?.isInteractive ?: true
    }

    private fun emitState() {
        val snapshot = synchronized(lock) { snapshotLocked() }
        NativeAudioPlugin.emitToActive(snapshot)
    }

    private fun progressPrefs(context: Context): SharedPreferences =
        context.getSharedPreferences(PROGRESS_PREFS_NAME, Context.MODE_PRIVATE)

    private fun persistProgressCheckpointLocked(context: Context, snapshot: NativeAudioState, force: Boolean) {
        val storyId = currentStoryId ?: return
        if (storyId <= 0L) return
        if (!snapshot.currentTime.isFinite() || snapshot.currentTime <= PROGRESS_NEAR_START_EPSILON_SEC) return

        val now = System.currentTimeMillis()
        if (!force && now - lastProgressPersistedAtMs < PROGRESS_PERSIST_THROTTLE_MS) return

        val prevStoryId = lastProgressPersistedStoryId
        val prevTime = lastProgressPersistedTimeSec
        if (!force && prevStoryId == storyId && prevTime != null && kotlin.math.abs(prevTime - snapshot.currentTime) <= PROGRESS_PERSIST_EPSILON_SEC) {
            return
        }

        progressPrefs(context).edit()
            .putLong(PROGRESS_KEY_STORY_ID, storyId)
            .putFloat(PROGRESS_KEY_CURRENT_TIME, snapshot.currentTime.toFloat())
            .putLong(PROGRESS_KEY_UPDATED_AT_MS, now)
            .putString(PROGRESS_KEY_STATUS, snapshot.status)
            .apply()

        lastProgressPersistedAtMs = now
        lastProgressPersistedStoryId = storyId
        lastProgressPersistedTimeSec = snapshot.currentTime
    }

    private fun buildMediaItem(src: String, title: String?, artist: String?, artworkUrl: String?): MediaItem {
        val metadataBuilder = MediaMetadata.Builder()
        if (!title.isNullOrBlank()) metadataBuilder.setTitle(title)
        if (!artist.isNullOrBlank()) metadataBuilder.setArtist(artist)
        if (!artworkUrl.isNullOrBlank()) {
            runCatching { Uri.parse(artworkUrl) }
                .onSuccess { metadataBuilder.setArtworkUri(it) }
        }
        return MediaItem.Builder()
            .setUri(src)
            .setMediaMetadata(metadataBuilder.build())
            .build()
    }

    private fun snapshotLocked(): NativeAudioState {
        val exoPlayer = player
            ?: return NativeAudioState(
                status = "idle",
                currentTime = 0.0,
                duration = 0.0,
                isPlaying = false,
                buffering = false,
                rate = 1.0,
                index = 0,
                error = null,
            )

        val rawDurationMs = exoPlayer.duration
        val durationMs = if (rawDurationMs > 0) rawDurationMs else 0L
        val currentMs = max(0L, exoPlayer.currentPosition)
        val buffering = exoPlayer.playbackState == Player.STATE_BUFFERING

        val seekState = activeSeekStateLocked()
        if (seekState?.shouldResume == true && exoPlayer.isPlaying) pendingSeekState = null

        val hasTerminalState = lastError != null || exoPlayer.playbackState == Player.STATE_ENDED
        if (hasTerminalState) pendingSeekState = null
        val effectiveIsPlaying = if (hasTerminalState) false else (seekState?.shouldResume ?: exoPlayer.isPlaying)
        val effectiveBuffering = if (hasTerminalState || seekState?.shouldResume == false) false else buffering

        val status = when {
            lastError != null -> "error"
            exoPlayer.playbackState == Player.STATE_ENDED -> "ended"
            seekState?.shouldResume == true -> "playing"
            effectiveBuffering -> "loading"
            effectiveIsPlaying -> "playing"
            else -> "idle"
        }

        return NativeAudioState(
            status = status,
            currentTime = currentMs / 1000.0,
            duration = durationMs / 1000.0,
            isPlaying = effectiveIsPlaying,
            buffering = effectiveBuffering,
            rate = exoPlayer.playbackParameters.speed.toDouble(),
            index = exoPlayer.currentMediaItemIndex,
            error = lastError,
        )
    }

    private fun activeSeekStateLocked(): PendingSeekState? {
        val seekState = pendingSeekState ?: return null
        val now = System.currentTimeMillis()
        if (now - seekState.startedAtMs > SEEK_STATE_STALE_MS) {
            pendingSeekState = null
            return null
        }
        return seekState
    }
}

/**
 * Media3's default bitmap loader, plus the app icon as artwork when a track has none of its own
 * (Bible chapters don't). The icon is produced here, per request, rather than put into every
 * MediaItem: a continuous-Bible queue holds about a thousand items, and embedding a bitmap in each
 * would ship megabytes to every controller.
 */
@OptIn(UnstableApi::class)
internal class AppIconBitmapLoader(
    private val delegate: BitmapLoader,
    private val appIcon: () -> Bitmap?,
) : BitmapLoader {
    override fun supportsMimeType(mimeType: String): Boolean = delegate.supportsMimeType(mimeType)

    override fun decodeBitmap(data: ByteArray): ListenableFuture<Bitmap> = delegate.decodeBitmap(data)

    override fun loadBitmap(uri: Uri): ListenableFuture<Bitmap> = delegate.loadBitmap(uri)

    override fun loadBitmapFromMetadata(metadata: MediaMetadata): ListenableFuture<Bitmap>? {
        delegate.loadBitmapFromMetadata(metadata)?.let { return it }
        val icon = appIcon() ?: return null
        return Futures.immediateFuture(icon)
    }
}

@TauriPlugin
class NativeAudioPlugin(private val activity: Activity) : Plugin(activity) {

    init {
        activeInstance = this
    }

    @Command
    fun initialize(invoke: Invoke) {
        requestNotificationPermission()
        runCatching {
            NativeAudioRuntime.initialize(activity.applicationContext)
        }.onSuccess {
            invoke.resolve(toJsObject(NativeAudioRuntime.getState(activity.applicationContext)))
        }.onFailure {
            invoke.reject(it.message ?: "initialize failed")
        }
    }

    @Command
    fun register_listener(invoke: Invoke) {
        invoke.resolve()
    }

    @Command
    fun remove_listener(invoke: Invoke) {
        invoke.resolve()
    }

    @Command
    fun setSource(invoke: Invoke) {
        val args = invoke.parseArgs(SetSourceArgs::class.java)
        val src = args.src?.trim().orEmpty()
        if (src.isEmpty()) {
            invoke.reject("src is required")
            return
        }

        runCatching {
            NativeAudioRuntime.setSource(activity.applicationContext, src, args.id, args.title, args.artist, args.artworkUrl)
        }.onSuccess {
            invoke.resolve(toJsObject(NativeAudioRuntime.getState(activity.applicationContext)))
        }.onFailure {
            invoke.reject(it.message ?: "setSource failed")
        }
    }

    @Command
    fun setQueue(invoke: Invoke) {
        val args = invoke.parseArgs(SetQueueArgs::class.java)
        val items = args.items.orEmpty().filter { !it.src.isNullOrBlank() }
        if (items.isEmpty()) {
            invoke.reject("items is required")
            return
        }
        runCatching {
            NativeAudioRuntime.setQueue(activity.applicationContext, items, args.startIndex ?: 0)
        }.onSuccess {
            invoke.resolve(toJsObject(NativeAudioRuntime.getState(activity.applicationContext)))
        }.onFailure {
            invoke.reject(it.message ?: "setQueue failed")
        }
    }

    @Command
    fun next(invoke: Invoke) {
        runCatching {
            NativeAudioRuntime.next(activity.applicationContext)
        }.onSuccess {
            invoke.resolve(toJsObject(NativeAudioRuntime.getState(activity.applicationContext)))
        }.onFailure {
            invoke.reject(it.message ?: "next failed")
        }
    }

    @Command
    fun previous(invoke: Invoke) {
        runCatching {
            NativeAudioRuntime.previous(activity.applicationContext)
        }.onSuccess {
            invoke.resolve(toJsObject(NativeAudioRuntime.getState(activity.applicationContext)))
        }.onFailure {
            invoke.reject(it.message ?: "previous failed")
        }
    }

    @Command
    fun play(invoke: Invoke) {
        runCatching {
            NativeAudioRuntime.play(activity.applicationContext)
        }.onSuccess {
            invoke.resolve(toJsObject(NativeAudioRuntime.getState(activity.applicationContext)))
        }.onFailure {
            invoke.reject(it.message ?: "play failed")
        }
    }

    @Command
    fun pause(invoke: Invoke) {
        runCatching {
            NativeAudioRuntime.pause(activity.applicationContext)
        }.onSuccess {
            invoke.resolve(toJsObject(NativeAudioRuntime.getState(activity.applicationContext)))
        }.onFailure {
            invoke.reject(it.message ?: "pause failed")
        }
    }

    @Command
    fun seekTo(invoke: Invoke) {
        val args = invoke.parseArgs(SeekToArgs::class.java)
        val position = args.position
        if (position == null || !position.isFinite()) {
            invoke.reject("position is required")
            return
        }

        runCatching {
            NativeAudioRuntime.seekTo(activity.applicationContext, position)
        }.onSuccess {
            invoke.resolve(toJsObject(NativeAudioRuntime.getState(activity.applicationContext)))
        }.onFailure {
            invoke.reject(it.message ?: "seekTo failed")
        }
    }

    @Command
    fun setRate(invoke: Invoke) {
        val args = invoke.parseArgs(SetRateArgs::class.java)
        val rate = args.rate
        if (rate == null || !rate.isFinite() || rate <= 0) {
            invoke.reject("rate must be > 0")
            return
        }

        runCatching {
            NativeAudioRuntime.setRate(activity.applicationContext, rate)
        }.onSuccess {
            invoke.resolve(toJsObject(NativeAudioRuntime.getState(activity.applicationContext)))
        }.onFailure {
            invoke.reject(it.message ?: "setRate failed")
        }
    }

    @Command
    fun getState(invoke: Invoke) {
        runCatching {
            NativeAudioRuntime.getState(activity.applicationContext)
        }.onSuccess {
            invoke.resolve(toJsObject(it))
        }.onFailure {
            invoke.reject(it.message ?: "getState failed")
        }
    }

    @Command
    fun getProgressCheckpoint(invoke: Invoke) {
        runCatching {
            NativeAudioRuntime.getProgressCheckpoint(activity.applicationContext)
        }.onSuccess {
            invoke.resolve(it?.let { checkpoint -> toJsObject(checkpoint) })
        }.onFailure {
            invoke.reject(it.message ?: "getProgressCheckpoint failed")
        }
    }

    @Command
    fun clearProgressCheckpoint(invoke: Invoke) {
        runCatching {
            NativeAudioRuntime.clearProgressCheckpoint(activity.applicationContext)
        }.onSuccess {
            invoke.resolve()
        }.onFailure {
            invoke.reject(it.message ?: "clearProgressCheckpoint failed")
        }
    }

    /** Recent audio events (commands, media buttons, service lifecycle) for bug reports. */
    @Command
    fun getDebugLog(invoke: Invoke) {
        val payload = JSObject()
        payload.put("lines", org.json.JSONArray(NativeAudioRuntime.debugLogLines()))
        invoke.resolve(payload)
    }

    @Command
    fun dispose(invoke: Invoke) {
        runCatching {
            NativeAudioRuntime.dispose(activity.applicationContext)
        }.onSuccess {
            invoke.resolve()
        }.onFailure {
            invoke.reject(it.message ?: "dispose failed")
        }
    }

    override fun onDestroy() {
        if (activeInstance === this) activeInstance = null
        super.onDestroy()
    }

    private fun requestNotificationPermission() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return
        if (ContextCompat.checkSelfPermission(activity, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED) return
        ActivityCompat.requestPermissions(
            activity,
            arrayOf(Manifest.permission.POST_NOTIFICATIONS),
            NOTIFICATION_PERMISSION_REQUEST_CODE,
        )
    }

    private fun emitState(state: NativeAudioState) {
        val payload = toJsObject(state)
        activity.runOnUiThread {
            trigger(EVENT_STATE, payload)
        }
    }

    private fun toJsObject(state: NativeAudioState): JSObject {
        val payload = JSObject()
        payload.put("status", state.status)
        payload.put("currentTime", state.currentTime)
        payload.put("duration", state.duration)
        payload.put("isPlaying", state.isPlaying)
        payload.put("buffering", state.buffering)
        payload.put("rate", state.rate)
        payload.put("index", state.index)
        payload.put("capturedAtMs", state.capturedAtMs)
        if (!state.error.isNullOrBlank()) payload.put("error", state.error)
        return payload
    }

    private fun toJsObject(checkpoint: NativeAudioProgressCheckpoint): JSObject {
        val payload = JSObject()
        payload.put("id", checkpoint.id)
        payload.put("currentTime", checkpoint.currentTime)
        payload.put("updatedAtMs", checkpoint.updatedAtMs)
        if (!checkpoint.status.isNullOrBlank()) payload.put("status", checkpoint.status)
        return payload
    }

    companion object {
        @Volatile
        private var activeInstance: NativeAudioPlugin? = null

        internal fun emitToActive(state: NativeAudioState) {
            activeInstance?.emitState(state)
        }
    }
}
