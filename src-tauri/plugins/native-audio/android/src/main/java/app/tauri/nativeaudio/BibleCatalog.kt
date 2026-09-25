package app.tauri.nativeaudio

/**
 * The Bible as the car sees it: the 66 books with their chapter counts (BSB versification, the
 * same numbers as public/bible/bsb/index.json — a unit test checks they agree), the names a
 * listener might say for each, and the narration URL for any chapter.
 */
internal data class BibleBook(
    val ho: String,
    val name: String,
    val order: Int,
    val chapters: Int,
    /** Lower-case names and abbreviations, numbered books written "1 samuel". */
    val aliases: List<String>,
) {
    val testament: String get() = if (order <= 39) "OT" else "NT"
}

internal object BibleCatalog {
    /**
     * Narration for every chapter lives at one address pattern. It MUST match
     * `chapterAudioUrl` in src/audio/audioUrl.ts (and the URLs baked into
     * the bundled public/bible/bsb book files); AudioUrlAgreementTest and scripts/test-audio-url.mjs check
     * both sides against the same fixture.
     */
    const val AUDIO_BASE = "https://audio.bible.helloao.org/api"
    const val DEFAULT_TRANSLATION = "BSB"
    const val DEFAULT_NARRATOR = "david"

    val BOOKS: List<BibleBook> = listOf(
        BibleBook("GEN", "Genesis", 1, 50, listOf("genesis", "gen", "gn")),
        BibleBook("EXO", "Exodus", 2, 40, listOf("exodus", "exod", "exo", "ex")),
        BibleBook("LEV", "Leviticus", 3, 27, listOf("leviticus", "lev", "lv")),
        BibleBook("NUM", "Numbers", 4, 36, listOf("numbers", "num", "nm")),
        BibleBook("DEU", "Deuteronomy", 5, 34, listOf("deuteronomy", "deut", "deu", "dt")),
        BibleBook("JOS", "Joshua", 6, 24, listOf("joshua", "josh", "jos")),
        BibleBook("JDG", "Judges", 7, 21, listOf("judges", "judg", "jdg", "jgs")),
        BibleBook("RUT", "Ruth", 8, 4, listOf("ruth", "rut", "ru", "rth")),
        BibleBook("1SA", "1 Samuel", 9, 31, listOf("1 samuel", "1 sam", "1 sa")),
        BibleBook("2SA", "2 Samuel", 10, 24, listOf("2 samuel", "2 sam", "2 sa")),
        BibleBook("1KI", "1 Kings", 11, 22, listOf("1 kings", "1 kgs", "1 ki")),
        BibleBook("2KI", "2 Kings", 12, 25, listOf("2 kings", "2 kgs", "2 ki")),
        BibleBook("1CH", "1 Chronicles", 13, 29, listOf("1 chronicles", "1 chr", "1 ch", "1 chron")),
        BibleBook("2CH", "2 Chronicles", 14, 36, listOf("2 chronicles", "2 chr", "2 ch", "2 chron")),
        BibleBook("EZR", "Ezra", 15, 10, listOf("ezra", "ezr")),
        BibleBook("NEH", "Nehemiah", 16, 13, listOf("nehemiah", "neh")),
        BibleBook("EST", "Esther", 17, 10, listOf("esther", "esth", "est")),
        BibleBook("JOB", "Job", 18, 42, listOf("job", "jb")),
        BibleBook("PSA", "Psalms", 19, 150, listOf("psalms", "ps", "psa", "psalm", "pss", "psalter")),
        BibleBook("PRO", "Proverbs", 20, 31, listOf("proverbs", "prov", "pro", "pr", "prv")),
        BibleBook("ECC", "Ecclesiastes", 21, 12, listOf("ecclesiastes", "eccl", "ecc", "eccles", "qoheleth")),
        BibleBook("SNG", "Song of Solomon", 22, 8, listOf("song of solomon", "song", "sng", "song of songs", "songs", "canticles", "song of sol", "sos")),
        BibleBook("ISA", "Isaiah", 23, 66, listOf("isaiah", "isa")),
        BibleBook("JER", "Jeremiah", 24, 52, listOf("jeremiah", "jer", "jr")),
        BibleBook("LAM", "Lamentations", 25, 5, listOf("lamentations", "lam")),
        BibleBook("EZK", "Ezekiel", 26, 48, listOf("ezekiel", "ezek", "ezk", "eze")),
        BibleBook("DAN", "Daniel", 27, 12, listOf("daniel", "dan", "dn")),
        BibleBook("HOS", "Hosea", 28, 14, listOf("hosea", "hos")),
        BibleBook("JOL", "Joel", 29, 3, listOf("joel", "jol", "jl")),
        BibleBook("AMO", "Amos", 30, 9, listOf("amos", "amo")),
        BibleBook("OBA", "Obadiah", 31, 1, listOf("obadiah", "obad", "oba", "ob")),
        BibleBook("JON", "Jonah", 32, 4, listOf("jonah", "jon", "jnh")),
        BibleBook("MIC", "Micah", 33, 7, listOf("micah", "mic")),
        BibleBook("NAM", "Nahum", 34, 3, listOf("nahum", "nah", "nam")),
        BibleBook("HAB", "Habakkuk", 35, 3, listOf("habakkuk", "hab")),
        BibleBook("ZEP", "Zephaniah", 36, 3, listOf("zephaniah", "zeph", "zep")),
        BibleBook("HAG", "Haggai", 37, 2, listOf("haggai", "hag")),
        BibleBook("ZEC", "Zechariah", 38, 14, listOf("zechariah", "zech", "zec")),
        BibleBook("MAL", "Malachi", 39, 4, listOf("malachi", "mal")),
        BibleBook("MAT", "Matthew", 40, 28, listOf("matthew", "matt", "mat", "mt", "saint matthew", "st matthew")),
        BibleBook("MRK", "Mark", 41, 16, listOf("mark", "mrk", "mk", "mar", "saint mark", "st mark")),
        BibleBook("LUK", "Luke", 42, 24, listOf("luke", "luk", "lk", "saint luke", "st luke")),
        BibleBook("JHN", "John", 43, 21, listOf("john", "jhn", "jn", "joh", "saint john", "st john", "gospel of john")),
        BibleBook("ACT", "Acts", 44, 28, listOf("acts", "act", "acts of the apostles", "ac")),
        BibleBook("ROM", "Romans", 45, 16, listOf("romans", "rom", "ro", "rm")),
        BibleBook("1CO", "1 Corinthians", 46, 16, listOf("1 corinthians", "1 cor", "1 co")),
        BibleBook("2CO", "2 Corinthians", 47, 13, listOf("2 corinthians", "2 cor", "2 co")),
        BibleBook("GAL", "Galatians", 48, 6, listOf("galatians", "gal", "ga")),
        BibleBook("EPH", "Ephesians", 49, 6, listOf("ephesians", "eph")),
        BibleBook("PHP", "Philippians", 50, 4, listOf("philippians", "phil", "php", "philipians")),
        BibleBook("COL", "Colossians", 51, 4, listOf("colossians", "col")),
        BibleBook("1TH", "1 Thessalonians", 52, 5, listOf("1 thessalonians", "1 thess", "1 th", "1 thes")),
        BibleBook("2TH", "2 Thessalonians", 53, 3, listOf("2 thessalonians", "2 thess", "2 th", "2 thes")),
        BibleBook("1TI", "1 Timothy", 54, 6, listOf("1 timothy", "1 tim", "1 ti")),
        BibleBook("2TI", "2 Timothy", 55, 4, listOf("2 timothy", "2 tim", "2 ti")),
        BibleBook("TIT", "Titus", 56, 3, listOf("titus", "tit")),
        BibleBook("PHM", "Philemon", 57, 1, listOf("philemon", "phlm", "phm", "philem")),
        BibleBook("HEB", "Hebrews", 58, 13, listOf("hebrews", "heb")),
        BibleBook("JAS", "James", 59, 5, listOf("james", "jas", "jam", "jm")),
        BibleBook("1PE", "1 Peter", 60, 5, listOf("1 peter", "1 pet", "1 pe", "1 pt")),
        BibleBook("2PE", "2 Peter", 61, 3, listOf("2 peter", "2 pet", "2 pe", "2 pt")),
        BibleBook("1JN", "1 John", 62, 5, listOf("1 john", "1 jn", "1 jhn", "1 joh")),
        BibleBook("2JN", "2 John", 63, 1, listOf("2 john", "2 jn", "2 jhn")),
        BibleBook("3JN", "3 John", 64, 1, listOf("3 john", "3 jn", "3 jhn")),
        BibleBook("JUD", "Jude", 65, 1, listOf("jude", "jud", "jde")),
        BibleBook("REV", "Revelation", 66, 22, listOf("revelation", "rev", "revelations", "apocalypse", "the revelation")),
    )

    private val byHo: Map<String, BibleBook> = BOOKS.associateBy { it.ho }

    fun book(ho: String): BibleBook? = byHo[ho.uppercase()]

    fun testament(code: String): List<BibleBook> = BOOKS.filter { it.testament == code }

    fun chapterAudioUrl(
        ho: String,
        chapter: Int,
        narrator: String = DEFAULT_NARRATOR,
        translation: String = DEFAULT_TRANSLATION,
    ): String = "$AUDIO_BASE/$translation/$ho/$chapter/audio/$narrator.mp3"

    /** "John 3", as the app labels a chapter (src/lib/osis.ts refLabel). */
    fun label(ho: String, chapter: Int): String = "${book(ho)?.name ?: ho} $chapter"

    private val AUDIO_URL = Regex("""/api/([A-Za-z0-9_]+)/([0-9A-Z]{3})/(\d+)/audio/([A-Za-z0-9_-]+)\.mp3$""")

    data class ParsedAudioUrl(val translation: String, val ho: String, val chapter: Int, val narrator: String)

    /** The chapter a narration URL belongs to, or null for anything else (Missler, devotionals). */
    fun parseAudioUrl(src: String?): ParsedAudioUrl? {
        if (src.isNullOrBlank()) return null
        val m = AUDIO_URL.find(src.substringBefore('#').substringBefore('?')) ?: return null
        val ho = m.groupValues[2]
        val chapter = m.groupValues[3].toIntOrNull() ?: return null
        if (book(ho) == null) return null
        return ParsedAudioUrl(m.groupValues[1], ho, chapter, m.groupValues[4])
    }
}
