package app.tauri.nativeaudio

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Bundle
import androidx.annotation.OptIn
import androidx.core.app.NotificationManagerCompat
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.session.CommandButton
import androidx.media3.session.DefaultMediaNotificationProvider
import androidx.media3.session.MediaSession
import androidx.media3.session.MediaSessionService
import com.google.common.collect.ImmutableList

internal const val NOTIFICATION_ID = 9501
private const val CHANNEL_ID_SUFFIX = ".native_audio"
private const val NOTIFICATION_ICON_NAME = "ic_notification"

/**
 * The playback service. Media3 owns the media notification AND the foreground state: whenever
 * the session's player starts playing — from the app, the notification, the lock screen, or an
 * earphone button — `MediaSessionService` promotes itself to the foreground, and it drops back
 * (keeping the notification) on pause.
 *
 * This used to be a hand-rolled `PlayerNotificationManager` with `onUpdateNotification`
 * overridden to do nothing. That turned Media3's foreground handling off, so the only thing
 * that ever started the service was the app's own Play button. See docs/NATIVE-AUDIO.md
 * ("Headset resume") for how that lost the sound after an earphone pause/resume.
 *
 * The service is kept alive by a binding from [NativeAudioRuntime] while a queue is loaded, so
 * Android's background-service limits cannot stop it during a pause.
 */
@OptIn(UnstableApi::class)
class NativeAudioService : MediaSessionService() {

    override fun onCreate() {
        super.onCreate()
        NativeAudioRuntime.ensure(applicationContext)
        ensureNotificationChannel()
        setMediaNotificationProvider(
            NativeAudioNotificationProvider(this, channelId()).apply {
                setSmallIcon(resolveNotificationSmallIconResId())
            },
        )
        // Hand the session to Media3 now rather than waiting for a controller to bind: this is
        // what connects Media3's notification controller, which drives the foreground state.
        NativeAudioRuntime.mediaSession()?.let { addSession(it) }
        NativeAudioRuntime.onServiceCreated(this)
    }

    override fun onGetSession(controllerInfo: MediaSession.ControllerInfo): MediaSession? {
        return NativeAudioRuntime.mediaSession()
    }

    override fun onTaskRemoved(rootIntent: Intent?) {
        // The app was swiped away. Keep playing if we are; otherwise let the service (and its
        // notification) go. The session outlives the service, so an earphone press later still
        // reaches it and brings the service back (NativeAudioRuntime.onPlayRequested).
        val playing = NativeAudioRuntime.mediaSessionPlayer()?.playWhenReady == true
        NativeAudioRuntime.debugLog("service", "onTaskRemoved playing=$playing")
        if (!playing) {
            NativeAudioRuntime.releaseServiceBinding(applicationContext)
            stopSelf()
        }
    }

    override fun onDestroy() {
        NativeAudioRuntime.debugLog("service", "onDestroy")
        NativeAudioRuntime.mediaSession()?.let { session ->
            // The session belongs to NativeAudioRuntime, not to this service instance. Detach it
            // so the next service instance can adopt it cleanly.
            if (isSessionAdded(session)) removeSession(session)
        }
        NativeAudioRuntime.onServiceDestroyed(this)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            stopForeground(Service.STOP_FOREGROUND_REMOVE)
        } else {
            @Suppress("DEPRECATION")
            stopForeground(true)
        }
        NotificationManagerCompat.from(this).cancel(NOTIFICATION_ID)
        super.onDestroy()
    }

    private fun channelId(): String = "${packageName}${CHANNEL_ID_SUFFIX}"

    private fun appDisplayName(): String {
        return applicationInfo.loadLabel(packageManager)?.toString().orEmpty().ifBlank { "Audio app" }
    }

    private fun resolveNotificationSmallIconResId(): Int {
        val notificationIcon = resources.getIdentifier(NOTIFICATION_ICON_NAME, "drawable", packageName)
        if (notificationIcon != 0) return notificationIcon
        return android.R.drawable.ic_media_play
    }

    /** Same channel id and name as before, so the user's notification settings carry over.
     *  Media3 only creates a channel when it does not exist yet. */
    private fun ensureNotificationChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (manager.getNotificationChannel(channelId()) != null) return
        val channel = NotificationChannel(channelId(), appDisplayName(), NotificationManager.IMPORTANCE_LOW).apply {
            description = "Audio playback controls"
            setShowBadge(false)
        }
        manager.createNotificationChannel(channel)
    }
}

/**
 * Media3's default notification, with back 10 s / play-pause / forward 10 s as its buttons
 * (the old notification's rewind and fast-forward). On Android 13+ the system builds the media
 * controls from the session instead, where previous/next already seek (see the ForwardingPlayer
 * in NativeAudioRuntime).
 */
@OptIn(UnstableApi::class)
internal class NativeAudioNotificationProvider(context: Context, channelId: String) :
    DefaultMediaNotificationProvider(
        context,
        DefaultMediaNotificationProvider.NotificationIdProvider { NOTIFICATION_ID },
        channelId,
        DefaultMediaNotificationProvider.DEFAULT_CHANNEL_NAME_RESOURCE_ID,
    ) {

    override fun getMediaButtons(
        session: MediaSession,
        playerCommands: Player.Commands,
        customLayout: ImmutableList<CommandButton>,
        showPauseButton: Boolean,
    ): ImmutableList<CommandButton> {
        val buttons = ImmutableList.builder<CommandButton>()
        if (playerCommands.contains(Player.COMMAND_SEEK_BACK)) {
            buttons.add(
                CommandButton.Builder(CommandButton.ICON_SKIP_BACK_10)
                    .setPlayerCommand(Player.COMMAND_SEEK_BACK)
                    .setDisplayName("Back 10 seconds")
                    .setExtras(compactIndex(0))
                    .build(),
            )
        }
        if (playerCommands.contains(Player.COMMAND_PLAY_PAUSE)) {
            buttons.add(
                CommandButton.Builder(if (showPauseButton) CommandButton.ICON_PAUSE else CommandButton.ICON_PLAY)
                    .setPlayerCommand(Player.COMMAND_PLAY_PAUSE)
                    .setDisplayName(if (showPauseButton) "Pause" else "Play")
                    .setExtras(compactIndex(1))
                    .build(),
            )
        }
        if (playerCommands.contains(Player.COMMAND_SEEK_FORWARD)) {
            buttons.add(
                CommandButton.Builder(CommandButton.ICON_SKIP_FORWARD_10)
                    .setPlayerCommand(Player.COMMAND_SEEK_FORWARD)
                    .setDisplayName("Forward 10 seconds")
                    .setExtras(compactIndex(2))
                    .build(),
            )
        }
        return buttons.build()
    }

    private fun compactIndex(index: Int): Bundle =
        Bundle().apply { putInt(DefaultMediaNotificationProvider.COMMAND_KEY_COMPACT_VIEW_INDEX, index) }
}
