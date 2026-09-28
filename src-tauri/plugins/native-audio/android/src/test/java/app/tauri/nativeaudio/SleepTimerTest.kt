package app.tauri.nativeaudio

import android.content.Context
import android.os.Looper
import androidx.annotation.OptIn
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.test.utils.FakeMediaSourceFactory
import androidx.media3.test.utils.TestExoPlayerBuilder
import androidx.media3.test.utils.robolectric.RobolectricUtil.runMainLooperUntil
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
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
import java.time.Duration

/**
 * The sleep timer (`set_sleep_timer`): a timed one fades the volume over the last 10 s and
 * pauses; "end of chapter" pauses at the item's end, where the chapter counts as heard; "end
 * of reading" waits for the reading's last chapter; a new queue or stop clears it.
 */
@RunWith(AndroidJUnit4::class)
@Config(sdk = [34])
@OptIn(UnstableApi::class)
class SleepTimerTest {
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

    @Test
    fun timedTimer_fadesTheLastSecondsThenPauses_andPutsTheVolumeBack() {
        loadAndPlay(items(groups = listOf(0, 1)))
        val player = sessionPlayer()

        NativeAudioRuntime.setSleepTimer(context, System.currentTimeMillis() + 15_000L, endOfItem = false, endOfGroup = false)
        ShadowLooper.idleMainLooper()
        val set = NativeAudioRuntime.getState(context).sleepTimer
        assertNotNull(set)
        assertEquals("time", set!!.mode)
        assertTrue("remaining ${set.remainingMs}", set.remainingMs!! in 13_000L..15_000L)
        assertTrue(set.endsAtEpochMs!! > System.currentTimeMillis())
        assertEquals("full volume before the fade", 1f, player.volume, 0.001f)

        // 7 s left: inside the 10 s fade.
        idleFor(8_000L)
        assertTrue("fading: ${player.volume}", player.volume > 0f && player.volume < 0.9f)
        assertTrue(player.playWhenReady)

        idleFor(8_000L)
        assertFalse("paused", player.playWhenReady)
        assertEquals("volume back for the next play", 1f, player.volume, 0.001f)
        assertNull(NativeAudioRuntime.getState(context).sleepTimer)
        assertEquals("paused, not stopped: the queue is still there", 2, player.mediaItemCount)

        // Play carries on from where it paused.
        NativeAudioRuntime.play(context)
        runMainLooperUntil { player.isPlaying }
    }

    @Test
    fun endOfChapter_pausesAtTheBoundary_countsTheChapterOnce_andPlayMovesOn() {
        loadAndPlay(items(groups = listOf(0, 1)))
        val player = sessionPlayer()
        runMainLooperUntil { player.duration > 0 }

        // Paused 3 s before the end, so the check sees the fade without racing the player.
        NativeAudioRuntime.pause(context)
        player.seekTo(player.duration - 3_000L)
        ShadowLooper.idleMainLooper()
        NativeAudioRuntime.setSleepTimer(context, null, endOfItem = true, endOfGroup = false)
        ShadowLooper.idleMainLooper()
        assertEquals("item", NativeAudioRuntime.getState(context).sleepTimer?.mode)
        assertTrue("fading near the end: ${player.volume}", player.volume < 0.5f)

        NativeAudioRuntime.play(context)
        runMainLooperUntil { !player.playWhenReady }
        assertEquals("paused at the end of the chapter, not in the next one", 0, player.currentMediaItemIndex)
        assertEquals(1f, player.volume, 0.001f)
        val state = NativeAudioRuntime.getState(context)
        assertNull(state.sleepTimer)
        assertEquals("heard to its end", listOf(0), state.finished)
        assertEquals("recorded now, for the app", 1, NativeAudioRuntime.completions(context).length())

        // Play goes on into the next chapter, without recording the first one again.
        NativeAudioRuntime.play(context)
        runMainLooperUntil { player.isPlaying && player.currentMediaItemIndex == 1 }
        assertEquals(1, NativeAudioRuntime.completions(context).length())
        assertEquals(listOf(0), NativeAudioRuntime.getState(context).finished)
    }

    @Test
    fun endOfReading_waitsForTheReadingsLastChapter() {
        // Genesis 1–2 is one reading, Matthew 1 the next.
        loadAndPlay(items(groups = listOf(0, 0, 1)))
        val player = sessionPlayer()
        runMainLooperUntil { player.duration > 0 }
        NativeAudioRuntime.setSleepTimer(context, null, endOfItem = false, endOfGroup = true)
        ShadowLooper.idleMainLooper()
        assertEquals("group", NativeAudioRuntime.getState(context).sleepTimer?.mode)
        assertNull("the reading's end is chapters away", NativeAudioRuntime.getState(context).sleepTimer?.remainingMs)

        // The end of Genesis 1: carries on into Genesis 2.
        player.seekTo(player.duration - 300L)
        runMainLooperUntil { player.currentMediaItemIndex == 1 }
        ShadowLooper.idleMainLooper()
        assertTrue(player.playWhenReady)
        assertEquals("group", NativeAudioRuntime.getState(context).sleepTimer?.mode)
        runMainLooperUntil { player.duration > 0 }
        assertNotNull("the last chapter of the reading: its time left is known", NativeAudioRuntime.getState(context).sleepTimer?.remainingMs)

        // The end of Genesis 2 ends the reading: paused there.
        player.seekTo(player.duration - 300L)
        runMainLooperUntil { !player.playWhenReady }
        assertEquals(1, player.currentMediaItemIndex)
        assertNull(NativeAudioRuntime.getState(context).sleepTimer)
        assertEquals(listOf(0, 1), NativeAudioRuntime.getState(context).finished)
    }

    @Test
    fun aNewQueueOrStop_clearsTheTimer() {
        loadAndPlay(items(groups = listOf(0, 1)))
        val player = sessionPlayer()
        NativeAudioRuntime.setSleepTimer(context, System.currentTimeMillis() + 5_000L, endOfItem = false, endOfGroup = false)
        ShadowLooper.idleMainLooper()
        assertTrue("already fading: ${player.volume}", player.volume < 1f)

        NativeAudioRuntime.setQueue(context, items(groups = listOf(0, 1)), 0)
        ShadowLooper.idleMainLooper()
        assertNull(NativeAudioRuntime.getState(context).sleepTimer)
        assertEquals(1f, player.volume, 0.001f)
        // Nothing fires later either.
        NativeAudioRuntime.play(context)
        runMainLooperUntil { player.isPlaying }
        idleFor(10_000L)
        assertTrue(player.playWhenReady)

        NativeAudioRuntime.setSleepTimer(context, null, endOfItem = true, endOfGroup = false)
        ShadowLooper.idleMainLooper()
        assertEquals("item", NativeAudioRuntime.getState(context).sleepTimer?.mode)
        NativeAudioRuntime.stop(context)
        ShadowLooper.idleMainLooper()
        assertNull(NativeAudioRuntime.getState(context).sleepTimer)

        // And cancelling is a set with nothing.
        NativeAudioRuntime.setQueue(context, items(groups = listOf(0, 1)), 0)
        NativeAudioRuntime.setSleepTimer(context, System.currentTimeMillis() + 60_000L, endOfItem = false, endOfGroup = false)
        NativeAudioRuntime.setSleepTimer(context, null, endOfItem = false, endOfGroup = false)
        ShadowLooper.idleMainLooper()
        assertNull(NativeAudioRuntime.getState(context).sleepTimer)
        assertNull(NativeAudioRuntime.sleepTimerForTest())
    }

    /* ------------------------------------- helpers ----------------------------------- */

    private fun idleFor(ms: Long) = shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMillis(ms))

    private fun sessionPlayer(): Player = NativeAudioRuntime.mediaSessionPlayer()!!

    private fun loadAndPlay(items: List<QueueItemArg>) {
        NativeAudioRuntime.setQueue(context, items, 0)
        NativeAudioRuntime.play(context)
        runMainLooperUntil { sessionPlayer().isPlaying }
    }

    /** A plan day's chapters, one per entry of [groups] (its reading group). */
    private fun items(groups: List<Int>): List<QueueItemArg> =
        groups.mapIndexed { i, g ->
            QueueItemArg().apply {
                src = BibleCatalog.chapterAudioUrl("GEN", i + 1)
                title = "Genesis ${i + 1}"
                mediaId = MediaIds.plan("p", 0, i, "GEN", i + 1)
                group = g
            }
        }
}
