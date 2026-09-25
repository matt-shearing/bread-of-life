package app.tauri.nativeaudio

import android.app.Application
import android.content.Context
import android.content.Intent
import android.view.KeyEvent
import androidx.annotation.OptIn
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.common.util.Util
import androidx.media3.session.MediaSessionService
import androidx.media3.test.utils.FakeMediaSourceFactory
import androidx.media3.test.utils.TestExoPlayerBuilder
import androidx.media3.test.utils.robolectric.RobolectricUtil.runMainLooperUntil
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.Shadows.shadowOf
import org.robolectric.android.controller.ServiceController
import org.robolectric.annotation.Config
import org.robolectric.shadows.ShadowLooper

/**
 * The earphone pause/resume bug: a play that arrives from the MediaSession (earphones, lock
 * screen, notification) must bring the playback service back into the foreground, exactly as
 * the app's own Play button does. These tests drive the real Media3 session and service.
 */
@RunWith(AndroidJUnit4::class)
@Config(sdk = [34])
@OptIn(UnstableApi::class)
class HeadsetResumeTest {
    private val context: Context = ApplicationProvider.getApplicationContext()
    private var serviceController: ServiceController<NativeAudioService>? = null
    private var startId = 1

    @Before
    fun setUp() {
        // A player that "plays" a 1000-second fake stream without network or audio hardware.
        NativeAudioRuntime.playerFactory = { ctx ->
            TestExoPlayerBuilder(ctx).setMediaSourceFactory(FakeMediaSourceFactory()).build()
        }
    }

    @After
    fun tearDown() {
        serviceController?.destroy()
        serviceController = null
        NativeAudioRuntime.dispose(context)
        ShadowLooper.idleMainLooper()
    }

    @Test
    fun earphonePauseThenResume_putsServiceBackInForeground() {
        loadDailyReadingAndPlayFromApp()
        val service = createService()
        val player = sessionPlayer()
        runMainLooperUntil { player.isPlaying && isForeground(service) }

        pressEarphoneButton(KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE)
        runMainLooperUntil { !player.playWhenReady && shadowOf(service).isForegroundStopped }
        // Paused: out of the foreground, but the notification stays so it can be resumed.
        assertFalse(shadowOf(service).notificationShouldRemoved)

        pressEarphoneButton(KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE)
        runMainLooperUntil { player.isPlaying && isForeground(service) }
        assertEquals(NOTIFICATION_ID, shadowOf(service).lastForegroundNotificationId)
    }

    @Test
    fun playFromOutsideTheApp_afterServiceWasStopped_bringsServiceBack() {
        loadDailyReadingAndPlayFromApp()
        var service = createService()
        val player = sessionPlayer()
        runMainLooperUntil { player.isPlaying && isForeground(service) }

        pressEarphoneButton(KeyEvent.KEYCODE_MEDIA_PAUSE)
        runMainLooperUntil { !player.playWhenReady }

        // The app is swiped away while paused: the service lets go and stops. The MediaSession
        // lives on in NativeAudioRuntime, so Android still routes earphone buttons to it.
        service.onTaskRemoved(null)
        assertTrue(shadowOf(service).isStoppedBySelf)
        assertFalse(NativeAudioRuntime.isServiceBindRequested())
        serviceController?.destroy()
        serviceController = null

        // An earphone press arrives through the platform session. For a Bluetooth or wired
        // headset (a legacy controller) Media3 1.4.1 waits out the double-tap window and then
        // calls handleMediaPlayPauseOnHandler -> Util.handlePlayButtonAction(player): the
        // player directly, never the app's play(). Do exactly that.
        Util.handlePlayButtonAction(sessionPlayer())
        ShadowLooper.idleMainLooper()

        // …and that alone asks Android for the service again.
        assertTrue(NativeAudioRuntime.isServiceBindRequested())
        assertTrue(shadowOf(context as Application).boundServiceConnections.isNotEmpty())

        // Android creates the service for the binding; Media3 puts it in the foreground.
        service = createService()
        runMainLooperUntil { player.isPlaying && isForeground(service) }
    }

    @Test
    fun earphoneButtons_areRecordedInTheDebugLog() {
        loadDailyReadingAndPlayFromApp()
        val service = createService()
        val player = sessionPlayer()
        runMainLooperUntil { player.isPlaying && isForeground(service) }

        pressEarphoneButton(KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE)
        runMainLooperUntil { !player.playWhenReady }

        val lines = NativeAudioRuntime.debugLogLines()
        assertTrue(lines.joinToString("\n"), lines.any { "[button] PLAY_PAUSE down" in it && "media-notification" in it })
        assertTrue(lines.joinToString("\n"), lines.any { "[command] pause" in it && "media-notification" in it })
    }

    @Test
    fun appPlayButton_bindsServiceWithoutStartingItInTheForegroundItself() {
        loadDailyReadingAndPlayFromApp()
        // No startForegroundService() from the app: Media3 starts the service in the foreground
        // itself once it has a notification, so there is no 10-second startForeground deadline
        // to miss (that would crash the app).
        assertTrue(NativeAudioRuntime.isServiceBindRequested())
        // Robolectric records a bind as a started intent too; the bind carries Media3's
        // service action. Anything else would be the app starting the service itself.
        val app = shadowOf(context as Application)
        var sawBind = false
        while (true) {
            val started = app.nextStartedService ?: break
            assertEquals("unexpected service start: $started", MediaSessionService.SERVICE_INTERFACE, started.action)
            sawBind = true
        }
        assertTrue(sawBind)
    }

    private fun loadDailyReadingAndPlayFromApp() {
        NativeAudioRuntime.setQueue(
            context,
            listOf(
                queueItem("https://example.invalid/BSB/GEN/1/audio/david.mp3", "Genesis 1"),
                queueItem("https://example.invalid/BSB/MAT/1/audio/david.mp3", "Matthew 1"),
            ),
            0,
        )
        NativeAudioRuntime.play(context)
    }

    private fun queueItem(src: String, title: String) = QueueItemArg().apply {
        this.src = src
        this.title = title
        this.artist = "BSB · David"
    }

    private fun sessionPlayer(): Player {
        val player = NativeAudioRuntime.mediaSessionPlayer()
        assertNotNull(player)
        return player!!
    }

    private fun createService(): NativeAudioService {
        val controller = Robolectric.buildService(NativeAudioService::class.java)
        serviceController = controller
        val service = controller.create().get()
        ShadowLooper.idleMainLooper()
        return service
    }

    /** What Android delivers to a MediaSessionService when an earphone button is pressed. */
    private fun pressEarphoneButton(keyCode: Int) {
        val intent = Intent(Intent.ACTION_MEDIA_BUTTON)
            .putExtra(Intent.EXTRA_KEY_EVENT, KeyEvent(KeyEvent.ACTION_DOWN, keyCode))
        @Suppress("DEPRECATION")
        serviceController!!.withIntent(intent).startCommand(0, startId++)
        ShadowLooper.idleMainLooper()
    }

    private fun isForeground(service: NativeAudioService): Boolean {
        val shadow = shadowOf(service)
        return shadow.lastForegroundNotification != null && !shadow.isForegroundStopped
    }
}
