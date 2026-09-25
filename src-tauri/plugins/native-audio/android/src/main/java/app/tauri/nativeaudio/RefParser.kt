package app.tauri.nativeaudio

/**
 * Turns what someone says to the car ("play John 3 on Bread of Life", "first Corinthians
 * chapter thirteen", "psalm one hundred and nineteen") into a book and chapter. The
 * assistant hands us the words after "play", sometimes with the app's name still attached.
 */
internal object RefParser {

    data class Ref(val book: BibleBook, val chapter: Int, val chapterGiven: Boolean)

    /** What a query asks for, beyond a Bible reference. */
    enum class Intent { TODAY, CONTINUE, MORNING, EVENING, DEVOTIONAL }

    private val APP_SUFFIX = Regex("""\b(on|from|in|with|using)\s+(the\s+)?bread\s+of\s+life(\s+app)?\b""")
    private val FILLER = setOf("play", "listen", "to", "me", "please", "the", "book", "of", "chapter", "chapters", "chap", "ch", "reading", "read", "start", "put", "on")

    private val SMALL = mapOf(
        "zero" to 0, "one" to 1, "two" to 2, "three" to 3, "four" to 4, "five" to 5, "six" to 6,
        "seven" to 7, "eight" to 8, "nine" to 9, "ten" to 10, "eleven" to 11, "twelve" to 12,
        "thirteen" to 13, "fourteen" to 14, "fifteen" to 15, "sixteen" to 16, "seventeen" to 17,
        "eighteen" to 18, "nineteen" to 19,
    )
    private val TENS = mapOf(
        "twenty" to 20, "thirty" to 30, "forty" to 40, "fourty" to 40, "fifty" to 50, "sixty" to 60,
        "seventy" to 70, "eighty" to 80, "ninety" to 90,
    )
    private val ORDINAL_PREFIX = mapOf(
        "first" to "1", "1st" to "1", "i" to "1", "one" to "1",
        "second" to "2", "2nd" to "2", "ii" to "2", "two" to "2",
        "third" to "3", "3rd" to "3", "iii" to "3", "three" to "3",
    )

    /** Aliases split into words, longest first, so "song of songs" beats "song". */
    private val ALIASES: List<Pair<List<String>, BibleBook>> by lazy {
        BibleCatalog.BOOKS
            .flatMap { book -> book.aliases.map { it.split(' ') to book } }
            .sortedByDescending { it.first.size }
    }

    fun normalise(query: String): String {
        var q = query.lowercase()
            .replace('’', '\'')
            .replace(Regex("""(\d+):(\d+)"""), "$1 ") // "john 3:16" -> "john 3"
            .replace(Regex("""(\d+)\s*[-–]\s*\d+"""), "$1") // "genesis 1-2" -> "genesis 1"
            .replace(Regex("""[^a-z0-9' ]"""), " ")
        q = APP_SUFFIX.replace(q, " ")
        // "1john" / "2cor" -> "1 john" / "2 cor"
        q = q.replace(Regex("""\b([123])([a-z])"""), "$1 $2")
        return q.replace(Regex("""\s+"""), " ").trim()
    }

    fun intent(query: String): Intent? {
        val q = normalise(query)
        if (q.isEmpty()) return Intent.CONTINUE
        return when {
            Regex("""\b(resume|continue|carry on|pick up|where i left off|keep going)\b""").containsMatchIn(q) -> Intent.CONTINUE
            Regex("""\bmorning\b""").containsMatchIn(q) -> Intent.MORNING
            Regex("""\bevening\b""").containsMatchIn(q) -> Intent.EVENING
            Regex("""\b(devotional|devotion|spurgeon)\b""").containsMatchIn(q) -> Intent.DEVOTIONAL
            Regex("""\b(today|todays|today's|daily|my reading|reading plan|plan)\b""").containsMatchIn(q) -> Intent.TODAY
            q == "bread of life" -> Intent.CONTINUE
            else -> null
        }
    }

    /** The best Bible reference in [query], or null when no book name is recognised. */
    fun parse(query: String): Ref? {
        val words = normalise(query).split(' ').filter { it.isNotEmpty() }.toMutableList()
        if (words.isEmpty()) return null
        for (start in words.indices) {
            val hit = matchBookAt(words, start) ?: continue
            val (book, consumed) = hit
            val rest = words.drop(start + consumed).filter { it !in FILLER }
            val number = parseNumber(rest)
            if (number == null) return Ref(book, 1, chapterGiven = false)
            if (number < 1 || number > book.chapters) {
                // "John 30": a chapter that does not exist is not a reason to play something else.
                return if (book.chapters == 1) Ref(book, 1, chapterGiven = false) else null
            }
            return Ref(book, number, chapterGiven = true)
        }
        return null
    }

    /** Books whose names start with [query], for search suggestions ("jo" -> Joshua, Job, Joel, John…). */
    fun booksMatching(query: String): List<BibleBook> {
        val q = normalise(query)
        if (q.length < 2) return emptyList()
        return BibleCatalog.BOOKS.filter { b -> b.aliases.any { it.startsWith(q) } || b.name.lowercase().startsWith(q) }
    }

    private fun matchBookAt(words: List<String>, start: Int): Pair<BibleBook, Int>? {
        // A spoken ordinal first: "first john", "second kings", "one corinthians".
        val prefix = ORDINAL_PREFIX[words[start]]
        if (prefix != null && start + 1 < words.size) {
            val rewritten = listOf(prefix) + words.drop(start + 1)
            matchAlias(rewritten, 0)?.let { (book, n) -> return book to n }
        }
        return matchAlias(words, start)
    }

    private fun matchAlias(words: List<String>, start: Int): Pair<BibleBook, Int>? {
        for ((parts, book) in ALIASES) {
            if (start + parts.size > words.size) continue
            var ok = true
            for (i in parts.indices) {
                if (words[start + i] != parts[i]) { ok = false; break }
            }
            if (ok) return book to parts.size
        }
        return null
    }

    /** "3", "three", "twenty three", "one hundred and nineteen", "a hundred". Stops at the verse
     *  in "john three sixteen". */
    fun parseNumber(words: List<String>): Int? {
        if (words.isEmpty()) return null
        words.first().toIntOrNull()?.let { return it }
        var current = 0
        var last = 0 // 0 none, 1 small, 2 tens, 3 hundred
        for (w in words) {
            when {
                w == "and" && last == 3 -> continue
                w == "a" && last == 0 -> { current = 1; last = 1 }
                w in SMALL -> {
                    val v = SMALL.getValue(w)
                    if (last == 1 || (last == 2 && v >= 10)) break
                    current += v; last = 1
                }
                w in TENS -> {
                    if (last == 1 || last == 2) break
                    current += TENS.getValue(w); last = 2
                }
                w == "hundred" -> {
                    if (last == 2 || last == 3) break
                    current = (if (current == 0) 1 else current) * 100; last = 3
                }
                else -> break
            }
        }
        return if (last == 0) null else current
    }
}
