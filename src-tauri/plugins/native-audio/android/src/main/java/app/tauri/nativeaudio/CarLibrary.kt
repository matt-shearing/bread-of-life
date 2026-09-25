package app.tauri.nativeaudio

import android.content.Context
import android.net.Uri
import android.os.Bundle
import androidx.annotation.OptIn
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.util.UnstableApi
import androidx.media3.session.MediaConstants
import androidx.media3.session.MediaSession.MediaItemsWithStartPosition

/**
 * The Android Auto browse tree, and how anything in it becomes something to play.
 *
 *   Today       Continue listening · Play all of today · each of the day's readings
 *   Bible       Old Testament / New Testament → books (grid) → chapters (grid)
 *   Devotional  today's Morning and Evening, only when the app says audio exists
 *   Recent      the last ten chapters or devotionals played
 *
 * Nothing here needs the app to be running: the Bible comes from [BibleCatalog], Today and
 * Devotional from the app's last [CarSnapshot], Recent and Continue from [CarStore].
 */
@OptIn(UnstableApi::class)
internal class CarLibrary(private val context: Context, val store: CarStore) {

    fun snapshot(): CarSnapshot = store.snapshot()

    /* ------------------------------------ browse ------------------------------------ */

    fun rootItem(): MediaItem = folder(MediaIds.ROOT, "Bread of Life", mediaType = MediaMetadata.MEDIA_TYPE_FOLDER_MIXED)

    fun recentRootItem(): MediaItem = folder(MediaIds.RECENT_ROOT, "Bread of Life", mediaType = MediaMetadata.MEDIA_TYPE_FOLDER_MIXED)

    /** Extras for the root result: lists by default, grids where a node asks for them. */
    fun rootExtras(): Bundle = Bundle().apply {
        putInt(MediaConstants.EXTRAS_KEY_CONTENT_STYLE_BROWSABLE, MediaConstants.EXTRAS_VALUE_CONTENT_STYLE_LIST_ITEM)
        putInt(MediaConstants.EXTRAS_KEY_CONTENT_STYLE_PLAYABLE, MediaConstants.EXTRAS_VALUE_CONTENT_STYLE_LIST_ITEM)
    }

    /** The children of [parentId], or null when there is no such node. */
    fun children(parentId: String): List<MediaItem>? {
        val snap = snapshot()
        return when {
            parentId == MediaIds.ROOT -> tabs(snap)
            parentId == MediaIds.RECENT_ROOT -> listOfNotNull(continueItem(groupTitle = null))
            parentId == MediaIds.TAB_TODAY -> todayChildren(snap)
            parentId == MediaIds.TAB_BIBLE -> listOf(testamentFolder("OT"), testamentFolder("NT"))
            parentId == MediaIds.TAB_DEVOTIONAL -> snap.devotional.map { devotionalItem(it) }
            parentId == MediaIds.TAB_RECENT -> recentChildren()
            parentId == MediaIds.NO_PLAN || parentId == MediaIds.NOTHING_RECENT -> emptyList()
            parentId.startsWith("testament/") -> {
                val code = parentId.removePrefix("testament/")
                if (code != "OT" && code != "NT") null else BibleCatalog.testament(code).map { bookFolder(it) }
            }
            parentId.startsWith("book/") -> bookChildren(parentId)
            else -> null
        }
    }

    /** One node or playable item by id (browsers ask for these, e.g. to subscribe). */
    fun item(mediaId: String): MediaItem? {
        val snap = snapshot()
        when (mediaId) {
            MediaIds.ROOT -> return rootItem()
            MediaIds.RECENT_ROOT -> return recentRootItem()
            MediaIds.CONTINUE -> return continueItem(groupTitle = null)
            MediaIds.TODAY_ALL -> return snap.today?.let { todayAllItem(it) }
            MediaIds.NO_PLAN -> return noPlanItem()
            MediaIds.NOTHING_RECENT -> return nothingRecentItem()
        }
        tabs(snap, includeAll = true).firstOrNull { it.mediaId == mediaId }?.let { return it }
        if (mediaId.startsWith("testament/")) {
            val code = mediaId.removePrefix("testament/")
            return if (code == "OT" || code == "NT") testamentFolder(code) else null
        }
        if (mediaId.startsWith("today/reading/")) {
            val g = mediaId.removePrefix("today/reading/").toIntOrNull() ?: return null
            val today = snap.today ?: return null
            return today.readings.firstOrNull { it.index == g }?.let { readingItem(today, it, null) }
        }
        if (mediaId.startsWith("book/")) {
            val parts = mediaId.split('/')
            val book = BibleCatalog.book(parts.getOrNull(1) ?: return null) ?: return null
            if (parts.size == 2) return bookFolder(book)
            val from = parts[2].toIntOrNull() ?: return null
            return rangeFolder(book, from)
        }
        return single(mediaId)
    }

    private fun tabs(snap: CarSnapshot, includeAll: Boolean = false): List<MediaItem> = buildList {
        add(folder(MediaIds.TAB_TODAY, "Today", iconUri = CarArtwork.resourceUri(context, "bol_car_today"), mediaType = MediaMetadata.MEDIA_TYPE_FOLDER_MIXED))
        add(
            folder(
                MediaIds.TAB_BIBLE, "Bible",
                iconUri = CarArtwork.resourceUri(context, "bol_car_bible"),
                mediaType = MediaMetadata.MEDIA_TYPE_FOLDER_MIXED,
                childBrowsable = MediaConstants.EXTRAS_VALUE_CONTENT_STYLE_CATEGORY_LIST_ITEM,
            ),
        )
        // Only when the app has devotional audio for today; a tab that opens on nothing is
        // worse than no tab.
        if (includeAll || snap.devotional.isNotEmpty()) {
            add(folder(MediaIds.TAB_DEVOTIONAL, "Devotional", iconUri = CarArtwork.resourceUri(context, "bol_car_devotional"), mediaType = MediaMetadata.MEDIA_TYPE_FOLDER_MIXED))
        }
        add(folder(MediaIds.TAB_RECENT, "Recent", iconUri = CarArtwork.resourceUri(context, "bol_car_recent"), mediaType = MediaMetadata.MEDIA_TYPE_FOLDER_MIXED))
    }

    private fun todayChildren(snap: CarSnapshot): List<MediaItem> = buildList {
        continueItem(groupTitle = "Continue listening")?.let { add(it) }
        val today = snap.today
        if (today == null) {
            add(noPlanItem())
            return@buildList
        }
        val heading = listOf(today.planName, "Day ${today.day + 1}").filter { it.isNotBlank() }.joinToString(" · ")
        add(todayAllItem(today, heading))
        if (today.readings.isNotEmpty()) {
            today.readings.forEach { add(readingItem(today, it, heading)) }
        } else {
            today.tracks.forEach { t -> add(planTrackItem(today, t, heading)) }
        }
    }

    private fun recentChildren(): List<MediaItem> {
        val recent = store.recent()
        if (recent.isEmpty()) return listOf(nothingRecentItem())
        return recent.map { r ->
            val chapter = MediaIds.chapterOf(r.mediaId)
            // A plan chapter is listed (and replayed) as the plain chapter.
            val id = chapter?.let { (ho, c) -> MediaIds.chapter(ho, c) } ?: r.mediaId
            playable(
                id, r.title, r.subtitle, r.src,
                artwork = chapter?.let { (ho, c) -> CarArtwork.chapterUri(context, ho, c) } ?: CarArtwork.devotionalUri(context, r.title),
            )
        }
    }

    private fun bookChildren(parentId: String): List<MediaItem>? {
        val parts = parentId.split('/')
        val book = BibleCatalog.book(parts.getOrNull(1) ?: return null) ?: return null
        if (parts.size == 2) {
            if (book.chapters <= LONG_BOOK) return (1..book.chapters).map { chapterItem(book.ho, it) }
            // Psalms and Isaiah: pages of 50, so no list is longer than the car will show.
            return (1..book.chapters step RANGE).map { rangeFolder(book, it) }
        }
        val from = parts.getOrNull(2)?.toIntOrNull() ?: return null
        if (from < 1 || from > book.chapters) return null
        val to = minOf(book.chapters, from + RANGE - 1)
        return (from..to).map { chapterItem(book.ho, it) }
    }

    private fun testamentFolder(code: String): MediaItem = folder(
        MediaIds.testament(code),
        if (code == "OT") "Old Testament" else "New Testament",
        subtitle = if (code == "OT") "Genesis to Malachi" else "Matthew to Revelation",
        artwork = CarArtwork.testamentUri(context, code),
        mediaType = MediaMetadata.MEDIA_TYPE_FOLDER_AUDIO_BOOKS,
        childBrowsable = MediaConstants.EXTRAS_VALUE_CONTENT_STYLE_GRID_ITEM,
    )

    private fun bookFolder(book: BibleBook): MediaItem = folder(
        MediaIds.book(book.ho),
        book.name,
        subtitle = if (book.chapters == 1) "1 chapter" else "${book.chapters} chapters",
        artwork = CarArtwork.bookUri(context, book.ho),
        mediaType = MediaMetadata.MEDIA_TYPE_AUDIO_BOOK,
        childPlayable = MediaConstants.EXTRAS_VALUE_CONTENT_STYLE_GRID_ITEM,
        childBrowsable = MediaConstants.EXTRAS_VALUE_CONTENT_STYLE_LIST_ITEM,
    )

    private fun rangeFolder(book: BibleBook, from: Int): MediaItem {
        val to = minOf(book.chapters, from + RANGE - 1)
        return folder(
            MediaIds.bookRange(book.ho, from),
            "${book.name} $from–$to",
            artwork = CarArtwork.rangeUri(context, book.ho, from, to),
            mediaType = MediaMetadata.MEDIA_TYPE_FOLDER_AUDIO_BOOKS,
            childPlayable = MediaConstants.EXTRAS_VALUE_CONTENT_STYLE_GRID_ITEM,
        )
    }

    private fun chapterItem(ho: String, chapter: Int): MediaItem {
        val snap = snapshot()
        return playable(
            MediaIds.chapter(ho, chapter),
            BibleCatalog.label(ho, chapter),
            subtitleFor(snap),
            BibleCatalog.chapterAudioUrl(ho, chapter, snap.narrator, BibleCatalog.DEFAULT_TRANSLATION),
            artwork = CarArtwork.chapterUri(context, ho, chapter),
        )
    }

    private fun todayAllItem(today: CarToday, heading: String? = null): MediaItem {
        val remaining = today.tracks.count { !it.done }
        val subtitle = when {
            remaining == 0 -> "All read today. Plays the day again"
            remaining == today.tracks.size -> "${plural(today.tracks.size, "chapter")} from the start"
            else -> "${plural(remaining, "chapter")} left, from where you are"
        }
        return playable(
            MediaIds.TODAY_ALL, "Play today’s reading", subtitle, today.tracks.first().src,
            artwork = CarArtwork.namedUri(context, "today"),
            groupTitle = heading,
        )
    }

    private fun readingItem(today: CarToday, reading: CarReading, heading: String?): MediaItem {
        val tracks = reading.tracks.mapNotNull { today.tracks.getOrNull(it) }
        val first = tracks.firstOrNull() ?: today.tracks.first()
        val allDone = tracks.isNotEmpty() && tracks.all { it.done }
        val someDone = tracks.any { it.done }
        return playable(
            MediaIds.reading(reading.index),
            reading.label.ifBlank { first.title },
            listOf(reading.kicker, if (allDone) "Read" else "").filter { it.isNotBlank() }.joinToString(" · "),
            first.src,
            artwork = CarArtwork.chapterUri(context, first.ho, first.chapter),
            groupTitle = heading,
            completion = when {
                allDone -> MediaConstants.EXTRAS_VALUE_COMPLETION_STATUS_FULLY_PLAYED
                someDone -> MediaConstants.EXTRAS_VALUE_COMPLETION_STATUS_PARTIALLY_PLAYED
                else -> MediaConstants.EXTRAS_VALUE_COMPLETION_STATUS_NOT_PLAYED
            },
        )
    }

    private fun planTrackItem(today: CarToday, t: CarTrack, heading: String?): MediaItem = playable(
        MediaIds.plan(today.planId, today.day, t.readingIndex, t.ho, t.chapter),
        t.title, t.subtitle, t.src,
        artwork = CarArtwork.chapterUri(context, t.ho, t.chapter),
        groupTitle = heading,
        group = t.group,
        completion = if (t.done) MediaConstants.EXTRAS_VALUE_COMPLETION_STATUS_FULLY_PLAYED else null,
    )

    private fun devotionalItem(d: CarDevotional): MediaItem = playable(
        MediaIds.devotional(d.id), d.title, d.subtitle, d.src,
        artwork = CarArtwork.devotionalUri(context, d.label),
    )

    private fun continueItem(groupTitle: String?): MediaItem? {
        val last = store.lastPlayed() ?: return null
        val chapter = MediaIds.chapterOf(last.mediaId)
        val at = if (last.positionMs >= 60_000) " · ${formatPosition(last.positionMs)} in" else ""
        return playable(
            MediaIds.CONTINUE, last.title, "Continue listening$at", last.src,
            artwork = chapter?.let { (ho, c) -> CarArtwork.chapterUri(context, ho, c) } ?: CarArtwork.namedUri(context, "continue"),
            groupTitle = groupTitle,
            completion = MediaConstants.EXTRAS_VALUE_COMPLETION_STATUS_PARTIALLY_PLAYED,
        )
    }

    private fun noPlanItem(): MediaItem = folder(
        MediaIds.NO_PLAN, "No reading plan yet",
        subtitle = "Choose one in Bread of Life on your phone",
        artwork = CarArtwork.namedUri(context, "today"),
        mediaType = MediaMetadata.MEDIA_TYPE_FOLDER_MIXED,
    )

    private fun nothingRecentItem(): MediaItem = folder(
        MediaIds.NOTHING_RECENT, "Nothing played yet",
        subtitle = "Chapters you listen to appear here",
        artwork = CarArtwork.namedUri(context, "bible"),
        mediaType = MediaMetadata.MEDIA_TYPE_FOLDER_MIXED,
    )

    /* ------------------------------------ search ------------------------------------ */

    /** What to list for a typed or spoken search. */
    fun search(query: String): List<MediaItem> {
        val snap = snapshot()
        when (RefParser.intent(query)) {
            RefParser.Intent.TODAY -> return listOfNotNull(snap.today?.let { todayAllItem(it) })
            RefParser.Intent.CONTINUE -> return listOfNotNull(continueItem(null))
            RefParser.Intent.MORNING -> return snap.devotional.filter { it.label.equals("Morning", true) }.map { devotionalItem(it) }
            RefParser.Intent.EVENING -> return snap.devotional.filter { it.label.equals("Evening", true) }.map { devotionalItem(it) }
            RefParser.Intent.DEVOTIONAL -> return snap.devotional.map { devotionalItem(it) }
            null -> Unit
        }
        RefParser.parse(query)?.let { ref ->
            if (ref.chapterGiven) return listOf(chapterItem(ref.book.ho, ref.chapter))
            return (1..minOf(ref.book.chapters, RANGE)).map { chapterItem(ref.book.ho, it) }
        }
        return RefParser.booksMatching(query).map { bookFolder(it) }
    }

    /** What to play for "play … on Bread of Life", or null when nothing fits. */
    fun resolveSearch(query: String): MediaItemsWithStartPosition? {
        return when (RefParser.intent(query)) {
            RefParser.Intent.TODAY -> resolve(MediaIds.TODAY_ALL)
            RefParser.Intent.CONTINUE -> resumption() ?: resolve(MediaIds.TODAY_ALL)
            RefParser.Intent.MORNING, RefParser.Intent.EVENING, RefParser.Intent.DEVOTIONAL ->
                search(query).firstOrNull()?.let { resolve(it.mediaId) }
            null -> {
                val ref = RefParser.parse(query)
                if (ref != null) bibleQueue(ref.book.ho, ref.chapter)
                else RefParser.booksMatching(query).firstOrNull()?.let { bibleQueue(it.ho, 1) }
            }
        }
    }

    /* ----------------------------------- playback ----------------------------------- */

    /** The queue a tap on [mediaId] starts, with where to start in it. */
    fun resolve(mediaId: String): MediaItemsWithStartPosition? {
        val snap = snapshot()
        when {
            mediaId == MediaIds.TODAY_ALL -> {
                val today = snap.today ?: return null
                val first = today.tracks.indexOfFirst { !it.done }
                return todayQueue(today, if (first < 0) 0 else first)
            }
            mediaId.startsWith("today/reading/") -> {
                val today = snap.today ?: return null
                val g = mediaId.removePrefix("today/reading/").toIntOrNull() ?: return null
                val reading = today.readings.firstOrNull { it.index == g } ?: return null
                val tracks = reading.tracks.filter { it in today.tracks.indices }
                // Start at the reading's first unread chapter, or its first if all are read.
                val start = tracks.firstOrNull { !today.tracks[it].done } ?: tracks.firstOrNull() ?: 0
                return todayQueue(today, start)
            }
            mediaId == MediaIds.CONTINUE -> return resumption()
            mediaId.startsWith("book/") -> {
                val parts = mediaId.split('/')
                val book = BibleCatalog.book(parts.getOrNull(1) ?: return null) ?: return null
                return bibleQueue(book.ho, parts.getOrNull(2)?.toIntOrNull() ?: 1)
            }
        }
        return when (val parsed = MediaIds.parse(mediaId)) {
            is MediaIds.Parsed.Chapter -> bibleQueue(parsed.ho, parsed.chapter)
            is MediaIds.Parsed.PlanTrack -> {
                val today = snap.today
                val index = today?.takeIf { it.planId == parsed.planId && it.day == parsed.day }
                    ?.tracks?.indexOfFirst { it.readingIndex == parsed.readingIndex } ?: -1
                if (today != null && index >= 0) todayQueue(today, index) else bibleQueue(parsed.ho, parsed.chapter)
            }
            is MediaIds.Parsed.Devotional -> {
                val list = snap.devotional
                val index = list.indexOfFirst { it.id == parsed.id }
                if (index >= 0) MediaItemsWithStartPosition(list.map { devotionalItem(it) }, index, C.TIME_UNSET)
                else single(mediaId)?.let { MediaItemsWithStartPosition(listOf(it), 0, C.TIME_UNSET) }
            }
            null -> null
        }
    }

    /** One playable item for [mediaId] on its own (for "add to queue" style requests). */
    fun single(mediaId: String): MediaItem? {
        val snap = snapshot()
        return when (val parsed = MediaIds.parse(mediaId)) {
            is MediaIds.Parsed.Chapter -> chapterItem(parsed.ho, parsed.chapter)
            is MediaIds.Parsed.PlanTrack -> {
                val today = snap.today?.takeIf { it.planId == parsed.planId && it.day == parsed.day }
                val t = today?.tracks?.firstOrNull { it.readingIndex == parsed.readingIndex }
                if (today != null && t != null) planTrackItem(today, t, null) else chapterItem(parsed.ho, parsed.chapter)
            }
            is MediaIds.Parsed.Devotional -> {
                snap.devotional.firstOrNull { it.id == parsed.id }?.let { devotionalItem(it) }
                    ?: store.recent().firstOrNull { it.mediaId == mediaId }?.let {
                        playable(mediaId, it.title, it.subtitle, it.src, artwork = CarArtwork.devotionalUri(context, it.title))
                    }
            }
            null -> null
        }
    }

    /** Where to pick up: the last thing played, at the point it stopped. */
    fun resumption(): MediaItemsWithStartPosition? {
        val last = store.lastPlayed() ?: return null
        val queue = resolve(last.mediaId)
        if (queue != null) {
            val index = queue.mediaItems.indexOfFirst { it.mediaId == last.mediaId }
                .takeIf { it >= 0 }
                ?: queue.mediaItems.indexOfFirst { MediaIds.chapterOf(it.mediaId) == MediaIds.chapterOf(last.mediaId) && MediaIds.chapterOf(it.mediaId) != null }
            if (index >= 0) return MediaItemsWithStartPosition(queue.mediaItems, index, last.positionMs)
        }
        val item = playable(last.mediaId, last.title, last.subtitle, last.src, artwork = null)
        return MediaItemsWithStartPosition(listOf(item), 0, last.positionMs)
    }

    private fun todayQueue(today: CarToday, start: Int): MediaItemsWithStartPosition {
        val items = today.tracks.map { planTrackItem(today, it, null) }
        return MediaItemsWithStartPosition(items, start.coerceIn(0, items.size - 1), C.TIME_UNSET)
    }

    /**
     * From [ho] [chapter] onwards through the Bible, as the app's Bible page plays, but at
     * most [BIBLE_QUEUE_LIMIT] chapters so the car's queue stays quick to load and to scroll.
     */
    fun bibleQueue(ho: String, chapter: Int): MediaItemsWithStartPosition? {
        val start = BibleCatalog.book(ho) ?: return null
        val items = ArrayList<MediaItem>()
        for (book in BibleCatalog.BOOKS) {
            if (book.order < start.order) continue
            val from = if (book.ho == start.ho) chapter.coerceIn(1, book.chapters) else 1
            for (c in from..book.chapters) {
                items.add(chapterItem(book.ho, c))
                if (items.size >= BIBLE_QUEUE_LIMIT) break
            }
            if (items.size >= BIBLE_QUEUE_LIMIT) break
        }
        return MediaItemsWithStartPosition(items, 0, C.TIME_UNSET)
    }

    /* ------------------------------------ builders ---------------------------------- */

    private fun folder(
        id: String,
        title: String,
        subtitle: String? = null,
        artwork: Uri? = null,
        iconUri: Uri? = null,
        mediaType: Int,
        childBrowsable: Int? = null,
        childPlayable: Int? = null,
    ): MediaItem {
        val extras = Bundle()
        childBrowsable?.let { extras.putInt(MediaConstants.EXTRAS_KEY_CONTENT_STYLE_BROWSABLE, it) }
        childPlayable?.let { extras.putInt(MediaConstants.EXTRAS_KEY_CONTENT_STYLE_PLAYABLE, it) }
        val metadata = MediaMetadata.Builder()
            .setTitle(title)
            .setIsBrowsable(true)
            .setIsPlayable(false)
            .setMediaType(mediaType)
            .apply {
                if (subtitle != null) setSubtitle(subtitle)
                (artwork ?: iconUri)?.let { setArtworkUri(it) }
                if (!extras.isEmpty) setExtras(extras)
            }
            .build()
        return MediaItem.Builder().setMediaId(id).setMediaMetadata(metadata).build()
    }

    fun playable(
        id: String,
        title: String,
        subtitle: String,
        src: String,
        artwork: Uri?,
        groupTitle: String? = null,
        group: Int? = null,
        completion: Int? = null,
    ): MediaItem {
        val extras = Bundle()
        groupTitle?.let { extras.putString(MediaConstants.EXTRAS_KEY_CONTENT_STYLE_GROUP_TITLE, it) }
        group?.let { extras.putInt(EXTRA_READING_GROUP, it) }
        completion?.let { extras.putInt(MediaConstants.EXTRAS_KEY_COMPLETION_STATUS, it) }
        val metadata = MediaMetadata.Builder()
            .setTitle(title)
            .setArtist(subtitle)
            .setSubtitle(subtitle)
            .setAlbumTitle("Bread of Life")
            .setIsBrowsable(false)
            .setIsPlayable(true)
            .setMediaType(MediaMetadata.MEDIA_TYPE_AUDIO_BOOK_CHAPTER)
            .apply {
                artwork?.let { setArtworkUri(it) }
                if (!extras.isEmpty) setExtras(extras)
            }
            .build()
        return MediaItem.Builder().setMediaId(id).setUri(src).setMediaMetadata(metadata).build()
    }

    private fun subtitleFor(snap: CarSnapshot): String {
        val name = if (snap.translation == "BSB") "Berean Standard Bible" else snap.translation
        return "$name · ${snap.narrator.replaceFirstChar { it.uppercase() }}"
    }

    private fun plural(n: Int, word: String) = if (n == 1) "1 $word" else "$n ${word}s"

    private fun formatPosition(ms: Long): String {
        val s = ms / 1000
        return "%d:%02d".format(s / 60, s % 60)
    }

    companion object {
        /** Books longer than this are split into pages of [RANGE] chapters. */
        const val LONG_BOOK = 60
        const val RANGE = 50
        const val BIBLE_QUEUE_LIMIT = 150
        /** Which of a plan day's readings a queue item belongs to ("Next reading" skips by it). */
        const val EXTRA_READING_GROUP = "app.tauri.nativeaudio.READING_GROUP"
    }
}
