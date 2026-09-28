package app.tauri.nativeaudio

import android.Manifest
import android.app.Activity
import android.app.PendingIntent
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.ServiceConnection
import android.content.pm.ApplicationInfo
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.Canvas
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.IBinder
import android.os.Looper
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
import androidx.media3.common.util.Util
import androidx.media3.datasource.DataSourceBitmapLoader
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.session.CacheBitmapLoader
import androidx.media3.session.CommandButton
import androidx.media3.session.MediaLibraryService.MediaLibrarySession
import androidx.media3.session.MediaSession
import androidx.media3.session.MediaSessionService
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import com.google.common.collect.ImmutableList
import com.google.common.util.concurrent.Futures
import com.google.common.util.concurrent.ListenableFuture
import kotlin.math.max

private const val TAG = "plugin/native-audio"
private const val EVENT_STATE = "native_audio_state"
private const val NOTIFICATION_PERMISSION_REQUEST_CODE = 9512
/**
 * While the app is on screen and something plays, a state event every half second: the UI
 * shows time to the second, and the scrubber moves smoothly enough at this rate. (Upstream
 * ticked every 25 ms, which woke the WebView and re-rendered React 40 times a second.)
 */
internal const val FOREGROUND_PROGRESS_TICK_MS = 500L
/**
 * While the app is not visible nothing is sent on a timer: a frozen WebView would only queue
 * the events up, and JS re-reads the state when it becomes visible. The tick still runs this
 * often to save the Continue-listening position.
 */
internal const val BACKGROUND_PROGRESS_TICK_MS = 5_000L
private const val SEEK_INCREMENT_MS = 10_000L
private const val SEEK_STATE_STALE_MS = 1_500L
// Turn on logcat output in a release build with: adb shell setprop log.tag.BoLAudio DEBUG
private const val DEBUG_TAG = "BoLAudio"
private const val DEBUG_LOG_CAPACITY = 300
private const val ARTWORK_SIZE_PX = 256
private const val LAST_PLAYED_THROTTLE_MS = 5_000L
/** The sleep timer fades the volume out over this long before it pauses (as the app does). */
internal const val SLEEP_FADE_MS = 10_000L
/** How often the sleep timer adjusts the volume during the fade. */
private const val SLEEP_FADE_STEP_MS = 250L
/** Before the fade, the longest the sleep timer waits between checks. A chapter's end moves
 *  with seeks and speed changes, so it is looked at again rather than scheduled once. */
private const val SLEEP_CHECK_MAX_MS = 5_000L

/**
 * The sleep timer: pause at a time, at the end of the current item, or at the end of the
 * current reading (the last item of its reading group). See [NativeAudioRuntime.setSleepTimer].
 */
internal sealed class SleepTimer {
    /** Pause at [deadlineElapsedMs] ([SystemClock.elapsedRealtime]); [minutes] labels the car's button. */
    data class At(val deadlineElapsedMs: Long, val minutes: Int) : SleepTimer()
    object EndOfItem : SleepTimer()
    object EndOfGroup : SleepTimer()
}

/** The sleep timer as the state event reports it. */
data class SleepTimerState(
    /** "time", "item" or "group". */
    val mode: String,
    /** "time" only: when playback pauses, in wall-clock ms. */
    val endsAtEpochMs: Long? = null,
    /** How long until the pause, when known. */
    val remainingMs: Long? = null,
)

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
    /** Bumped whenever the queue is replaced, by the app or from outside it (the car). */
    val queueGeneration: Long = 0,
    /**
     * "app" when the app loaded the queue, "external" when anything else did through the
     * session: Android Auto, a voice request, the system's resume card, an earphone press
     * that resumed the last chapter. (Called "car" before v0.4.1; the app accepts both.)
     */
    val queueOrigin: String = "app",
    /** Plan chapters and devotionals heard to the end that the app has not collected yet. */
    val pendingCompletions: Int = 0,
    /**
     * Indexes of the current queue that played to their NATURAL end (an AUTO transition, or
     * the end of the playlist), in the order they finished. A skip — the app's next, the car's
     * Next or "Next reading", the lock screen's buttons — moves the index without adding here,
     * so the app never takes reaching a chapter as having heard the ones before it. Covers the
     * whole queue generation, so a run of chapters heard while the WebView was frozen reaches
     * the app complete in whichever event it sees next.
     */
    val finished: List<Int> = emptyList(),
    /** The sleep timer, or null when none is set. */
    val sleepTimer: SleepTimerState? = null,
)

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
    var title: String? = null
    var artist: String? = null
    var artworkUrl: String? = null
    /** "ch/JHN/3" or "plan/<plan>/<day>/<reading>/<book>/<chapter>" (see MediaIds). Optional:
     *  a Bible narration URL is recognised without it. */
    var mediaId: String? = null
    /** Plan day only: which of the day's readings this chapter belongs to. */
    var group: Int? = null
}

@InvokeArg
class CarSnapshotArgs {
    var json: String? = null
}

@InvokeArg
class AckCompletionsArgs {
    var upTo: Long? = null
}

@InvokeArg
class SkipToArgs {
    var index: Int? = null
    /** Where in the item to start, in seconds (a Missler chapter that starts mid-file). */
    var positionSec: Double? = null
    /** The queue the app believes is loaded; a skip into any other queue is refused. */
    var queueGeneration: Long? = null
}

@InvokeArg
class SetSleepTimerArgs {
    /** Pause at this wall-clock time (ms since the epoch). */
    var atEpochMs: Long? = null
    /** Pause at the end of the current item. */
    var endOfItem: Boolean? = null
    /** Pause at the end of the current reading (its reading group). */
    var endOfGroup: Boolean? = null
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
    private var mediaSession: MediaLibrarySession? = null
    private var carLibrary: CarLibrary? = null
    private var queueGeneration = 0L
    private var queueOrigin = "app"
    /** See [NativeAudioState.finished]. Cleared with every new queue. */
    private val finishedIndexes = LinkedHashSet<Int>()
    /** The item now current, and whether it has actually started playing (for Recent). */
    private var currentItemId: String? = null
    private var recordedStartOf: String? = null
    private var lastPlayedPersistedAtMs = 0L
    private var mediaSessionPlayer: Player? = null
    private var lastError: String? = null
    private var pendingSeekState: PendingSeekState? = null

    /** The sleep timer, and its check on the main looper (see [sleepCheck]). */
    private var sleepTimer: SleepTimer? = null
    /** The index of the item the sleep timer paused at the end of: recorded as heard when
     *  it paused, so the AUTO transition that follows the next play does not record it again. */
    private var sleepCompletedIndex: Int? = null
    private val sleepRunnable = Runnable { sleepCheck() }

    /**
     * Whether the app's activity is on screen, from the plugin's lifecycle callbacks (see
     * [NativeAudioPlugin.onResume] / [NativeAudioPlugin.onStop]). Only then does the progress
     * tick send state events. Cheaper than asking ActivityManager and PowerManager on every
     * tick, which is what upstream did.
     */
    @Volatile
    private var appVisible = false

    private val tickRunnable = object : Runnable {
        override fun run() {
            val (snapshot, delay) = synchronized(lock) {
                persistLastPlayedLocked(force = false)
                val isPlaying = player?.isPlaying == true
                tickScheduled = isPlaying
                val visible = appVisible
                Pair(
                    if (isPlaying && visible) snapshotLocked() else null,
                    if (!isPlaying) -1L else if (visible) FOREGROUND_PROGRESS_TICK_MS else BACKGROUND_PROGRESS_TICK_MS,
                )
            }
            snapshot?.let { NativeAudioPlugin.emitToActive(it) }
            if (delay >= 0) tickHandler.postDelayed(this, delay)
        }
    }

    private val playerListener = object : Player.Listener {
        override fun onPlayWhenReadyChanged(playWhenReady: Boolean, reason: Int) {
            debugLog("player", "playWhenReady=$playWhenReady reason=${playWhenReadyReasonName(reason)}")
            // The sleep timer's end of item (or reading): Media3 paused at the item's end.
            if (!playWhenReady && reason == Player.PLAY_WHEN_READY_CHANGE_REASON_END_OF_MEDIA_ITEM) {
                onSleepPausedAtEndOfItem()
            }
        }

        override fun onPlaybackSuppressionReasonChanged(playbackSuppressionReason: Int) {
            // Non-zero = playWhenReady is true but audio is held back (e.g. transient focus loss).
            debugLog("player", "suppressionReason=$playbackSuppressionReason")
        }

        override fun onPlaybackStateChanged(playbackState: Int) {
            debugLog("player", "playbackState=${playbackStateName(playbackState)}")
            if (playbackState == Player.STATE_ENDED) {
                val hadSleepTimer = synchronized(lock) {
                    // The last chapter of the queue finished.
                    player?.let { p ->
                        val index = p.currentMediaItemIndex
                        if (index != sleepCompletedIndex) p.currentMediaItem?.let { recordCompletionLocked(it) }
                        if (index >= 0) finishedIndexes.add(index)
                    }
                    persistLastPlayedLocked(force = true)
                    // Nothing is left to pause: the timer is done.
                    (sleepTimer != null).also { if (it) clearSleepTimerLocked("queue ended") }
                }
                if (hadSleepTimer) sleepTimerChanged()
            }
            syncTicking()
            emitState()
        }

        override fun onMediaItemTransition(mediaItem: MediaItem?, reason: Int) {
            // ExoPlayer moved to another playlist item — tell JS so it can update the
            // mini-player (and, for a natural end, mark the finished chapter read).
            synchronized(lock) {
                // The chapter before this one ran to its end (not a skip): heard. Every other
                // reason (SEEK: a skip from anywhere; PLAYLIST_CHANGED: a new queue) is not.
                if (reason == Player.MEDIA_ITEM_TRANSITION_REASON_AUTO) {
                    val exo = player
                    val previousIndex = exo?.let { it.currentMediaItemIndex - 1 }?.takeIf { it >= 0 }
                    if (exo != null && previousIndex != null && previousIndex < exo.mediaItemCount) {
                        finishedIndexes.add(previousIndex)
                        // Already recorded when the sleep timer paused at its end.
                        if (previousIndex != sleepCompletedIndex) recordCompletionLocked(exo.getMediaItemAt(previousIndex))
                    }
                }
                sleepCompletedIndex = null
                // End of reading: pause at the end of this item only if it ends the reading.
                applyPauseAtEndLocked()
                currentItemId = mediaItem?.mediaId
                if (player?.isPlaying == true) recordStartLocked()
                persistLastPlayedLocked(force = true)
            }
            syncTicking()
            emitState()
        }

        override fun onIsPlayingChanged(isPlaying: Boolean) {
            debugLog("player", "isPlaying=$isPlaying serviceRunning=${synchronized(lock) { serviceRunning }}")
            synchronized(lock) {
                if (isPlaying) recordStartLocked() else persistLastPlayedLocked(force = true)
            }
            syncTicking()
            emitState()
        }

        override fun onPlaybackParametersChanged(playbackParameters: androidx.media3.common.PlaybackParameters) {
            // The speed button shows the current speed.
            refreshCustomLayout()
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

            // Speech, not music: with a "may duck" focus loss (a Maps prompt in the car, a
            // notification sound) ExoPlayer pauses spoken content instead of lowering it, so
            // the listener does not lose words under the prompt (AudioFocusManager's
            // willPauseWhenDucked checks exactly this content type).
            val audioAttributes = AudioAttributes.Builder()
                .setUsage(C.USAGE_MEDIA)
                .setContentType(C.AUDIO_CONTENT_TYPE_SPEECH)
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

                // A queue set through the session came from outside the app: Android Auto, a
                // voice request, the system's resume card. The app's own queues go straight
                // to ExoPlayer (setQueue/setSource below) and never pass through here.
                override fun setMediaItems(mediaItems: MutableList<MediaItem>) {
                    onExternalQueue(mediaItems.size)
                    super.setMediaItems(mediaItems)
                }

                override fun setMediaItems(mediaItems: MutableList<MediaItem>, resetPosition: Boolean) {
                    onExternalQueue(mediaItems.size)
                    super.setMediaItems(mediaItems, resetPosition)
                }

                override fun setMediaItems(mediaItems: MutableList<MediaItem>, startIndex: Int, startPositionMs: Long) {
                    onExternalQueue(mediaItems.size)
                    super.setMediaItems(mediaItems, startIndex, startPositionMs)
                }

                override fun setMediaItem(mediaItem: MediaItem) {
                    onExternalQueue(1)
                    super.setMediaItem(mediaItem)
                }

                override fun setMediaItem(mediaItem: MediaItem, resetPosition: Boolean) {
                    onExternalQueue(1)
                    super.setMediaItem(mediaItem, resetPosition)
                }

                override fun setMediaItem(mediaItem: MediaItem, startPositionMs: Long) {
                    onExternalQueue(1)
                    super.setMediaItem(mediaItem, startPositionMs)
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

                // Earphones and the lock screen: previous/next nudge 10 s (a double-tap on an
                // earphone must not lose the chapter). In the car the same buttons are the big
                // on-screen skip buttons, where a listener expects the previous/next chapter.
                override fun seekToPrevious() {
                    if (isCarRequest()) stepPrevious(exoPlayer) else exoPlayer.seekBack()
                }

                override fun seekToPreviousMediaItem() {
                    if (isCarRequest()) stepPrevious(exoPlayer) else exoPlayer.seekBack()
                }

                override fun seekToNext() {
                    if (isCarRequest()) stepNext(exoPlayer) else exoPlayer.seekForward()
                }

                override fun seekToNextMediaItem() {
                    if (isCarRequest()) stepNext(exoPlayer) else exoPlayer.seekForward()
                }
            }

            val launchIntent = ctx.packageManager.getLaunchIntentForPackage(ctx.packageName)
            val pendingIntent = launchIntent?.let {
                val flags = PendingIntent.FLAG_UPDATE_CURRENT or
                    (if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) PendingIntent.FLAG_IMMUTABLE else 0)
                PendingIntent.getActivity(ctx, 0, it, flags)
            }

            val library = CarLibrary(ctx, PlaybackStore(ctx))
            carLibrary = library
            val sessionPlayer = mediaSessionPlayer ?: exoPlayer
            // A library session: the same session the phone, lock screen and earphones use, plus
            // the browse tree Android Auto shows (see CarLibrary). Built from a Context, not the
            // service, because it outlives any one service instance (see NativeAudioService).
            mediaSession = MediaLibrarySession.Builder(ctx, sessionPlayer, LibrarySessionCallback { synchronized(lock) { carLibrary } })
                .setBitmapLoader(AppIconBitmapLoader(CacheBitmapLoader(DataSourceBitmapLoader(ctx))) { appIcon(ctx) })
                .setCustomLayout(SessionCommands.layout(exoPlayer.playbackParameters.speed, sleepLabelLocked()))
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

    /** Drop our binding so the service can stop (the app's stop, or the app swiped away while paused). */
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

    // Load a whole PLAYLIST so ExoPlayer advances chapter→chapter itself — no JS needed,
    // which is what makes it seamless when the app is backgrounded (the WebView/JS freezes).
    fun setQueue(context: Context, items: List<QueueItemArg>, startIndex: Int) {
        synchronized(lock) {
            ensure(context)
            val exoPlayer = player ?: return
            val mediaItems = items
                .filter { !it.src.isNullOrBlank() }
                .map { buildMediaItem(it.src!!.trim(), it.title, it.artist, it.artworkUrl, it.mediaId, it.group) }
            if (mediaItems.isEmpty()) return
            pendingSeekState = null
            onAppQueueLocked()
            val start = startIndex.coerceIn(0, mediaItems.size - 1)
            exoPlayer.setMediaItems(mediaItems, start, 0L)
            exoPlayer.prepare()
            lastError = null
            ensureServiceBoundLocked(context)
            syncTickingLocked()
        }
        emitState()
    }

    /**
     * Jump to [index] of the loaded queue and play: the app's Now Playing list and "Next
     * reading". A seek within the playlist, so Media3 reports a SEEK transition and nothing
     * skipped over counts as heard. Refused (false) when the app's idea of the queue is out
     * of date ([expectedGeneration] is not the loaded one) or the index is out of range; the
     * app then hands over the whole queue again with [setQueue].
     */
    fun skipTo(context: Context, index: Int, positionSec: Double, expectedGeneration: Long?): Boolean {
        synchronized(lock) {
            ensure(context)
            val exoPlayer = player ?: return false
            if (expectedGeneration != null && expectedGeneration != queueGeneration) return false
            if (index !in 0 until exoPlayer.mediaItemCount) return false
            pendingSeekState = null
            val startMs = if (positionSec.isFinite() && positionSec > 0.0) (positionSec * 1000.0).toLong() else 0L
            exoPlayer.seekTo(index, startMs)
            Util.handlePlayButtonAction(mediaSessionPlayer ?: exoPlayer)
            ensureServiceBoundLocked(context)
            syncTickingLocked()
        }
        emitState()
        return true
    }

    fun next(@Suppress("UNUSED_PARAMETER") context: Context) {
        synchronized(lock) { player?.let { stepNext(it) } }
        emitState()
    }

    fun previous(@Suppress("UNUSED_PARAMETER") context: Context) {
        synchronized(lock) { player?.let { stepPrevious(it) } }
        emitState()
    }

    /** The next chapter: the app's Next and the car's skip button. */
    private fun stepNext(exoPlayer: Player) {
        if (exoPlayer.hasNextMediaItem()) exoPlayer.seekToNextMediaItem()
    }

    /** Back to the start of this chapter when more than 3 s in, else the previous chapter. */
    private fun stepPrevious(exoPlayer: Player) {
        if (exoPlayer.currentPosition > 3000L || !exoPlayer.hasPreviousMediaItem()) exoPlayer.seekTo(0L)
        else exoPlayer.seekToPreviousMediaItem()
    }

    /**
     * The app's Play button. Goes through the same wrapper as every other play command, and
     * through the same [Util.handlePlayButtonAction] Media3 uses for the lock screen and
     * earphones: after a playback error (the phone left Wi-Fi and ExoPlayer's retries gave up)
     * the player is idle, and only a `prepare()` loads the item again. A bare `play()` there
     * set play-when-ready and nothing happened.
     */
    fun play(context: Context) {
        synchronized(lock) {
            ensure(context)
            val exoPlayer = player ?: return
            Util.handlePlayButtonAction(mediaSessionPlayer ?: exoPlayer)
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
            persistLastPlayedLocked(force = true)
        }
        emitState()
    }

    /**
     * The app closed its player (the mini-player's ✕). Unload the queue, not just pause it:
     * otherwise an earphone or lock-screen press played it again with no player in the app.
     * Continue listening keeps the position; the queue generation moves on so the app's
     * stale indexes mean nothing; and the service binding goes, so Android can stop the
     * service. The session stays, so a later earphone press still reaches it, and Media3
     * then asks [LibrarySessionCallback.onPlaybackResumption] what to play (Continue
     * listening), which the app adopts as an external queue.
     */
    fun stop(context: Context) {
        synchronized(lock) {
            val exoPlayer = player ?: return@synchronized
            persistLastPlayedLocked(force = true)
            pendingSeekState = null
            lastError = null
            exoPlayer.stop()
            exoPlayer.clearMediaItems()
            onAppQueueLocked()
            syncTickingLocked()
        }
        releaseServiceBinding(context)
        runCatching { stopService(context) }.onFailure { Log.w(TAG, "stopService failed", it) }
        debugLog("command", "stop")
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

    /**
     * The current state. Does NOT build the player: the app asks at start whether anything is
     * already playing (the car, or the service outliving an earlier app session), and a
     * session that never plays should not create ExoPlayer and the media session for that.
     */
    fun getState(@Suppress("UNUSED_PARAMETER") context: Context): NativeAudioState {
        synchronized(lock) {
            return snapshotLocked()
        }
    }

    /** Tear everything down. Tests only: the app never releases the player it may need again. */
    internal fun dispose(context: Context) {
        synchronized(lock) {
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
            sleepTimer = null
            sleepCompletedIndex = null
            tickHandler.removeCallbacks(sleepRunnable)
            carLibrary = null
            currentItemId = null
            recordedStartOf = null
            appContext = null
        }
        releaseServiceBinding(context)
        stopService(context)
        emitState()
    }

    /** The activity came on screen or went off it (see [appVisible]). */
    fun setAppVisible(visible: Boolean) {
        if (appVisible == visible) return
        appVisible = visible
        if (!visible) return
        // Back on screen: send the state now and tick at the foreground rate from here.
        tickHandler.post {
            synchronized(lock) {
                tickHandler.removeCallbacks(tickRunnable)
                tickScheduled = false
                syncTickingLocked()
            }
            emitState()
        }
    }

    internal fun isAppVisible(): Boolean = appVisible

    fun mediaSession(): MediaLibrarySession? {
        synchronized(lock) {
            return mediaSession
        }
    }

    fun mediaSessionPlayer(): Player? {
        synchronized(lock) {
            return mediaSessionPlayer ?: player
        }
    }

    private fun currentController(): String {
        val session = mediaSession ?: return "app"
        val controller = runCatching { session.controllerForCurrentRequest }.getOrNull() ?: return "app"
        return describe(session, controller)
    }

    internal fun describe(session: MediaSession, controller: MediaSession.ControllerInfo): String {
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

    internal fun mediaKeyName(keyCode: Int): String = when (keyCode) {
        KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE -> "PLAY_PAUSE"
        KeyEvent.KEYCODE_HEADSETHOOK -> "HEADSETHOOK"
        KeyEvent.KEYCODE_MEDIA_PLAY -> "PLAY"
        KeyEvent.KEYCODE_MEDIA_PAUSE -> "PAUSE"
        KeyEvent.KEYCODE_MEDIA_STOP -> "STOP"
        KeyEvent.KEYCODE_MEDIA_NEXT -> "NEXT"
        KeyEvent.KEYCODE_MEDIA_PREVIOUS -> "PREVIOUS"
        KeyEvent.KEYCODE_MEDIA_FAST_FORWARD -> "FAST_FORWARD"
        KeyEvent.KEYCODE_MEDIA_REWIND -> "REWIND"
        else -> "key#$keyCode"
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

    internal fun playerCommandName(command: Int): String = when (command) {
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

    private fun emitState() {
        val snapshot = synchronized(lock) { snapshotLocked() }
        NativeAudioPlugin.emitToActive(snapshot)
    }

    /**
     * A queue item from the app. Every Bible chapter gets a media id ("ch/JHN/3", or the plan
     * id the app sent) so Recent, Continue listening and the car's queue can name it, and its
     * amber tile as artwork unless the app sent artwork of its own.
     */
    private fun buildMediaItem(src: String, title: String?, artist: String?, artworkUrl: String?, mediaId: String?, group: Int?): MediaItem {
        val metadataBuilder = MediaMetadata.Builder()
        if (!title.isNullOrBlank()) metadataBuilder.setTitle(title)
        if (!artist.isNullOrBlank()) {
            metadataBuilder.setArtist(artist)
            metadataBuilder.setSubtitle(artist)
        }
        val chapter = MediaIds.chapterOf(mediaId)
            ?: BibleCatalog.parseAudioUrl(src)?.let { it.ho to it.chapter }
        val id = mediaId?.takeIf { MediaIds.parse(it) != null }
            ?: chapter?.let { (ho, c) -> MediaIds.chapter(ho, c) }
        if (!artworkUrl.isNullOrBlank()) {
            runCatching { Uri.parse(artworkUrl) }
                .onSuccess { metadataBuilder.setArtworkUri(it) }
        } else {
            val ctx = appContext
            if (ctx != null && chapter != null) metadataBuilder.setArtworkUri(ArtworkTiles.chapterUri(ctx, chapter.first, chapter.second))
        }
        if (group != null) metadataBuilder.setExtras(Bundle().apply { putInt(CarLibrary.EXTRA_READING_GROUP, group) })
        return MediaItem.Builder()
            .setUri(src)
            .apply { if (id != null) setMediaId(id) }
            .setMediaMetadata(metadataBuilder.build())
            .build()
    }

    /* -------------------------------- Android Auto -------------------------------- */

    private fun onAppQueueLocked() {
        queueGeneration++
        queueOrigin = "app"
        finishedIndexes.clear()
        currentItemId = null
        recordedStartOf = null
        // A new queue (or the app's stop) ends any sleep timer.
        if (sleepTimer != null) {
            clearSleepTimerLocked("new queue")
            tickHandler.post { refreshCustomLayout() }
        }
        sleepCompletedIndex = null
    }

    /** A queue arrived through the session (the car, a voice request, the resume card). */
    private fun onExternalQueue(count: Int) {
        synchronized(lock) {
            queueGeneration++
            queueOrigin = "external"
            finishedIndexes.clear()
            pendingSeekState = null
            lastError = null
            currentItemId = null
            recordedStartOf = null
            sleepCompletedIndex = null
            if (sleepTimer != null) {
                clearSleepTimerLocked("new queue")
                tickHandler.post { refreshCustomLayout() }
            }
            appContext?.let { ensureServiceBoundLocked(it) }
            debugLog("queue", "external queue of $count from=${currentController()}")
        }
        tickHandler.post { emitState() }
    }

    /** Is the command being handled from Android Auto (or a car's own media system)? */
    private fun isCarRequest(): Boolean {
        val session = mediaSession ?: return false
        val controller = runCatching { session.controllerForCurrentRequest }.getOrNull() ?: return false
        return session.isAutoCompanionController(controller) || session.isAutomotiveController(controller)
    }

    /** The current item has started playing: put it at the top of Recent. */
    private fun recordStartLocked() {
        val exo = player ?: return
        val item = exo.currentMediaItem ?: return
        val id = item.mediaId.takeIf { MediaIds.parse(it) != null } ?: return
        if (recordedStartOf == id) return
        recordedStartOf = id
        val src = item.localConfiguration?.uri?.toString()?.takeIf { it.isStreamable() } ?: return
        carLibrary?.store?.addRecent(
            PlayedItem(id, item.mediaMetadata.title?.toString().orEmpty(), item.mediaMetadata.artist?.toString().orEmpty(), src, 0L, System.currentTimeMillis()),
        )
        notifyLibraryChanged(MediaIds.TAB_RECENT)
    }

    /** Where playback is, for Continue listening (every few seconds while playing). */
    private fun persistLastPlayedLocked(force: Boolean) {
        val exo = player ?: return
        val store = carLibrary?.store ?: return
        val item = exo.currentMediaItem ?: return
        val id = item.mediaId.takeIf { MediaIds.parse(it) != null } ?: return
        val src = item.localConfiguration?.uri?.toString()?.takeIf { it.isStreamable() } ?: return
        val now = System.currentTimeMillis()
        if (!force && now - lastPlayedPersistedAtMs < LAST_PLAYED_THROTTLE_MS) return
        lastPlayedPersistedAtMs = now
        val ended = exo.playbackState == Player.STATE_ENDED
        store.setLastPlayed(
            PlayedItem(id, item.mediaMetadata.title?.toString().orEmpty(), item.mediaMetadata.artist?.toString().orEmpty(), src,
                if (ended) 0L else max(0L, exo.currentPosition), now),
        )
    }

    /**
     * An item played to its end. A plan chapter or a devotional is queued here for the app to
     * record, whoever loaded the queue: the app may be gone (swiped away, the activity destroyed
     * while the service plays on), frozen in the background, or looking after a queue it adopted
     * from the car and has since replaced. The app records each one idempotently, so one it also
     * marked itself does no harm. It collects them when a state event says some are waiting
     * (every event carries the count) and at its next start.
     */
    private fun recordCompletionLocked(item: MediaItem) {
        val store = carLibrary?.store ?: return
        when (val parsed = MediaIds.parse(item.mediaId)) {
            is MediaIds.Parsed.PlanTrack -> {
                store.addCompletion(parsed, item.mediaId)
                store.markTodayTrackDone(parsed.planId, parsed.day, parsed.readingIndex)
                notifyLibraryChanged(MediaIds.TAB_TODAY)
            }
            is MediaIds.Parsed.Devotional -> store.addDevotionalCompletion(parsed, item.mediaId)
            else -> return
        }
        debugLog("queue", "completed ${item.mediaId} (for the app)")
    }

    private fun notifyLibraryChanged(parentId: String) {
        val session = synchronized(lock) { mediaSession } ?: return
        val count = carLibrary?.children(parentId)?.size ?: return
        tickHandler.post { runCatching { session.notifyChildrenChanged(parentId, count, null) } }
    }

    /** Back [ms] in the current chapter (the car's "back 30 seconds"). */
    fun seekBackBy(ms: Long): Boolean {
        synchronized(lock) {
            val exo = player ?: return false
            exo.seekTo(max(0L, exo.currentPosition - ms))
        }
        emitState()
        return true
    }

    /**
     * Skip to the next of the day's readings (all the chapters of "Genesis 1–3" at once), or to
     * the next chapter when the queue is not a plan day.
     */
    fun nextReading(): Boolean {
        synchronized(lock) {
            val exo = player ?: return false
            val index = exo.currentMediaItemIndex
            val count = exo.mediaItemCount
            val groupOf = { i: Int -> exo.getMediaItemAt(i).mediaMetadata.extras?.let { if (it.containsKey(CarLibrary.EXTRA_READING_GROUP)) it.getInt(CarLibrary.EXTRA_READING_GROUP) else null } }
            val current = if (index in 0 until count) groupOf(index) else null
            var target = -1
            if (current != null) {
                for (i in index + 1 until count) if (groupOf(i) != current) { target = i; break }
            } else if (index + 1 < count) {
                target = index + 1
            }
            if (target < 0) return false
            exo.seekTo(target, 0L)
        }
        emitState()
        return true
    }

    /* --------------------------------- sleep timer --------------------------------- */

    /**
     * Start, replace or (all arguments empty) cancel the sleep timer: pause at [atEpochMs], at
     * the end of the current item, or at the end of the current reading. The last
     * [SLEEP_FADE_MS] fade out through the player's volume, and playback then PAUSES, so Play
     * carries on. A Handler on the main looper runs it; while something plays, the service is
     * in the foreground and ExoPlayer holds a wake lock, so it fires with the app in the
     * background or the screen off. Cleared by stop and by any new queue.
     */
    fun setSleepTimer(@Suppress("UNUSED_PARAMETER") context: Context, atEpochMs: Long?, endOfItem: Boolean, endOfGroup: Boolean) {
        synchronized(lock) {
            clearSleepTimerLocked(null)
            if (player == null) return@synchronized
            sleepTimer = when {
                atEpochMs != null -> {
                    val delay = max(0L, atEpochMs - System.currentTimeMillis())
                    SleepTimer.At(SystemClock.elapsedRealtime() + delay, ((delay + 30_000L) / 60_000L).toInt())
                }
                endOfItem -> SleepTimer.EndOfItem
                endOfGroup -> SleepTimer.EndOfGroup
                else -> null
            }
            applyPauseAtEndLocked()
            debugLog("sleep", "set ${describeSleepLocked()}")
        }
        sleepTimerChanged()
    }

    /** The car's sleep button: off → 15 min → 30 min → end of chapter → off. */
    fun cycleSleepTimer(): Boolean {
        val now = synchronized(lock) {
            if (player == null) return false
            sleepTimer
        }
        val next: Pair<Long?, Boolean> = when (now) {
            null -> System.currentTimeMillis() + 15 * 60_000L to false
            is SleepTimer.At -> if (now.minutes <= 15) System.currentTimeMillis() + 30 * 60_000L to false else null to true
            else -> null to false
        }
        appContext?.let { setSleepTimer(it, next.first, next.second, false) }
        return true
    }

    /** Clear the timer and put the volume back; [why] (when not null) goes to the debug log. */
    private fun clearSleepTimerLocked(why: String?) {
        val had = sleepTimer != null
        sleepTimer = null
        tickHandler.removeCallbacks(sleepRunnable)
        player?.let {
            it.pauseAtEndOfMediaItems = false
            if (it.volume != 1f) it.volume = 1f
        }
        if (had && why != null) debugLog("sleep", "cleared: $why")
    }

    /** After any change: check the timer now, update the car's button, tell the app. */
    private fun sleepTimerChanged() {
        tickHandler.removeCallbacks(sleepRunnable)
        if (synchronized(lock) { sleepTimer } != null) tickHandler.post(sleepRunnable)
        refreshCustomLayout()
        emitState()
    }

    /** End of item always, end of reading only on the reading's last item. */
    private fun applyPauseAtEndLocked() {
        val exo = player ?: return
        val want = when (sleepTimer) {
            SleepTimer.EndOfItem -> true
            SleepTimer.EndOfGroup -> isLastOfGroupLocked(exo)
            else -> false
        }
        if (exo.pauseAtEndOfMediaItems != want) exo.pauseAtEndOfMediaItems = want
    }

    private fun groupAt(exo: Player, i: Int): Int? =
        exo.getMediaItemAt(i).mediaMetadata.extras?.let { if (it.containsKey(CarLibrary.EXTRA_READING_GROUP)) it.getInt(CarLibrary.EXTRA_READING_GROUP) else null }

    /** Is the current item the last of its reading group (or in no group)? */
    private fun isLastOfGroupLocked(exo: Player): Boolean {
        val index = exo.currentMediaItemIndex
        if (index !in 0 until exo.mediaItemCount) return true
        val group = groupAt(exo, index) ?: return true
        return index + 1 >= exo.mediaItemCount || groupAt(exo, index + 1) != group
    }

    /** Time left in the current item at the current speed, or null when its length is unknown. */
    private fun itemRemainingMsLocked(exo: Player): Long? {
        val duration = exo.duration
        if (duration == C.TIME_UNSET || duration <= 0) return null
        val speed = exo.playbackParameters.speed.takeIf { it > 0f } ?: 1f
        return (max(0L, duration - exo.currentPosition) / speed).toLong()
    }

    /** Until the timer pauses playback, or null when that is not known yet. */
    private fun sleepRemainingMsLocked(): Long? {
        val exo = player ?: return null
        return when (val t = sleepTimer) {
            null -> null
            is SleepTimer.At -> max(0L, t.deadlineElapsedMs - SystemClock.elapsedRealtime())
            SleepTimer.EndOfItem -> itemRemainingMsLocked(exo)
            SleepTimer.EndOfGroup -> if (isLastOfGroupLocked(exo)) itemRemainingMsLocked(exo) else null
        }
    }

    private fun describeSleepLocked(): String = when (val t = sleepTimer) {
        null -> "off"
        is SleepTimer.At -> "in ${sleepRemainingMsLocked()} ms"
        SleepTimer.EndOfItem -> "end of item"
        SleepTimer.EndOfGroup -> "end of reading"
    }

    /**
     * The timer's check, on the main looper: fade as the end nears and, for a timed timer, pause
     * when it comes (Media3 pauses at an item's end itself: [onSleepPausedAtEndOfItem]). Posted
     * again at most [SLEEP_CHECK_MAX_MS] later, every [SLEEP_FADE_STEP_MS] during the fade.
     */
    private fun sleepCheck() {
        var fired = false
        val delay: Long = synchronized(lock) {
            val t = sleepTimer ?: return
            val exo = player ?: run {
                sleepTimer = null
                return
            }
            if (t !is SleepTimer.At) applyPauseAtEndLocked()
            val remaining = sleepRemainingMsLocked()
            if (t is SleepTimer.At && remaining != null && remaining <= 0L) {
                // Pause first, then restore the volume: the player applies them in that order.
                (mediaSessionPlayer ?: exo).pause()
                clearSleepTimerLocked(null)
                debugLog("sleep", "fired: paused")
                persistLastPlayedLocked(force = true)
                fired = true
                return@synchronized -1L
            }
            val volume = if (remaining == null) 1f else (remaining.toFloat() / SLEEP_FADE_MS).coerceIn(0f, 1f)
            if (exo.volume != volume) exo.volume = volume
            when {
                remaining == null -> SLEEP_CHECK_MAX_MS
                remaining > SLEEP_FADE_MS -> (remaining - SLEEP_FADE_MS).coerceIn(SLEEP_FADE_STEP_MS, SLEEP_CHECK_MAX_MS)
                else -> SLEEP_FADE_STEP_MS
            }
        }
        if (fired) {
            refreshCustomLayout()
            emitState()
        } else {
            tickHandler.postDelayed(sleepRunnable, delay)
        }
    }

    /**
     * Media3 paused at the end of an item because the sleep timer asked it to. The item was
     * heard to its end: record it now (the listener may not press Play again until tomorrow),
     * and not again when Play moves on to the next item.
     */
    private fun onSleepPausedAtEndOfItem() {
        synchronized(lock) {
            if (sleepTimer == null || sleepTimer is SleepTimer.At) return
            val exo = player ?: return
            val index = exo.currentMediaItemIndex
            if (index in 0 until exo.mediaItemCount && index != sleepCompletedIndex) {
                finishedIndexes.add(index)
                recordCompletionLocked(exo.getMediaItemAt(index))
                sleepCompletedIndex = index
            }
            clearSleepTimerLocked(null)
            debugLog("sleep", "fired: paused at the end of item $index")
            persistLastPlayedLocked(force = true)
        }
        refreshCustomLayout()
        emitState()
    }

    /** The car's buttons show the speed and the sleep timer. */
    private fun refreshCustomLayout() {
        val session = synchronized(lock) { mediaSession } ?: return
        session.setCustomLayout(customLayout(null))
    }

    /** The custom buttons for the current speed (or [speed]) and sleep timer. */
    internal fun customLayout(speed: Float?): ImmutableList<CommandButton> = synchronized(lock) {
        SessionCommands.layout(speed ?: player?.playbackParameters?.speed ?: 1f, sleepLabelLocked())
    }

    /** What the car's sleep button says while a timer runs. */
    private fun sleepLabelLocked(): String? = when (val t = sleepTimer) {
        null -> null
        is SleepTimer.At -> "${t.minutes} min"
        SleepTimer.EndOfItem -> "end of chapter"
        SleepTimer.EndOfGroup -> "end of reading"
    }

    internal fun sleepTimerForTest(): SleepTimer? = synchronized(lock) { sleepTimer }

    /** Step the speed through 1×, 1.2×, 1.5×, 2×, 0.8×. */
    fun cycleSpeed(): Boolean {
        synchronized(lock) {
            val exo = player ?: return false
            exo.setPlaybackSpeed(SessionCommands.nextSpeed(exo.playbackParameters.speed))
        }
        emitState()
        return true
    }

    /**
     * The store behind the library, or a fresh one on the same SharedPreferences when the
     * player has not been built yet: pushing the car snapshot and collecting completions at
     * app start must not create ExoPlayer and the media session.
     */
    private fun storeLocked(context: Context): PlaybackStore =
        carLibrary?.store ?: PlaybackStore(context.applicationContext)

    /** The app's snapshot for the car (today's reading, devotional audio, narrator). */
    fun setCarSnapshot(context: Context, json: String): Boolean {
        val ok = synchronized(lock) { storeLocked(context).setSnapshot(json) }
        if (ok) {
            notifyLibraryChanged(MediaIds.ROOT)
            notifyLibraryChanged(MediaIds.TAB_TODAY)
            notifyLibraryChanged(MediaIds.TAB_DEVOTIONAL)
        }
        return ok
    }

    /** Plan chapters and devotionals heard to the end, waiting for the app, oldest first. */
    fun completions(context: Context): org.json.JSONArray =
        synchronized(lock) { storeLocked(context).completions() }

    fun ackCompletions(context: Context, upTo: Long) {
        synchronized(lock) { storeLocked(context).ackCompletions(upTo) }
        emitState()
    }

    internal fun carLibrary(): CarLibrary? = synchronized(lock) { carLibrary }

    /** The loaded queue, for the app to adopt one the car started. */
    fun queueItems(@Suppress("UNUSED_PARAMETER") context: Context): org.json.JSONObject {
        synchronized(lock) {
            val exo = player
            val items = org.json.JSONArray()
            if (exo != null) {
                for (i in 0 until exo.mediaItemCount) {
                    val item = exo.getMediaItemAt(i)
                    val o = org.json.JSONObject()
                        .put("mediaId", item.mediaId)
                        .put("src", item.localConfiguration?.uri?.toString().orEmpty())
                        .put("title", item.mediaMetadata.title?.toString().orEmpty())
                        .put("subtitle", item.mediaMetadata.artist?.toString().orEmpty())
                    when (val parsed = MediaIds.parse(item.mediaId)) {
                        is MediaIds.Parsed.Chapter -> o.put("ho", parsed.ho).put("chapter", parsed.chapter)
                        is MediaIds.Parsed.PlanTrack -> o.put("ho", parsed.ho).put("chapter", parsed.chapter)
                            .put("planId", parsed.planId).put("planDay", parsed.day).put("planReadingIndex", parsed.readingIndex)
                        else -> Unit
                    }
                    item.mediaMetadata.extras?.let { if (it.containsKey(CarLibrary.EXTRA_READING_GROUP)) o.put("readingGroup", it.getInt(CarLibrary.EXTRA_READING_GROUP)) }
                    items.put(o)
                }
            }
            return org.json.JSONObject()
                .put("items", items)
                .put("index", exo?.currentMediaItemIndex ?: 0)
                .put("queueGeneration", queueGeneration)
                .put("queueOrigin", queueOrigin)
        }
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
            queueGeneration = queueGeneration,
            queueOrigin = queueOrigin,
            // A counter the store keeps, not a parse of the stored list (up to 500 entries).
            pendingCompletions = carLibrary?.store?.pendingCompletionCount() ?: 0,
            finished = finishedIndexes.toList(),
            sleepTimer = sleepTimer?.let { t ->
                val remaining = sleepRemainingMsLocked()
                when (t) {
                    is SleepTimer.At -> SleepTimerState("time", System.currentTimeMillis() + (remaining ?: 0L), remaining)
                    SleepTimer.EndOfItem -> SleepTimerState("item", null, remaining)
                    SleepTimer.EndOfGroup -> SleepTimerState("group", null, remaining)
                }
            },
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

/** Only a URL the car can stream later belongs in Recent and Continue listening, not a cache file. */
private fun String.isStreamable(): Boolean = startsWith("https://") || startsWith("http://")

/**
 * The commands the app calls. Kotlin method names are the camelCase of the snake_case command
 * names in build.rs and the JS (`set_queue` → `setQueue`).
 */
@TauriPlugin
class NativeAudioPlugin(private val activity: Activity) : Plugin(activity) {

    init {
        activeInstance = this
        // The plugin is created with the activity, which is about to be shown.
        NativeAudioRuntime.setAppVisible(true)
    }

    private val context: Context get() = activity.applicationContext

    /** Run [action], then resolve with the player's state, or reject with [name]'s failure. */
    private fun respond(invoke: Invoke, name: String, action: () -> Unit) {
        runCatching(action)
            .onSuccess { invoke.resolve(toJsObject(NativeAudioRuntime.getState(context))) }
            .onFailure { invoke.reject(it.message ?: "$name failed") }
    }

    /** Builds the player and the session. The app calls it before its first playback. */
    @Command
    fun initialize(invoke: Invoke) {
        requestNotificationPermission()
        respond(invoke, "initialize") { NativeAudioRuntime.initialize(context) }
    }

    @Command
    fun setQueue(invoke: Invoke) {
        val args = invoke.parseArgs(SetQueueArgs::class.java)
        val items = args.items.orEmpty().filter { !it.src.isNullOrBlank() }
        if (items.isEmpty()) {
            invoke.reject("items is required")
            return
        }
        respond(invoke, "setQueue") { NativeAudioRuntime.setQueue(context, items, args.startIndex ?: 0) }
    }

    /** Jump within the loaded queue (see [NativeAudioRuntime.skipTo]). Rejects "stale queue". */
    @Command
    fun skipTo(invoke: Invoke) {
        val args = invoke.parseArgs(SkipToArgs::class.java)
        val index = args.index
        if (index == null) {
            invoke.reject("index is required")
            return
        }
        runCatching { NativeAudioRuntime.skipTo(context, index, args.positionSec ?: 0.0, args.queueGeneration) }
            .onSuccess { ok ->
                if (ok) invoke.resolve(toJsObject(NativeAudioRuntime.getState(context))) else invoke.reject("stale queue")
            }
            .onFailure { invoke.reject(it.message ?: "skipTo failed") }
    }

    @Command
    fun next(invoke: Invoke) = respond(invoke, "next") { NativeAudioRuntime.next(context) }

    @Command
    fun previous(invoke: Invoke) = respond(invoke, "previous") { NativeAudioRuntime.previous(context) }

    @Command
    fun play(invoke: Invoke) = respond(invoke, "play") { NativeAudioRuntime.play(context) }

    @Command
    fun pause(invoke: Invoke) = respond(invoke, "pause") { NativeAudioRuntime.pause(context) }

    /** Unload the queue and let the service go (the app's ✕). */
    @Command
    fun stop(invoke: Invoke) = respond(invoke, "stop") { NativeAudioRuntime.stop(context) }

    @Command
    fun seekTo(invoke: Invoke) {
        val position = invoke.parseArgs(SeekToArgs::class.java).position
        if (position == null || !position.isFinite()) {
            invoke.reject("position is required")
            return
        }
        respond(invoke, "seekTo") { NativeAudioRuntime.seekTo(context, position) }
    }

    @Command
    fun setRate(invoke: Invoke) {
        val rate = invoke.parseArgs(SetRateArgs::class.java).rate
        if (rate == null || !rate.isFinite() || rate <= 0) {
            invoke.reject("rate must be > 0")
            return
        }
        respond(invoke, "setRate") { NativeAudioRuntime.setRate(context, rate) }
    }

    /** Start, replace or (no arguments) cancel the sleep timer (see [NativeAudioRuntime.setSleepTimer]). */
    @Command
    fun setSleepTimer(invoke: Invoke) {
        val args = invoke.parseArgs(SetSleepTimerArgs::class.java)
        respond(invoke, "setSleepTimer") {
            NativeAudioRuntime.setSleepTimer(context, args.atEpochMs, args.endOfItem == true, args.endOfGroup == true)
        }
    }

    @Command
    fun getState(invoke: Invoke) = respond(invoke, "getState") {}

    /** Android Auto: the app's snapshot of today's reading, devotional audio and narrator. */
    @Command
    fun setCarSnapshot(invoke: Invoke) {
        val json = invoke.parseArgs(CarSnapshotArgs::class.java).json
        if (json.isNullOrBlank()) {
            invoke.reject("json is required")
            return
        }
        runCatching { NativeAudioRuntime.setCarSnapshot(context, json) }
            .onSuccess { ok -> if (ok) invoke.resolve() else invoke.reject("snapshot is not valid JSON") }
            .onFailure { invoke.reject(it.message ?: "setCarSnapshot failed") }
    }

    /** Plan chapters and devotionals heard to the end, oldest first, whatever loaded the
     *  queue. Kept until acknowledged with [ackCompletions]. */
    @Command
    fun takeCompletions(invoke: Invoke) {
        runCatching { NativeAudioRuntime.completions(context) }
            .onSuccess { items -> invoke.resolve(JSObject().apply { put("items", items) }) }
            .onFailure { invoke.reject(it.message ?: "takeCompletions failed") }
    }

    @Command
    fun ackCompletions(invoke: Invoke) {
        val upTo = invoke.parseArgs(AckCompletionsArgs::class.java).upTo
        if (upTo == null) {
            invoke.reject("upTo is required")
            return
        }
        runCatching { NativeAudioRuntime.ackCompletions(context, upTo) }
            .onSuccess { invoke.resolve() }
            .onFailure { invoke.reject(it.message ?: "ackCompletions failed") }
    }

    /** The v0.4.0 name of [takeCompletions]. Kept for one release; remove in v0.5. */
    @Command
    fun takeCarCompletions(invoke: Invoke) = takeCompletions(invoke)

    /** The v0.4.0 name of [ackCompletions]. Kept for one release; remove in v0.5. */
    @Command
    fun ackCarCompletions(invoke: Invoke) = ackCompletions(invoke)

    /** The loaded queue with each item's chapter and plan position (to adopt an external queue). */
    @Command
    fun getQueue(invoke: Invoke) {
        runCatching { NativeAudioRuntime.queueItems(context) }
            .onSuccess { invoke.resolve(JSObject(it.toString())) }
            .onFailure { invoke.reject(it.message ?: "getQueue failed") }
    }

    /** Recent audio events (commands, media buttons, service lifecycle) for bug reports. */
    @Command
    fun getDebugLog(invoke: Invoke) {
        val payload = JSObject()
        payload.put("lines", org.json.JSONArray(NativeAudioRuntime.debugLogLines()))
        invoke.resolve(payload)
    }

    override fun onResume() {
        NativeAudioRuntime.setAppVisible(true)
        super.onResume()
    }

    override fun onStop() {
        NativeAudioRuntime.setAppVisible(false)
        super.onStop()
    }

    override fun onDestroy() {
        if (activeInstance === this) {
            activeInstance = null
            NativeAudioRuntime.setAppVisible(false)
        }
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
        payload.put("queueGeneration", state.queueGeneration)
        payload.put("queueOrigin", state.queueOrigin)
        payload.put("pendingCompletions", state.pendingCompletions)
        payload.put("finished", org.json.JSONArray(state.finished))
        // Always present, so the app can tell "no timer" from an older plugin that has none.
        payload.put(
            "sleepTimer",
            state.sleepTimer?.let { t ->
                JSObject().apply {
                    put("mode", t.mode)
                    t.endsAtEpochMs?.let { put("endsAtEpochMs", it) }
                    t.remainingMs?.let { put("remainingMs", it) }
                }
            } ?: org.json.JSONObject.NULL,
        )
        if (!state.error.isNullOrBlank()) payload.put("error", state.error)
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
