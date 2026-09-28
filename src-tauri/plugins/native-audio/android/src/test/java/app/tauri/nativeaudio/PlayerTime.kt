package app.tauri.nativeaudio

import android.content.Context
import android.os.Looper
import androidx.annotation.OptIn
import androidx.media3.common.util.Clock
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.test.utils.FakeMediaSourceFactory
import androidx.media3.test.utils.TestExoPlayerBuilder
import org.robolectric.Shadows.shadowOf
import java.time.Duration

/*
 * A fake player whose time only moves when the test moves it.
 *
 * TestExoPlayerBuilder's default clock is an auto-advancing FakeClock. It runs the playback
 * thread as fast as that thread can go and, under Robolectric, pushes the shared SystemClock
 * forward as it goes (FakeClock calls SystemClock.setCurrentTimeMillis). How far it gets
 * depends on how the threads are scheduled, so a test that reads a position, or a sleep timer
 * that counts down on SystemClock.elapsedRealtime, sees a different time on every run.
 *
 * Clock.DEFAULT is Robolectric's paused SystemClock: the player, the sleep timer and the main
 * looper then share one clock that moves only when the test idles the looper for a time.
 */

/** Media3's fake player (no network, no audio hardware) on the looper's clock. */
@OptIn(UnstableApi::class)
internal fun fakePlayerOnLooperTime(context: Context): ExoPlayer =
    TestExoPlayerBuilder(context).setClock(Clock.DEFAULT).setMediaSourceFactory(FakeMediaSourceFactory()).build()

/**
 * Move time on in 10 ms steps, running the main looper, until [condition] holds. With the
 * player on the looper's clock it plays only as far as this goes. Media3's
 * RobolectricUtil.runMainLooperUntil only runs tasks already queued on the main looper, so it
 * would not move the player on while that queue is empty.
 */
internal fun runUntil(maxMs: Long = 60_000L, condition: () -> Boolean) {
    val looper = shadowOf(Looper.getMainLooper())
    var waited = 0L
    val realDeadline = System.nanoTime() + REAL_TIMEOUT_NS
    while (!condition()) {
        if (waited < maxMs) {
            looper.idleFor(Duration.ofMillis(STEP_MS))
            waited += STEP_MS
        } else {
            // Out of player time: give the playback thread real time to catch up before failing.
            if (System.nanoTime() > realDeadline) throw AssertionError("condition not met within $maxMs ms of player time")
            looper.idle()
            Thread.sleep(1L)
        }
    }
}

private const val STEP_MS = 10L
private const val REAL_TIMEOUT_NS = 10_000_000_000L
