package app.tauri.nativeaudio

import android.content.Context
import android.content.SharedPreferences
import android.net.Uri
import org.json.JSONArray
import org.json.JSONObject

/**
 * Everything Android Auto shows that the native side cannot work out for itself, and
 * everything that happens in the car that the app must hear about later.
 *
 * The app is often not running when the phone connects to the car, so the web side writes a
 * small snapshot here whenever it changes (today's plan day, its tracks, devotional audio,
 * the narrator), and it is kept in SharedPreferences. The native side keeps its own record of
 * what was actually played (Continue listening, Recent) and of plan chapters that finished
 * while playing from the car, which the app collects at its next start
 * (`take_car_completions` / `ack_car_completions`).
 */
internal data class CarTrack(
    val readingIndex: Int,
    val group: Int,
    val ho: String,
    val chapter: Int,
    val title: String,
    val subtitle: String,
    val src: String,
    val done: Boolean,
)

internal data class CarReading(
    val index: Int,
    val label: String,
    val kicker: String,
    /** Positions in [CarToday.tracks]. */
    val tracks: List<Int>,
)

internal data class CarToday(
    val planId: String,
    val planName: String,
    val day: Int,
    val readings: List<CarReading>,
    val tracks: List<CarTrack>,
)

internal data class CarDevotional(
    val id: String,
    val label: String,
    val title: String,
    val subtitle: String,
    val src: String,
)

internal data class CarSnapshot(
    val narrator: String,
    val translation: String,
    val today: CarToday?,
    val devotional: List<CarDevotional>,
    val updatedAt: Long,
) {
    companion object {
        val EMPTY = CarSnapshot(BibleCatalog.DEFAULT_NARRATOR, BibleCatalog.DEFAULT_TRANSLATION, null, emptyList(), 0L)

        fun parse(json: String?): CarSnapshot {
            if (json.isNullOrBlank()) return EMPTY
            return runCatching { fromJson(JSONObject(json)) }.getOrDefault(EMPTY)
        }

        private fun fromJson(o: JSONObject): CarSnapshot {
            val today = o.optJSONObject("today")?.let { t ->
                val tracks = t.optJSONArray("tracks").objects().mapNotNull { x ->
                    val ho = x.optString("ho").uppercase()
                    val chapter = x.optInt("chapter", 0)
                    val src = x.optString("src")
                    if (BibleCatalog.book(ho) == null || chapter <= 0 || src.isBlank()) return@mapNotNull null
                    CarTrack(
                        readingIndex = x.optInt("readingIndex", 0),
                        group = x.optInt("group", 0),
                        ho = ho,
                        chapter = chapter,
                        title = x.optString("title").ifBlank { BibleCatalog.label(ho, chapter) },
                        subtitle = x.optString("subtitle"),
                        src = src,
                        done = x.optBoolean("done", false),
                    )
                }
                val readings = t.optJSONArray("readings").objects().map { r ->
                    CarReading(
                        index = r.optInt("index", 0),
                        label = r.optString("label"),
                        kicker = r.optString("kicker"),
                        tracks = r.optJSONArray("tracks").ints(),
                    )
                }
                val planId = t.optString("planId")
                if (planId.isBlank() || tracks.isEmpty()) null
                else CarToday(planId, t.optString("planName"), t.optInt("day", 0), readings, tracks)
            }
            val devotional = o.optJSONArray("devotional").objects().mapNotNull { d ->
                val src = d.optString("src")
                val id = d.optString("id")
                if (src.isBlank() || id.isBlank()) null
                else CarDevotional(id, d.optString("label"), d.optString("title").ifBlank { d.optString("label") }, d.optString("subtitle"), src)
            }
            return CarSnapshot(
                narrator = o.optString("narrator").ifBlank { BibleCatalog.DEFAULT_NARRATOR },
                translation = o.optString("translation").ifBlank { BibleCatalog.DEFAULT_TRANSLATION },
                today = today,
                devotional = devotional,
                updatedAt = o.optLong("updatedAt", 0L),
            )
        }
    }
}

/** A chapter or devotional that was played, for Recent and Continue listening. */
internal data class PlayedItem(
    val mediaId: String,
    val title: String,
    val subtitle: String,
    val src: String,
    val positionMs: Long,
    val at: Long,
) {
    fun toJson(): JSONObject = JSONObject()
        .put("mediaId", mediaId)
        .put("title", title)
        .put("subtitle", subtitle)
        .put("src", src)
        .put("positionMs", positionMs)
        .put("at", at)

    companion object {
        fun fromJson(o: JSONObject?): PlayedItem? {
            if (o == null) return null
            val mediaId = o.optString("mediaId")
            val src = o.optString("src")
            if (mediaId.isBlank() || src.isBlank()) return null
            return PlayedItem(mediaId, o.optString("title"), o.optString("subtitle"), src, o.optLong("positionMs", 0L), o.optLong("at", 0L))
        }
    }
}

/**
 * Media ids. Browse nodes are fixed strings; playable items describe themselves, so a queue
 * can be rebuilt from an id alone (after a restart, from Recent, from a voice request).
 */
internal object MediaIds {
    const val ROOT = "root"
    const val RECENT_ROOT = "recent-root"
    const val TAB_TODAY = "tab/today"
    const val TAB_BIBLE = "tab/bible"
    const val TAB_DEVOTIONAL = "tab/devotional"
    const val TAB_RECENT = "tab/recent"
    const val TODAY_ALL = "today/all"
    const val CONTINUE = "continue"
    const val NO_PLAN = "today/no-plan"
    const val NOTHING_RECENT = "recent/empty"

    fun testament(code: String) = "testament/$code"
    fun book(ho: String) = "book/$ho"
    /** Part of a long book (Psalms 51–100). */
    fun bookRange(ho: String, from: Int) = "book/$ho/$from"
    fun reading(group: Int) = "today/reading/$group"
    fun chapter(ho: String, chapter: Int) = "ch/$ho/$chapter"
    fun plan(planId: String, day: Int, readingIndex: Int, ho: String, chapter: Int) =
        "plan/${Uri.encode(planId)}/$day/$readingIndex/$ho/$chapter"
    fun devotional(id: String) = "dev/${Uri.encode(id)}"

    sealed class Parsed {
        data class Chapter(val ho: String, val chapter: Int) : Parsed()
        data class PlanTrack(val planId: String, val day: Int, val readingIndex: Int, val ho: String, val chapter: Int) : Parsed()
        data class Devotional(val id: String) : Parsed()
    }

    fun parse(mediaId: String?): Parsed? {
        if (mediaId.isNullOrBlank()) return null
        val p = mediaId.split('/')
        return when {
            p.size == 3 && p[0] == "ch" -> {
                val c = p[2].toIntOrNull() ?: return null
                if (BibleCatalog.book(p[1]) == null) null else Parsed.Chapter(p[1], c)
            }
            p.size == 6 && p[0] == "plan" -> {
                val day = p[2].toIntOrNull() ?: return null
                val ri = p[3].toIntOrNull() ?: return null
                val c = p[5].toIntOrNull() ?: return null
                if (BibleCatalog.book(p[4]) == null) null else Parsed.PlanTrack(Uri.decode(p[1]), day, ri, p[4], c)
            }
            p.size == 2 && p[0] == "dev" -> Parsed.Devotional(Uri.decode(p[1]))
            else -> null
        }
    }

    /** Book and chapter of a playable id, when it is a Bible chapter. */
    fun chapterOf(mediaId: String?): Pair<String, Int>? = when (val x = parse(mediaId)) {
        is Parsed.Chapter -> x.ho to x.chapter
        is Parsed.PlanTrack -> x.ho to x.chapter
        else -> null
    }
}

/** SharedPreferences behind [CarSnapshot], Recent, Continue listening and completions. */
internal class CarStore(context: Context) {
    private val prefs: SharedPreferences =
        context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    @Volatile
    private var cachedSnapshot: CarSnapshot? = null

    fun snapshot(): CarSnapshot =
        cachedSnapshot ?: CarSnapshot.parse(prefs.getString(KEY_SNAPSHOT, null)).also { cachedSnapshot = it }

    /** Store the app's snapshot. Returns false when it does not parse. */
    fun setSnapshot(json: String): Boolean {
        val parsed = runCatching { JSONObject(json) }.getOrNull() ?: return false
        val snapshot = CarSnapshot.parse(parsed.toString())
        prefs.edit().putString(KEY_SNAPSHOT, parsed.toString()).apply()
        cachedSnapshot = snapshot
        return true
    }

    /** A plan chapter finished in the car: tick it in the stored snapshot too, so the car's
     *  Today list shows it done before the app has run. */
    fun markTodayTrackDone(planId: String, day: Int, readingIndex: Int) {
        val raw = prefs.getString(KEY_SNAPSHOT, null) ?: return
        val o = runCatching { JSONObject(raw) }.getOrNull() ?: return
        val today = o.optJSONObject("today") ?: return
        if (today.optString("planId") != planId || today.optInt("day", -1) != day) return
        val tracks = today.optJSONArray("tracks") ?: return
        for (i in 0 until tracks.length()) {
            val t = tracks.optJSONObject(i) ?: continue
            if (t.optInt("readingIndex", -1) == readingIndex) t.put("done", true)
        }
        prefs.edit().putString(KEY_SNAPSHOT, o.toString()).apply()
        cachedSnapshot = CarSnapshot.parse(o.toString())
    }

    fun recent(): List<PlayedItem> =
        runCatching { JSONArray(prefs.getString(KEY_RECENT, "[]")) }.getOrDefault(JSONArray())
            .objects().mapNotNull { PlayedItem.fromJson(it) }

    /** Put [item] at the top of Recent (one entry per chapter or devotional). */
    fun addRecent(item: PlayedItem) {
        val key = recentKey(item.mediaId)
        val list = listOf(item) + recent().filter { recentKey(it.mediaId) != key }
        val arr = JSONArray()
        list.take(RECENT_LIMIT).forEach { arr.put(it.toJson()) }
        prefs.edit().putString(KEY_RECENT, arr.toString()).apply()
    }

    fun lastPlayed(): PlayedItem? =
        PlayedItem.fromJson(runCatching { JSONObject(prefs.getString(KEY_LAST, null) ?: return null) }.getOrNull())

    fun setLastPlayed(item: PlayedItem) {
        prefs.edit().putString(KEY_LAST, item.toJson().toString()).apply()
    }

    fun addCompletion(parsed: MediaIds.Parsed.PlanTrack, mediaId: String, at: Long = System.currentTimeMillis()) {
        val list = completionsArray()
        val seq = prefs.getLong(KEY_COMPLETION_SEQ, 0L) + 1
        list.put(
            JSONObject()
                .put("seq", seq)
                .put("mediaId", mediaId)
                .put("planId", parsed.planId)
                .put("planDay", parsed.day)
                .put("planReadingIndex", parsed.readingIndex)
                .put("ho", parsed.ho)
                .put("chapter", parsed.chapter)
                .put("completedAt", at),
        )
        // Keep the queue bounded; a year of daily readings is far more than will ever wait.
        val trimmed = JSONArray()
        val from = maxOf(0, list.length() - COMPLETION_LIMIT)
        for (i in from until list.length()) trimmed.put(list.get(i))
        prefs.edit().putString(KEY_COMPLETIONS, trimmed.toString()).putLong(KEY_COMPLETION_SEQ, seq).apply()
    }

    fun completions(): JSONArray = completionsArray()

    fun pendingCompletionCount(): Int = completionsArray().length()

    /** Drop every completion up to and including [upTo] (the app has recorded them). */
    fun ackCompletions(upTo: Long) {
        val keep = JSONArray()
        completionsArray().objects().forEach { if (it.optLong("seq") > upTo) keep.put(it) }
        prefs.edit().putString(KEY_COMPLETIONS, keep.toString()).apply()
    }

    private fun completionsArray(): JSONArray =
        runCatching { JSONArray(prefs.getString(KEY_COMPLETIONS, "[]")) }.getOrDefault(JSONArray())

    internal fun clearForTest() {
        prefs.edit().clear().commit()
        cachedSnapshot = null
    }

    private fun recentKey(mediaId: String): String =
        MediaIds.chapterOf(mediaId)?.let { (ho, c) -> "ch/$ho/$c" } ?: mediaId

    companion object {
        private const val PREFS = "tauri_native_audio_car"
        private const val KEY_SNAPSHOT = "snapshot"
        private const val KEY_RECENT = "recent"
        private const val KEY_LAST = "last_played"
        private const val KEY_COMPLETIONS = "completions"
        private const val KEY_COMPLETION_SEQ = "completion_seq"
        const val RECENT_LIMIT = 10
        private const val COMPLETION_LIMIT = 500
    }
}

internal fun JSONArray?.objects(): List<JSONObject> {
    if (this == null) return emptyList()
    return (0 until length()).mapNotNull { optJSONObject(it) }
}

internal fun JSONArray?.ints(): List<Int> {
    if (this == null) return emptyList()
    return (0 until length()).map { optInt(it) }
}
