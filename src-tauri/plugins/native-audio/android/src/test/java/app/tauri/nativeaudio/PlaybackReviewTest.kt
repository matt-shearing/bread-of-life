package app.tauri.nativeaudio

import android.content.Context
import android.media.AudioManager
import android.net.Uri
import androidx.annotation.OptIn
import androidx.media3.common.C
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.test.utils.FakeMediaSourceFactory
import androidx.media3.test.utils.TestExoPlayerBuilder
import androidx.media3.test.utils.robolectric.RobolectricUtil.runMainLooperUntil
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.shadows.ShadowLooper
import java.io.File

/**
 * The fixes from the September 2026 audio review: play after an error, speech audio
 * attributes, the app's stop, skip_to, devotional completions from the app's own queue, the
 * completions store, the artwork provider's paths, and the shared speed list.
 */
@RunWith(AndroidJUnit4::class)
@Config(sdk = [34])
@OptIn(UnstableApi::class)
class PlaybackReviewTest {
    private val context: Context = ApplicationProvider.getApplicationContext()

    @Before
    fun setUp() {
        NativeAudioRuntime.playerFactory = { ctx ->
            TestExoPlayerBuilder(ctx).setMediaSourceFactory(FakeMediaSourceFactory()).build()
        }
        PlaybackStore(context).clearForTest()
    }

    @After
    fun tearDown() {
        NativeAudioRuntime.dispose(context)
        PlaybackStore(context).clearForTest()
        ShadowLooper.idleMainLooper()
    }

    /* ------------------------------------ playback ----------------------------------- */

    @Test
    fun appPlay_afterThePlayerWentIdle_preparesAndPlays() {
        // After onPlayerError ExoPlayer is idle, exactly as after stop(): only prepare() loads
        // the item again. The app's play() used to set play-when-ready and nothing more.
        loadTwoChapters()
        NativeAudioRuntime.play(context)
        val player = sessionPlayer()
        runMainLooperUntil { player.isPlaying }
        player.stop()
        runMainLooperUntil { player.playbackState == Player.STATE_IDLE }
        assertFalse(player.isPlaying)

        NativeAudioRuntime.play(context)
        runMainLooperUntil { player.isPlaying }
        assertEquals(Player.STATE_READY, player.playbackState)
    }

    @Test
    fun narrationIsSpeech_soADuckingFocusLossPausesInsteadOfLoweringTheVoice() {
        loadTwoChapters()
        NativeAudioRuntime.play(context)
        val player = sessionPlayer()
        runMainLooperUntil { player.isPlaying }
        assertEquals(C.AUDIO_CONTENT_TYPE_SPEECH, player.audioAttributes.contentType)

        // A Maps prompt in the car: "you may duck".
        val audioManager = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
        val request = shadowOf(audioManager).lastAudioFocusRequest
        assertNotNull("ExoPlayer asked for audio focus", request)
        request!!.listener.onAudioFocusChange(AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK)
        runMainLooperUntil { !player.isPlaying }
        assertTrue("still wants to play once the prompt is over", player.playWhenReady)
        assertEquals(Player.PLAYBACK_SUPPRESSION_REASON_TRANSIENT_AUDIO_FOCUS_LOSS, player.playbackSuppressionReason)

        request.listener.onAudioFocusChange(AudioManager.AUDIOFOCUS_GAIN)
        runMainLooperUntil { player.isPlaying }
    }

    @Test
    fun appStop_unloadsTheQueueAndLetsTheServiceGo() {
        loadTwoChapters()
        NativeAudioRuntime.play(context)
        val player = sessionPlayer()
        runMainLooperUntil { player.isPlaying }
        val before = NativeAudioRuntime.getState(context).queueGeneration
        assertTrue(NativeAudioRuntime.isServiceBindRequested())

        NativeAudioRuntime.stop(context)
        ShadowLooper.idleMainLooper()
        assertEquals(0, player.mediaItemCount)
        assertFalse(player.isPlaying)
        assertFalse("the binding that kept the service alive is gone", NativeAudioRuntime.isServiceBindRequested())
        val state = NativeAudioRuntime.getState(context)
        assertTrue("a new queue generation, so the app's indexes mean nothing", state.queueGeneration > before)
        assertEquals("app", state.queueOrigin)
        // Continue listening still knows where the listener was.
        assertNotNull(PlaybackStore(context).lastPlayed())

        // An earphone play now finds nothing loaded, so nothing plays behind the app's back.
        NativeAudioRuntime.play(context)
        ShadowLooper.idleMainLooper()
        assertFalse(player.isPlaying)
    }

    @Test
    fun skipTo_movesWithinTheQueueWithoutCountingTheSkippedChapters() {
        NativeAudioRuntime.setQueue(context, planItems() + planItems(from = 2), 0)
        NativeAudioRuntime.play(context)
        val player = sessionPlayer()
        runMainLooperUntil { player.isPlaying }
        val gen = NativeAudioRuntime.getState(context).queueGeneration

        assertTrue(NativeAudioRuntime.skipTo(context, 3, 12.0, gen))
        runMainLooperUntil { player.currentMediaItemIndex == 3 && player.isPlaying }
        assertTrue("started at the position asked for", player.currentPosition >= 12_000L)
        assertEquals("the same queue", gen, NativeAudioRuntime.getState(context).queueGeneration)
        assertEquals(emptyList<Int>(), NativeAudioRuntime.getState(context).finished)
        assertEquals(0, NativeAudioRuntime.completions(context).length())

        // Back to the start of the queue.
        assertTrue(NativeAudioRuntime.skipTo(context, 0, 0.0, gen))
        runMainLooperUntil { player.currentMediaItemIndex == 0 }
        // An app that has not seen the latest queue is refused, and so is a bad index.
        assertFalse(NativeAudioRuntime.skipTo(context, 1, 0.0, gen + 1))
        assertFalse(NativeAudioRuntime.skipTo(context, 9, 0.0, gen))
        assertEquals(0, player.currentMediaItemIndex)
    }

    @Test
    fun skipTo_afterThePlayerWentIdle_preparesAndPlays() {
        NativeAudioRuntime.setQueue(context, planItems(), 0)
        NativeAudioRuntime.play(context)
        val player = sessionPlayer()
        runMainLooperUntil { player.isPlaying }
        player.stop()
        runMainLooperUntil { player.playbackState == Player.STATE_IDLE }
        assertTrue(NativeAudioRuntime.skipTo(context, 1, 0.0, null))
        runMainLooperUntil { player.isPlaying && player.currentMediaItemIndex == 1 }
    }

    @Test
    fun appDevotional_heardToTheEnd_isRecordedNatively() {
        // A devotional the app started (not the car): the activity may be gone by the time it
        // ends, so native records it under its dev/ media id for the app to collect.
        val id = "spurgeon-morning-evening:09-25:m"
        NativeAudioRuntime.setQueue(
            context,
            listOf(
                QueueItemArg().apply {
                    src = "https://example.invalid/devotional/09-25-m.mp3"
                    title = "Morning — 25 September · Spurgeon"
                    mediaId = MediaIds.devotional(id)
                },
            ),
            0,
        )
        NativeAudioRuntime.play(context)
        val player = sessionPlayer()
        runMainLooperUntil { player.isPlaying }
        runMainLooperUntil { player.duration > 0 }
        player.seekTo(player.duration - 200L)
        runMainLooperUntil { player.playbackState == Player.STATE_ENDED }
        val completions = NativeAudioRuntime.completions(context)
        assertEquals(1, completions.length())
        assertEquals("devotional", completions.getJSONObject(0).getString("kind"))
        assertEquals(id, completions.getJSONObject(0).getString("devotionalId"))
        assertEquals(1, NativeAudioRuntime.getState(context).pendingCompletions)
    }

    @Test
    fun aCacheFileIsNotOfferedAsContinueListening() {
        // The phone's-voice devotional plays from the app's cache, which is pruned; the car
        // must not be offered it later.
        NativeAudioRuntime.setQueue(
            context,
            listOf(
                QueueItemArg().apply {
                    src = "file:///data/user/0/app/cache/device-tts/morning-09-25.wav"
                    title = "Morning"
                    mediaId = MediaIds.devotional("spurgeon-morning-evening:09-25:m")
                },
            ),
            0,
        )
        NativeAudioRuntime.play(context)
        runMainLooperUntil { sessionPlayer().isPlaying }
        NativeAudioRuntime.pause(context)
        ShadowLooper.idleMainLooper()
        assertNull(PlaybackStore(context).lastPlayed())
        assertTrue(PlaybackStore(context).recent().isEmpty())
    }

    @Test
    fun getState_doesNotBuildThePlayer() {
        // At start the app asks whether anything already plays; that alone must not create
        // ExoPlayer and the media session.
        NativeAudioRuntime.dispose(context)
        val state = NativeAudioRuntime.getState(context)
        assertEquals("idle", state.status)
        assertNull(NativeAudioRuntime.mediaSession())
        // Nor do the car snapshot and the completions.
        assertTrue(NativeAudioRuntime.setCarSnapshot(context, JSONObject().put("version", 1).toString()))
        assertEquals(0, NativeAudioRuntime.completions(context).length())
        assertNull(NativeAudioRuntime.mediaSession())
    }

    /* ----------------------------------- completions --------------------------------- */

    @Test
    fun completions_areCappedAckedBySequenceAndCountedWithoutParsing() {
        val store = PlaybackStore(context)
        val chapter = MediaIds.Parsed.PlanTrack("p", 0, 0, "GEN", 1)
        repeat(PlaybackStore.COMPLETION_LIMIT + 20) { i ->
            store.addCompletion(chapter.copy(readingIndex = i), MediaIds.plan("p", 0, i, "GEN", 1))
        }
        val all = store.completions()
        assertEquals(PlaybackStore.COMPLETION_LIMIT, all.length())
        assertEquals(PlaybackStore.COMPLETION_LIMIT, store.pendingCompletionCount())
        // The oldest were dropped, the newest kept, in order.
        assertEquals(20, all.getJSONObject(0).getInt("planReadingIndex"))
        val lastSeq = all.getJSONObject(all.length() - 1).getLong("seq")
        assertEquals((PlaybackStore.COMPLETION_LIMIT + 20).toLong(), lastSeq)

        // Acknowledge up to the 100th kept entry: exactly those go.
        val upTo = all.getJSONObject(99).getLong("seq")
        store.ackCompletions(upTo)
        assertEquals(PlaybackStore.COMPLETION_LIMIT - 100, store.completions().length())
        assertEquals(PlaybackStore.COMPLETION_LIMIT - 100, store.pendingCompletionCount())
        // Another instance on the same file (the runtime's) agrees.
        assertEquals(PlaybackStore.COMPLETION_LIMIT - 100, PlaybackStore(context).pendingCompletionCount())

        // Sequence numbers keep rising after an ack, so a later ack never drops a new entry.
        store.ackCompletions(lastSeq)
        assertEquals(0, store.pendingCompletionCount())
        store.addDevotionalCompletion(MediaIds.Parsed.Devotional("d:09-25:m"), MediaIds.devotional("d:09-25:m"))
        val fresh = store.completions().getJSONObject(0).getLong("seq")
        assertTrue("seq $fresh after $lastSeq", fresh > lastSeq)
        store.ackCompletions(lastSeq)
        assertEquals(1, store.pendingCompletionCount())
    }

    /* ------------------------------------- artwork ----------------------------------- */

    @Test
    fun artworkProvider_drawsOnlyThePagesTheLibraryLists() {
        assertEquals("Psalms" to "51–100", ArtworkTiles.spec(listOf("range", "PSA", "51", "100")))
        assertEquals("Psalms" to "101–150", ArtworkTiles.spec(listOf("range", "PSA", "101", "150")))
        // Not a page boundary, past the end, backwards, or a range the library never shows.
        for (bad in listOf(
            listOf("range", "PSA", "2", "51"),
            listOf("range", "PSA", "151", "200"),
            listOf("range", "PSA", "51", "60"),
            listOf("range", "PSA", "100", "51"),
            listOf("range", "PSA", "1", "999999"),
            listOf("range", "PSA", "-49", "0"),
            listOf("range", "XYZ", "1", "50"),
        )) {
            assertNull(bad.toString(), ArtworkTiles.spec(bad))
            assertNull(bad.toString(), ArtworkTiles.file(context, bad))
        }
        // So the provider refuses them without writing anything.
        val dir = File(context.cacheDir, "car-artwork")
        val before = dir.listFiles()?.size ?: 0
        val provider = org.robolectric.Robolectric.setupContentProvider(ArtworkTilesProvider::class.java, ArtworkTiles.authority(context))
        assertFalse(runCatching { provider.openFile(Uri.parse("content://${ArtworkTiles.authority(context)}/range/PSA/7/8"), "r") }.isSuccess)
        assertEquals(before, dir.listFiles()?.size ?: 0)
    }

    /* -------------------------------------- speed ------------------------------------ */

    @Test
    fun speedButton_stepsThroughTheAppsSpeeds() {
        // The app's menu and the car's button share one list: src/audio/speeds.json.
        val json = JSONObject(File(repo(), "src/audio/speeds.json").readText()).getJSONArray("speeds")
        val appSpeeds = (0 until json.length()).map { json.getDouble(it).toFloat() }
        assertEquals(appSpeeds, SessionCommands.SPEEDS.toList())
        // Up through the list from 1×, then round to the slowest.
        var s = 1.0f
        val seen = mutableListOf<Float>()
        repeat(SessionCommands.SPEEDS.size) {
            s = SessionCommands.nextSpeed(s)
            seen.add(s)
        }
        assertEquals(listOf(1.2f, 1.5f, 1.8f, 2.0f, 0.8f, 1.0f), seen)
        // A speed set some other way goes to the next one up.
        assertEquals(1.5f, SessionCommands.nextSpeed(1.25f), 0.001f)
        assertEquals(0.8f, SessionCommands.nextSpeed(3.0f), 0.001f)
        assertEquals("1.2×", SessionCommands.formatSpeed(1.2f))
        assertEquals("1×", SessionCommands.formatSpeed(1.0f))
        assertEquals("0.75×", SessionCommands.formatSpeed(0.75f))
    }

    /* ------------------------------------- helpers ----------------------------------- */

    private fun repo(): File {
        var dir: File? = File(System.getProperty("user.dir")).absoluteFile
        while (dir != null && !File(dir, "src/audio/speeds.json").isFile) dir = dir.parentFile
        assertNotNull("repository root not found above ${System.getProperty("user.dir")}", dir)
        return dir!!
    }

    private fun sessionPlayer(): Player = NativeAudioRuntime.mediaSessionPlayer()!!

    private fun loadTwoChapters() {
        NativeAudioRuntime.setQueue(context, planItems(), 0)
    }

    private fun planItems(from: Int = 0): List<QueueItemArg> =
        listOf(from, from + 1).map { ri ->
            QueueItemArg().apply {
                src = BibleCatalog.chapterAudioUrl("GEN", ri + 1)
                title = "Genesis ${ri + 1}"
                mediaId = MediaIds.plan("p", 0, ri, "GEN", ri + 1)
                group = ri
            }
        }
}
