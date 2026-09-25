package app.tauri.nativeaudio

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Bundle
import android.os.Looper
import androidx.annotation.OptIn
import androidx.media3.common.MediaItem
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.session.LibraryResult
import androidx.media3.session.MediaBrowser
import androidx.media3.session.MediaConstants
import androidx.media3.session.MediaLibraryService
import androidx.media3.session.SessionCommand
import androidx.media3.session.SessionResult
import androidx.media3.test.utils.FakeMediaSourceFactory
import androidx.media3.test.utils.TestExoPlayerBuilder
import androidx.media3.test.utils.robolectric.RobolectricUtil.runMainLooperUntil
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.google.common.collect.ImmutableList
import com.google.common.util.concurrent.ListenableFuture
import org.json.JSONArray
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
import org.robolectric.Robolectric
import org.robolectric.annotation.Config
import org.robolectric.shadows.ShadowLooper

/**
 * Android Auto, driven the way the car drives it: a Media3 MediaBrowser connected to the real
 * library session browses the tree, plays by media id, searches, and presses the custom
 * buttons. The player is Media3's fake (no network, no audio hardware).
 */
@RunWith(AndroidJUnit4::class)
@Config(sdk = [34])
@OptIn(UnstableApi::class)
class AndroidAutoTest {
    private val context: Context = ApplicationProvider.getApplicationContext()
    private var browser: MediaBrowser? = null

    @Before
    fun setUp() {
        NativeAudioRuntime.playerFactory = { ctx ->
            TestExoPlayerBuilder(ctx).setMediaSourceFactory(FakeMediaSourceFactory()).build()
        }
        CarStore(context).clearForTest()
        NativeAudioRuntime.ensure(context)
    }

    @After
    fun tearDown() {
        browser?.release()
        browser = null
        NativeAudioRuntime.dispose(context)
        CarStore(context).clearForTest()
        ShadowLooper.idleMainLooper()
    }

    /* ------------------------------------ browse ------------------------------------ */

    @Test
    fun browseBibleToGenesis3_playsGenesis3WithTheRightUrl() {
        val b = connect()
        val root = await(b.getLibraryRoot(null))
        assertEquals(MediaIds.ROOT, root.value!!.mediaId)
        assertEquals(
            MediaConstants.EXTRAS_VALUE_CONTENT_STYLE_LIST_ITEM,
            root.params!!.extras.getInt(MediaConstants.EXTRAS_KEY_CONTENT_STYLE_PLAYABLE),
        )

        // No devotional audio in the snapshot yet, so three tabs.
        val tabs = children(b, MediaIds.ROOT)
        assertEquals(listOf("Today", "Bible", "Recent"), tabs.map { it.mediaMetadata.title.toString() })
        assertTrue(tabs.all { it.mediaMetadata.isBrowsable == true })
        assertTrue(tabs.all { it.mediaMetadata.artworkUri.toString().startsWith("android.resource://") })

        val testaments = children(b, MediaIds.TAB_BIBLE)
        assertEquals(listOf("Old Testament", "New Testament"), testaments.map { it.mediaMetadata.title.toString() })
        // Books show as a grid of tiles.
        assertEquals(
            MediaConstants.EXTRAS_VALUE_CONTENT_STYLE_GRID_ITEM,
            testaments[0].mediaMetadata.extras!!.getInt(MediaConstants.EXTRAS_KEY_CONTENT_STYLE_BROWSABLE),
        )

        val books = children(b, testaments[0].mediaId)
        assertEquals(39, books.size)
        assertEquals("Genesis", books[0].mediaMetadata.title.toString())
        assertEquals("content", books[0].mediaMetadata.artworkUri!!.scheme)
        assertEquals(27, children(b, testaments[1].mediaId).size)

        val genesis = books[0]
        assertEquals(
            MediaConstants.EXTRAS_VALUE_CONTENT_STYLE_GRID_ITEM,
            genesis.mediaMetadata.extras!!.getInt(MediaConstants.EXTRAS_KEY_CONTENT_STYLE_PLAYABLE),
        )
        val chapters = children(b, genesis.mediaId)
        assertEquals(50, chapters.size)
        val three = chapters[2]
        assertEquals("ch/GEN/3", three.mediaId)
        assertEquals("Genesis 3", three.mediaMetadata.title.toString())
        assertEquals(CarArtwork.chapterUri(context, "GEN", 3), three.mediaMetadata.artworkUri)
        assertTrue(three.mediaMetadata.isPlayable == true)

        // The car sends only the media id; the session works out the URL and the queue.
        b.setMediaItem(MediaItem.Builder().setMediaId(three.mediaId).build())
        b.prepare()
        b.play()
        val player = sessionPlayer()
        runMainLooperUntil { player.currentMediaItem != null && player.isPlaying }
        assertEquals("https://audio.bible.helloao.org/api/BSB/GEN/3/audio/david.mp3", player.currentMediaItem!!.localConfiguration!!.uri.toString())
        // It carries on through the Bible, like the app's Bible page, and the car sees the queue.
        assertEquals("https://audio.bible.helloao.org/api/BSB/GEN/4/audio/david.mp3", player.getMediaItemAt(1).localConfiguration!!.uri.toString())
        assertEquals(CarLibrary.BIBLE_QUEUE_LIMIT, player.mediaItemCount)
        runMainLooperUntil { b.mediaItemCount == CarLibrary.BIBLE_QUEUE_LIMIT }
        assertEquals("Genesis 4", b.getMediaItemAt(1).mediaMetadata.title.toString())

        // And the app, when it next looks, is told the queue came from outside it.
        val state = NativeAudioRuntime.getState(context)
        assertEquals("car", state.queueOrigin)
    }

    @Test
    fun psalmsIsSplitIntoPagesOfFifty() {
        val b = connect()
        val pages = children(b, MediaIds.book("PSA"))
        assertEquals(listOf("Psalms 1–50", "Psalms 51–100", "Psalms 101–150"), pages.map { it.mediaMetadata.title.toString() })
        val last = children(b, pages[2].mediaId)
        assertEquals(50, last.size)
        assertEquals("ch/PSA/150", last.last().mediaId)
    }

    @Test
    fun todayReflectsThePushedSnapshot() {
        assertTrue(NativeAudioRuntime.setCarSnapshot(context, snapshotJson(doneReadingIndexes = setOf(0))))
        val b = connect()

        val tabs = children(b, MediaIds.ROOT)
        assertEquals(listOf("Today", "Bible", "Devotional", "Recent"), tabs.map { it.mediaMetadata.title.toString() })

        val today = children(b, MediaIds.TAB_TODAY)
        assertEquals(
            listOf("Play today’s reading", "Genesis 1–2", "Matthew 1"),
            today.map { it.mediaMetadata.title.toString() },
        )
        assertEquals("Soul Food Max · Day 12", today[0].mediaMetadata.extras!!.getString(MediaConstants.EXTRAS_KEY_CONTENT_STYLE_GROUP_TITLE))
        assertEquals(
            MediaConstants.EXTRAS_VALUE_COMPLETION_STATUS_PARTIALLY_PLAYED,
            today[1].mediaMetadata.extras!!.getInt(MediaConstants.EXTRAS_KEY_COMPLETION_STATUS),
        )
        assertEquals("2 chapters left, from where you are", today[0].mediaMetadata.subtitle.toString())

        val devotional = children(b, MediaIds.TAB_DEVOTIONAL)
        assertEquals(listOf("Morning — Sep 25"), devotional.map { it.mediaMetadata.title.toString() })

        // "Play today's reading" starts at the first chapter not yet read.
        b.setMediaItem(MediaItem.Builder().setMediaId(today[0].mediaId).build())
        b.prepare()
        b.play()
        val player = sessionPlayer()
        runMainLooperUntil { player.isPlaying }
        assertEquals(3, player.mediaItemCount)
        assertEquals(1, player.currentMediaItemIndex)
        assertEquals("plan/soul-food-max/11/1/GEN/2/", player.currentMediaItem!!.mediaId + "/")
        assertEquals("https://audio.bible.helloao.org/api/BSB/GEN/2/audio/david.mp3", player.currentMediaItem!!.localConfiguration!!.uri.toString())
    }

    @Test
    fun noPlan_saysSoInsteadOfAnEmptyTab() {
        val b = connect()
        val today = children(b, MediaIds.TAB_TODAY)
        assertEquals(listOf("No reading plan yet"), today.map { it.mediaMetadata.title.toString() })
        val recent = children(b, MediaIds.TAB_RECENT)
        assertEquals(listOf("Nothing played yet"), recent.map { it.mediaMetadata.title.toString() })
    }

    /* ------------------------------------ search ------------------------------------ */

    @Test
    fun searchJohn3_findsJohn3() {
        val b = connect()
        val searched = await(b.search("john 3", null))
        assertEquals(LibraryResult.RESULT_SUCCESS, searched.resultCode)
        val results = await(b.getSearchResult("john 3", 0, 20, null)).value!!
        assertEquals("ch/JHN/3", results[0].mediaId)
        assertEquals("John 3", results[0].mediaMetadata.title.toString())
    }

    @Test
    fun voiceRequest_playJohn3OnBreadOfLife() {
        val b = connect()
        // What Android Auto sends for "Hey Google, play John 3 on Bread of Life".
        b.setMediaItem(searchRequest("John 3 on Bread of Life"))
        b.prepare()
        b.play()
        val player = sessionPlayer()
        runMainLooperUntil { player.isPlaying }
        assertEquals("https://audio.bible.helloao.org/api/BSB/JHN/3/audio/david.mp3", player.currentMediaItem!!.localConfiguration!!.uri.toString())
    }

    @Test
    fun voiceRequest_playTodaysReading() {
        NativeAudioRuntime.setCarSnapshot(context, snapshotJson())
        val b = connect()
        b.setMediaItem(searchRequest("today's reading"))
        b.prepare()
        b.play()
        val player = sessionPlayer()
        runMainLooperUntil { player.isPlaying }
        assertEquals(3, player.mediaItemCount)
        assertEquals(0, player.currentMediaItemIndex)
        assertTrue(player.currentMediaItem!!.mediaId.startsWith("plan/"))
    }

    @Test
    fun referenceParser_understandsHowPeopleSayChapters() {
        fun ref(q: String) = RefParser.parse(q)?.let { "${it.book.ho} ${it.chapter}" }
        assertEquals("JHN 3", ref("john 3"))
        assertEquals("JHN 3", ref("play John chapter three on Bread of Life"))
        assertEquals("JHN 3", ref("john three sixteen"))
        assertEquals("JHN 3", ref("John 3:16"))
        assertEquals("1CO 13", ref("first corinthians chapter thirteen"))
        assertEquals("1CO 13", ref("1 Cor 13"))
        assertEquals("1JN 2", ref("1john 2"))
        assertEquals("PSA 119", ref("psalm one hundred and nineteen"))
        assertEquals("PSA 23", ref("Psalm 23"))
        assertEquals("SNG 2", ref("song of songs 2"))
        assertEquals("2KI 5", ref("second kings five"))
        assertEquals("JUD 1", ref("jude"))
        assertEquals("ROM 8", ref("the book of romans chapter 8"))
        assertEquals("GEN 1", ref("genesis"))
        assertNull(ref("john 30"))
        assertNull(ref("something else entirely"))
        assertEquals(RefParser.Intent.TODAY, RefParser.intent("today's reading"))
        assertEquals(RefParser.Intent.CONTINUE, RefParser.intent("resume"))
        assertEquals(RefParser.Intent.CONTINUE, RefParser.intent(""))
        assertEquals(RefParser.Intent.MORNING, RefParser.intent("morning devotional"))
    }

    /* ------------------------------ buttons and the queue ---------------------------- */

    @Test
    fun customButtons_reachTheSession() {
        NativeAudioRuntime.setCarSnapshot(context, snapshotJson())
        val b = connect()
        assertEquals(listOf("Back 30 seconds", "Next reading", "Speed 1×"), b.customLayout.map { it.displayName.toString() })

        b.setMediaItem(MediaItem.Builder().setMediaId(MediaIds.TODAY_ALL).build())
        b.prepare()
        b.play()
        val player = sessionPlayer()
        runMainLooperUntil { player.isPlaying && player.currentMediaItemIndex == 0 }

        // Next reading skips Genesis 1–2 (two chapters) to Matthew 1.
        assertEquals(SessionResult.RESULT_SUCCESS, await(b.sendCustomCommand(SessionCommand(CarCommands.NEXT_READING, Bundle.EMPTY), Bundle.EMPTY)).resultCode)
        runMainLooperUntil { player.currentMediaItemIndex == 2 }
        assertTrue(player.currentMediaItem!!.mediaId.endsWith("/MAT/1"))

        // Back 30 seconds.
        player.seekTo(100_000L)
        ShadowLooper.idleMainLooper()
        await(b.sendCustomCommand(SessionCommand(CarCommands.BACK_30, Bundle.EMPTY), Bundle.EMPTY))
        assertTrue("position ${player.currentPosition}", player.currentPosition in 69_000L..72_000L)

        // Speed steps to 1.2×, and the button now says so.
        await(b.sendCustomCommand(SessionCommand(CarCommands.SPEED, Bundle.EMPTY), Bundle.EMPTY))
        assertEquals(1.2f, player.playbackParameters.speed, 0.001f)
        runMainLooperUntil { b.customLayout.any { it.displayName.toString() == "Speed 1.2×" } }
    }

    @Test
    fun planChapterFinishedInTheCar_isQueuedForTheApp() {
        NativeAudioRuntime.setCarSnapshot(context, snapshotJson())
        val b = connect()
        b.setMediaItem(MediaItem.Builder().setMediaId(MediaIds.TODAY_ALL).build())
        b.prepare()
        b.play()
        val player = sessionPlayer()
        runMainLooperUntil { player.isPlaying }

        playToTheEndOfTheCurrentChapter(player)
        runMainLooperUntil { player.currentMediaItemIndex == 1 }

        val completions = NativeAudioRuntime.carCompletions(context)
        assertEquals(1, completions.length())
        val c = completions.getJSONObject(0)
        assertEquals("soul-food-max", c.getString("planId"))
        assertEquals(11, c.getInt("planDay"))
        assertEquals(0, c.getInt("planReadingIndex"))
        assertEquals(1, NativeAudioRuntime.getState(context).pendingCompletions)
        // The car's Today list ticks it straight away.
        val track = CarStore(context).snapshot().today!!.tracks[0]
        assertTrue(track.done)

        NativeAudioRuntime.ackCarCompletions(context, c.getLong("seq"))
        assertEquals(0, NativeAudioRuntime.carCompletions(context).length())
    }

    @Test
    fun appQueue_isNotReportedTwice() {
        // A day the APP loaded marks its own chapters read; native must not queue them too.
        NativeAudioRuntime.setQueue(
            context,
            listOf(
                QueueItemArg().apply { src = BibleCatalog.chapterAudioUrl("GEN", 1); title = "Genesis 1"; mediaId = MediaIds.plan("p", 0, 0, "GEN", 1) },
                QueueItemArg().apply { src = BibleCatalog.chapterAudioUrl("GEN", 2); title = "Genesis 2"; mediaId = MediaIds.plan("p", 0, 1, "GEN", 2) },
            ),
            0,
        )
        NativeAudioRuntime.play(context)
        val player = sessionPlayer()
        runMainLooperUntil { player.isPlaying }
        assertEquals("app", NativeAudioRuntime.getState(context).queueOrigin)
        playToTheEndOfTheCurrentChapter(player)
        runMainLooperUntil { player.currentMediaItemIndex == 1 }
        assertEquals(0, NativeAudioRuntime.carCompletions(context).length())
        // …but it still shows in Recent, with its tile.
        val recent = CarStore(context).recent()
        assertEquals("ch/GEN/2", MediaIds.chapterOf(recent[0].mediaId)!!.let { (ho, c) -> MediaIds.chapter(ho, c) })
        assertEquals(CarArtwork.chapterUri(context, "GEN", 1), player.getMediaItemAt(0).mediaMetadata.artworkUri)
    }

    @Test
    fun continueListening_resumesWhereItStopped() {
        val b = connect()
        b.setMediaItem(MediaItem.Builder().setMediaId("ch/ROM/8").build())
        b.prepare()
        b.play()
        val player = sessionPlayer()
        runMainLooperUntil { player.isPlaying }
        player.seekTo(125_000L)
        ShadowLooper.idleMainLooper()
        b.pause()
        runMainLooperUntil { !player.isPlaying }

        val today = children(b, MediaIds.TAB_TODAY)
        assertEquals(MediaIds.CONTINUE, today[0].mediaId)
        assertEquals("Romans 8", today[0].mediaMetadata.title.toString())
        assertEquals("Continue listening · 2:05 in", today[0].mediaMetadata.subtitle.toString())
        assertEquals("ch/ROM/8", children(b, MediaIds.TAB_RECENT)[0].mediaId)

        // A fresh start (nothing loaded): "resume" picks up at the same place.
        val resumed = NativeAudioRuntime.carLibrary()!!.resumption()!!
        assertEquals("ch/ROM/8", resumed.mediaItems[resumed.startIndex].mediaId)
        assertTrue(resumed.startPositionMs in 124_000L..126_000L)
    }

    @Test
    fun appCanReadTheQueueTheCarStarted() {
        NativeAudioRuntime.setCarSnapshot(context, snapshotJson())
        val b = connect()
        b.setMediaItem(MediaItem.Builder().setMediaId(MediaIds.reading(1)).build())
        b.prepare()
        runMainLooperUntil { sessionPlayer().mediaItemCount == 3 }
        val q = NativeAudioRuntime.queueItems(context)
        assertEquals("car", q.getString("queueOrigin"))
        assertEquals(2, q.getInt("index"))
        val item = q.getJSONArray("items").getJSONObject(2)
        assertEquals("MAT", item.getString("ho"))
        assertEquals(2, item.getInt("planReadingIndex"))
        assertEquals(1, item.getInt("readingGroup"))
        assertEquals("soul-food-max", item.getString("planId"))
    }

    /* ---------------------------------- declarations --------------------------------- */

    @Test
    fun serviceIsDiscoverableAsAMediaBrowserService() {
        val pm = context.packageManager
        for (action in listOf("android.media.browse.MediaBrowserService", MediaLibraryService.SERVICE_INTERFACE)) {
            val found = pm.queryIntentServices(Intent(action).setPackage(context.packageName), 0)
            assertTrue("$action not declared", found.any { it.serviceInfo.name == NativeAudioService::class.java.name })
        }
        val service = pm.getServiceInfo(ComponentName(context, NativeAudioService::class.java), 0)
        assertTrue("Android Auto cannot bind an unexported service", service.exported)
        val app = pm.getApplicationInfo(context.packageName, PackageManager.GET_META_DATA)
        assertNotNull(app.metaData?.get("com.google.android.gms.car.application"))
    }

    @Test
    fun artworkProvider_servesAPngTile() {
        val provider = Robolectric.setupContentProvider(CarArtworkProvider::class.java, CarArtwork.authority(context))
        val pfd = provider.openFile(CarArtwork.chapterUri(context, "JHN", 3), "r")
        val bytes = android.os.ParcelFileDescriptor.AutoCloseInputStream(pfd).use { it.readBytes() }
        assertTrue(bytes.size > 8)
        assertEquals(0x89.toByte(), bytes[0])
        assertEquals('P'.code.toByte(), bytes[1])
        // Unknown paths are refused rather than drawn.
        assertFalse(runCatching { provider.openFile(Uri.parse("content://${CarArtwork.authority(context)}/chapter/JHN/99"), "r") }.isSuccess)
    }

    /* ------------------------------------ helpers ------------------------------------ */

    private fun connect(): MediaBrowser {
        val token = NativeAudioRuntime.mediaSession()!!.token
        val future = MediaBrowser.Builder(context, token).setApplicationLooper(Looper.getMainLooper()).buildAsync()
        runMainLooperUntil { future.isDone }
        return future.get().also { browser = it }
    }

    private fun <T> await(future: ListenableFuture<T>): T {
        runMainLooperUntil { future.isDone }
        return future.get()
    }

    private fun children(b: MediaBrowser, parentId: String): ImmutableList<MediaItem> {
        val result = await(b.getChildren(parentId, 0, Int.MAX_VALUE, null))
        assertEquals("children of $parentId", LibraryResult.RESULT_SUCCESS, result.resultCode)
        return result.value!!
    }

    private fun sessionPlayer(): Player = NativeAudioRuntime.mediaSessionPlayer()!!

    private fun searchRequest(query: String): MediaItem = MediaItem.Builder()
        .setRequestMetadata(MediaItem.RequestMetadata.Builder().setSearchQuery(query).build())
        .build()

    private fun playToTheEndOfTheCurrentChapter(player: Player) {
        runMainLooperUntil { player.duration > 0 }
        player.seekTo(player.duration - 200L)
        player.play()
    }

    private fun snapshotJson(doneReadingIndexes: Set<Int> = emptySet()): String {
        fun track(i: Int, group: Int, ho: String, c: Int, title: String) = JSONObject()
            .put("readingIndex", i).put("group", group).put("ho", ho).put("chapter", c)
            .put("title", title).put("subtitle", "Berean Standard Bible · David")
            .put("src", BibleCatalog.chapterAudioUrl(ho, c)).put("done", i in doneReadingIndexes)
        return JSONObject()
            .put("version", 1)
            .put("narrator", "david")
            .put("translation", "BSB")
            .put(
                "today",
                JSONObject()
                    .put("planId", "soul-food-max")
                    .put("planName", "Soul Food Max")
                    .put("day", 11)
                    .put(
                        "readings",
                        JSONArray()
                            .put(JSONObject().put("index", 0).put("label", "Genesis 1–2").put("kicker", "Old Testament").put("tracks", JSONArray().put(0).put(1)))
                            .put(JSONObject().put("index", 1).put("label", "Matthew 1").put("kicker", "New Testament").put("tracks", JSONArray().put(2))),
                    )
                    .put(
                        "tracks",
                        JSONArray()
                            .put(track(0, 0, "GEN", 1, "Genesis 1"))
                            .put(track(1, 0, "GEN", 2, "Genesis 2"))
                            .put(track(2, 1, "MAT", 1, "Matthew 1")),
                    ),
            )
            .put(
                "devotional",
                JSONArray().put(
                    JSONObject().put("id", "spurgeon-morning-evening:09-25:m").put("label", "Morning")
                        .put("title", "Morning — Sep 25").put("subtitle", "C. H. Spurgeon")
                        .put("src", "https://example.invalid/devotional/09-25-m.mp3"),
                ),
            )
            .toString()
    }
}
