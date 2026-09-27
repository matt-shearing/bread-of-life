package app.tauri.nativeaudio

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import java.io.File

/**
 * Draws a handful of the car's tiles with real graphics and keeps them in
 * build/car-artwork-samples/, so they can be looked at (CI uploads them).
 */
@RunWith(AndroidJUnit4::class)
@Config(sdk = [34])
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class CarArtworkSamplesTest {
    private val context: Context = ApplicationProvider.getApplicationContext()

    @Test
    fun drawSampleTiles() {
        val out = File("build/car-artwork-samples").apply { mkdirs() }
        val samples = listOf(
            listOf("chapter", "GEN", "3"),
            listOf("chapter", "PSA", "119"),
            listOf("chapter", "SNG", "8"),
            listOf("book", "1TH"),
            listOf("book", "JHN"),
            listOf("range", "PSA", "51", "100"),
            listOf("testament", "OT"),
            listOf("today"),
            listOf("continue"),
            listOf("devotional", "morning"),
        )
        for (segments in samples) {
            val file = CarArtwork.file(context, segments)
            assertNotNull(segments.toString(), file)
            val bytes = file!!.readBytes()
            assertEquals(0x89.toByte(), bytes[0])
            file.copyTo(File(out, segments.joinToString("-") + ".png"), overwrite = true)
        }
    }
}
