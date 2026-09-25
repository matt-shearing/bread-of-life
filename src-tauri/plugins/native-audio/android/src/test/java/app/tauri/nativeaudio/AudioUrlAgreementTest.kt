package app.tauri.nativeaudio

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Test
import org.junit.runner.RunWith
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.robolectric.annotation.Config
import java.io.File

/**
 * The car builds chapter URLs natively; the app builds them in TypeScript
 * (src/audio/audioUrl.ts). Both are checked against the same fixture of URLs copied from the
 * bundled Bible files, src/audio/audio-url-cases.json (the JS side: scripts/test-audio-url.mjs).
 * Runs under Robolectric only for Android's org.json.
 */
@RunWith(AndroidJUnit4::class)
@Config(sdk = [34])
class AudioUrlAgreementTest {
    private val repo: File by lazy {
        var dir: File? = File(System.getProperty("user.dir")).absoluteFile
        while (dir != null && !File(dir, "src/audio/audio-url-cases.json").isFile) dir = dir.parentFile
        assertNotNull("repository root not found above ${System.getProperty("user.dir")}", dir)
        dir!!
    }

    @Test
    fun kotlinBuildsTheSameUrlsAsTheAppAndTheBundledBible() {
        val cases = JSONObject(File(repo, "src/audio/audio-url-cases.json").readText()).getJSONArray("cases")
        assert(cases.length() >= 5)
        for (i in 0 until cases.length()) {
            val c = cases.getJSONObject(i)
            val expected = c.getString("url")
            assertEquals(expected, BibleCatalog.chapterAudioUrl(c.getString("ho"), c.getInt("chapter"), c.getString("narrator")))
            // And the parser reads it back.
            val parsed = BibleCatalog.parseAudioUrl(expected)!!
            assertEquals(c.getString("ho"), parsed.ho)
            assertEquals(c.getInt("chapter"), parsed.chapter)
        }
    }

    @Test
    fun bookListMatchesTheBundledIndex() {
        val index = JSONArray(File(repo, "public/bible/bsb/index.json").readText())
        assertEquals(66, index.length())
        assertEquals(66, BibleCatalog.BOOKS.size)
        for (i in 0 until index.length()) {
            val b = index.getJSONObject(i)
            val k = BibleCatalog.BOOKS[i]
            assertEquals(b.getString("id"), k.ho)
            assertEquals(b.getString("name"), k.name)
            assertEquals(b.getInt("order"), k.order)
            assertEquals("chapters of ${k.name}", b.getInt("chapters"), k.chapters)
            assertEquals(b.getString("testament"), k.testament)
        }
    }
}
