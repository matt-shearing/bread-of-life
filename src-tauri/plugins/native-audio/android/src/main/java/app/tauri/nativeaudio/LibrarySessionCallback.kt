package app.tauri.nativeaudio

import android.content.Intent
import android.os.Bundle
import android.view.KeyEvent
import androidx.annotation.OptIn
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.util.UnstableApi
import androidx.media3.session.CommandButton
import androidx.media3.session.LibraryResult
import androidx.media3.session.MediaLibraryService.LibraryParams
import androidx.media3.session.MediaLibraryService.MediaLibrarySession
import androidx.media3.session.MediaSession
import androidx.media3.session.MediaSession.MediaItemsWithStartPosition
import androidx.media3.session.SessionCommand
import androidx.media3.session.SessionError
import androidx.media3.session.SessionResult
import com.google.common.collect.ImmutableList
import com.google.common.util.concurrent.Futures
import com.google.common.util.concurrent.ListenableFuture

/** Custom buttons on the car's (and the lock screen's) playback screen. */
internal object CarCommands {
    const val NEXT_READING = "app.tauri.nativeaudio.NEXT_READING"
    const val BACK_30 = "app.tauri.nativeaudio.BACK_30"
    const val SPEED = "app.tauri.nativeaudio.SPEED"

    /** The speeds the car's speed button steps through, each with its own icon. */
    val SPEEDS = floatArrayOf(1.0f, 1.2f, 1.5f, 2.0f, 0.8f)

    val all: List<SessionCommand> = listOf(
        SessionCommand(NEXT_READING, Bundle.EMPTY),
        SessionCommand(BACK_30, Bundle.EMPTY),
        SessionCommand(SPEED, Bundle.EMPTY),
    )

    fun nextSpeed(current: Float): Float {
        val i = SPEEDS.indexOfFirst { kotlin.math.abs(it - current) < 0.01f }
        return if (i < 0) 1.0f else SPEEDS[(i + 1) % SPEEDS.size]
    }

    @OptIn(UnstableApi::class)
    fun layout(speed: Float): ImmutableList<CommandButton> {
        val speedIcon = when {
            kotlin.math.abs(speed - 0.8f) < 0.01f -> CommandButton.ICON_PLAYBACK_SPEED_0_8
            kotlin.math.abs(speed - 1.2f) < 0.01f -> CommandButton.ICON_PLAYBACK_SPEED_1_2
            kotlin.math.abs(speed - 1.5f) < 0.01f -> CommandButton.ICON_PLAYBACK_SPEED_1_5
            kotlin.math.abs(speed - 2.0f) < 0.01f -> CommandButton.ICON_PLAYBACK_SPEED_2_0
            kotlin.math.abs(speed - 1.0f) < 0.01f -> CommandButton.ICON_PLAYBACK_SPEED_1_0
            else -> CommandButton.ICON_PLAYBACK_SPEED
        }
        return ImmutableList.of(
            CommandButton.Builder(CommandButton.ICON_SKIP_BACK_30)
                .setDisplayName("Back 30 seconds")
                .setSessionCommand(SessionCommand(BACK_30, Bundle.EMPTY))
                .build(),
            CommandButton.Builder(CommandButton.ICON_QUEUE_NEXT)
                .setDisplayName("Next reading")
                .setSessionCommand(SessionCommand(NEXT_READING, Bundle.EMPTY))
                .build(),
            CommandButton.Builder(speedIcon)
                .setDisplayName("Speed ${formatSpeed(speed)}")
                .setSessionCommand(SessionCommand(SPEED, Bundle.EMPTY))
                .build(),
        )
    }

    fun formatSpeed(speed: Float): String {
        val s = if (speed == speed.toInt().toFloat()) speed.toInt().toString() else "%.1f".format(java.util.Locale.US, speed)
        return "$s×"
    }
}

/**
 * The session's callback: the Android Auto library (browse, search, play by id, resume),
 * the custom buttons, and the logging the debug log relies on for every controller command.
 */
@OptIn(UnstableApi::class)
internal class CarSessionCallback(
    private val library: () -> CarLibrary?,
) : MediaLibrarySession.Callback {

    override fun onConnect(session: MediaSession, controller: MediaSession.ControllerInfo): MediaSession.ConnectionResult {
        val commands = MediaSession.ConnectionResult.DEFAULT_SESSION_AND_LIBRARY_COMMANDS.buildUpon()
            .apply { CarCommands.all.forEach { add(it) } }
            .build()
        return MediaSession.ConnectionResult.AcceptedResultBuilder(session)
            .setAvailableSessionCommands(commands)
            .setCustomLayout(CarCommands.layout(session.player.playbackParameters.speed))
            .build()
    }

    override fun onPostConnect(session: MediaSession, controller: MediaSession.ControllerInfo) {
        NativeAudioRuntime.debugLog("session", "connected ${NativeAudioRuntime.describe(session, controller)}")
    }

    override fun onDisconnected(session: MediaSession, controller: MediaSession.ControllerInfo) {
        NativeAudioRuntime.debugLog("session", "disconnected ${NativeAudioRuntime.describe(session, controller)}")
    }

    override fun onMediaButtonEvent(session: MediaSession, controllerInfo: MediaSession.ControllerInfo, intent: Intent): Boolean {
        @Suppress("DEPRECATION")
        val key = intent.getParcelableExtra<KeyEvent>(Intent.EXTRA_KEY_EVENT)
        val keyName = key?.let { NativeAudioRuntime.mediaKeyName(it.keyCode) } ?: "none"
        val action = when (key?.action) {
            KeyEvent.ACTION_DOWN -> "down"
            KeyEvent.ACTION_UP -> "up"
            else -> "?"
        }
        NativeAudioRuntime.debugLog("button", "$keyName $action repeat=${key?.repeatCount ?: 0} from=${NativeAudioRuntime.describe(session, controllerInfo)}")
        return false // let Media3 handle it as usual
    }

    @Deprecated("Media3 still calls this for every player command in 1.4.x")
    override fun onPlayerCommandRequest(session: MediaSession, controller: MediaSession.ControllerInfo, playerCommand: Int): Int {
        NativeAudioRuntime.debugLog("session", "command ${NativeAudioRuntime.playerCommandName(playerCommand)} from=${NativeAudioRuntime.describe(session, controller)}")
        return SessionResult.RESULT_SUCCESS
    }

    override fun onCustomCommand(
        session: MediaSession,
        controller: MediaSession.ControllerInfo,
        customCommand: SessionCommand,
        args: Bundle,
    ): ListenableFuture<SessionResult> {
        NativeAudioRuntime.debugLog("session", "custom ${customCommand.customAction} from=${NativeAudioRuntime.describe(session, controller)}")
        val handled = when (customCommand.customAction) {
            CarCommands.BACK_30 -> NativeAudioRuntime.seekBackBy(30_000L)
            CarCommands.NEXT_READING -> NativeAudioRuntime.nextReading()
            CarCommands.SPEED -> NativeAudioRuntime.cycleSpeed()
            else -> false
        }
        return Futures.immediateFuture(SessionResult(if (handled) SessionResult.RESULT_SUCCESS else SessionError.ERROR_NOT_SUPPORTED))
    }

    /* ------------------------------------ library ----------------------------------- */

    override fun onGetLibraryRoot(
        session: MediaLibrarySession,
        browser: MediaSession.ControllerInfo,
        params: LibraryParams?,
    ): ListenableFuture<LibraryResult<MediaItem>> {
        val lib = library() ?: return Futures.immediateFuture(LibraryResult.ofError(SessionError.ERROR_INVALID_STATE))
        NativeAudioRuntime.debugLog("library", "root recent=${params?.isRecent == true} from=${NativeAudioRuntime.describe(session, browser)}")
        val rootParams = LibraryParams.Builder().setExtras(lib.rootExtras()).build()
        // Android's "resume media" card asks for a recent root: offer only Continue listening.
        if (params?.isRecent == true) {
            if (lib.store.lastPlayed() == null) return Futures.immediateFuture(LibraryResult.ofError(SessionError.ERROR_NOT_SUPPORTED))
            return Futures.immediateFuture(LibraryResult.ofItem(lib.recentRootItem(), LibraryParams.Builder().setRecent(true).build()))
        }
        return Futures.immediateFuture(LibraryResult.ofItem(lib.rootItem(), rootParams))
    }

    override fun onGetChildren(
        session: MediaLibrarySession,
        browser: MediaSession.ControllerInfo,
        parentId: String,
        page: Int,
        pageSize: Int,
        params: LibraryParams?,
    ): ListenableFuture<LibraryResult<ImmutableList<MediaItem>>> {
        val lib = library() ?: return Futures.immediateFuture(LibraryResult.ofError(SessionError.ERROR_INVALID_STATE))
        val children = lib.children(parentId)
            ?: return Futures.immediateFuture(LibraryResult.ofError(SessionError.ERROR_BAD_VALUE))
        return Futures.immediateFuture(LibraryResult.ofItemList(page(children, page, pageSize), params))
    }

    override fun onGetItem(
        session: MediaLibrarySession,
        browser: MediaSession.ControllerInfo,
        mediaId: String,
    ): ListenableFuture<LibraryResult<MediaItem>> {
        val item = library()?.item(mediaId)
            ?: return Futures.immediateFuture(LibraryResult.ofError(SessionError.ERROR_BAD_VALUE))
        return Futures.immediateFuture(LibraryResult.ofItem(item, null))
    }

    override fun onSearch(
        session: MediaLibrarySession,
        browser: MediaSession.ControllerInfo,
        query: String,
        params: LibraryParams?,
    ): ListenableFuture<LibraryResult<Void>> {
        val count = library()?.search(query)?.size ?: 0
        NativeAudioRuntime.debugLog("library", "search \"$query\" -> $count")
        session.notifySearchResultChanged(browser, query, count, params)
        return Futures.immediateFuture(LibraryResult.ofVoid(params))
    }

    override fun onGetSearchResult(
        session: MediaLibrarySession,
        browser: MediaSession.ControllerInfo,
        query: String,
        page: Int,
        pageSize: Int,
        params: LibraryParams?,
    ): ListenableFuture<LibraryResult<ImmutableList<MediaItem>>> {
        val results = library()?.search(query).orEmpty()
        return Futures.immediateFuture(LibraryResult.ofItemList(page(results, page, pageSize), params))
    }

    /* ------------------------------------ playback ---------------------------------- */

    /**
     * A tap in the car, a voice request ("play John 3 on Bread of Life") or a Media3 browser's
     * setMediaItem. The request carries a media id or a search query and no URL; answer with
     * the whole queue it starts (a plan day, or the Bible from that chapter on).
     */
    override fun onSetMediaItems(
        mediaSession: MediaSession,
        controller: MediaSession.ControllerInfo,
        mediaItems: MutableList<MediaItem>,
        startIndex: Int,
        startPositionMs: Long,
    ): ListenableFuture<MediaItemsWithStartPosition> {
        val lib = library() ?: return Futures.immediateFailedFuture(IllegalStateException("no library"))
        if (mediaItems.size == 1) {
            val request = mediaItems[0]
            val query = request.requestMetadata.searchQuery
            val resolved = when {
                request.mediaId.isNotEmpty() && request.mediaId != MediaItem.DEFAULT_MEDIA_ID -> lib.resolve(request.mediaId)
                query != null -> lib.resolveSearch(query)
                else -> null
            }
            NativeAudioRuntime.debugLog(
                "library",
                "play id=${request.mediaId.ifEmpty { "-" }} query=${query ?: "-"} -> ${resolved?.mediaItems?.size ?: 0} items from=${NativeAudioRuntime.describe(mediaSession, controller)}",
            )
            if (resolved != null) {
                val position = if (startPositionMs != C.TIME_UNSET && startPositionMs > 0) startPositionMs else resolved.startPositionMs
                return Futures.immediateFuture(MediaItemsWithStartPosition(resolved.mediaItems, resolved.startIndex, position))
            }
        }
        val items = mediaItems.mapNotNull { resolveOne(lib, it) }
        if (items.isEmpty()) return Futures.immediateFailedFuture(IllegalArgumentException("nothing to play"))
        val start = if (startIndex == C.INDEX_UNSET) 0 else startIndex.coerceIn(0, items.size - 1)
        return Futures.immediateFuture(MediaItemsWithStartPosition(items, start, startPositionMs))
    }

    override fun onAddMediaItems(
        mediaSession: MediaSession,
        controller: MediaSession.ControllerInfo,
        mediaItems: MutableList<MediaItem>,
    ): ListenableFuture<MutableList<MediaItem>> {
        val lib = library() ?: return Futures.immediateFailedFuture(IllegalStateException("no library"))
        return Futures.immediateFuture(mediaItems.mapNotNull { resolveOne(lib, it) }.toMutableList())
    }

    /** "Resume" with nothing loaded: the car's play button, "continue listening", Android's resume card. */
    override fun onPlaybackResumption(
        mediaSession: MediaSession,
        controller: MediaSession.ControllerInfo,
    ): ListenableFuture<MediaItemsWithStartPosition> {
        val lib = library()
        val resumed = lib?.resumption() ?: lib?.resolve(MediaIds.TODAY_ALL)
        NativeAudioRuntime.debugLog("library", "resume -> ${resumed?.mediaItems?.getOrNull(resumed.startIndex)?.mediaId ?: "nothing"}")
        return if (resumed != null) Futures.immediateFuture(resumed)
        else Futures.immediateFailedFuture(UnsupportedOperationException("nothing to resume"))
    }

    private fun resolveOne(lib: CarLibrary, item: MediaItem): MediaItem? {
        if (item.localConfiguration != null) return item
        return lib.single(item.mediaId)
    }

    private fun page(items: List<MediaItem>, page: Int, pageSize: Int): ImmutableList<MediaItem> {
        if (pageSize <= 0 || pageSize == Int.MAX_VALUE || page < 0) return ImmutableList.copyOf(items)
        val from = page.toLong() * pageSize
        if (from >= items.size) return ImmutableList.of()
        return ImmutableList.copyOf(items.subList(from.toInt(), minOf(items.size, from.toInt() + pageSize)))
    }
}
