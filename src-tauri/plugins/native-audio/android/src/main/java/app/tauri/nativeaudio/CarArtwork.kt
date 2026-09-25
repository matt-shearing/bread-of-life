package app.tauri.nativeaudio

import android.content.ContentProvider
import android.content.ContentValues
import android.content.Context
import android.database.Cursor
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.LinearGradient
import android.graphics.Paint
import android.graphics.RectF
import android.graphics.Shader
import android.graphics.Typeface
import android.net.Uri
import android.os.ParcelFileDescriptor
import java.io.File
import java.io.FileNotFoundException
import java.io.FileOutputStream

/**
 * Artwork for Android Auto. Browse items need an artwork URI the car can open (content:// or
 * http), not a bitmap in the item, so the tiles are drawn here on first request, cached as PNG
 * files, and served by [CarArtworkProvider]:
 *
 *   content://<app id>.nativeaudio.artwork/chapter/JHN/3   "John" over a large "3"
 *   …/book/JHN                                               "John", "21 chapters"
 *   …/range/PSA/51/100                                       "Psalms", "51–100"
 *   …/testament/OT, …/today, …/continue, …/devotional/morning, …/devotional/evening
 *
 * Warm amber, like the app. Tab icons are vector drawables instead (the car tints those).
 */
internal object CarArtwork {
    const val SIZE_PX = 480
    private const val VERSION = 1
    private val TOP = Color.parseColor("#FBBF24") // amber-400
    private val BOTTOM = Color.parseColor("#D97706") // amber-600
    private val INK = Color.parseColor("#3B2410") // warm dark brown, the app's text on amber

    fun authority(context: Context): String = "${context.packageName}.nativeaudio.artwork"

    private fun base(context: Context): Uri.Builder =
        Uri.Builder().scheme("content").authority(authority(context))

    fun chapterUri(context: Context, ho: String, chapter: Int): Uri =
        base(context).appendPath("chapter").appendPath(ho).appendPath(chapter.toString()).build()

    fun bookUri(context: Context, ho: String): Uri = base(context).appendPath("book").appendPath(ho).build()

    fun rangeUri(context: Context, ho: String, from: Int, to: Int): Uri =
        base(context).appendPath("range").appendPath(ho).appendPath(from.toString()).appendPath(to.toString()).build()

    fun testamentUri(context: Context, code: String): Uri = base(context).appendPath("testament").appendPath(code).build()

    fun namedUri(context: Context, name: String): Uri = base(context).appendPath(name).build()

    fun devotionalUri(context: Context, label: String): Uri =
        base(context).appendPath("devotional").appendPath(if (label.lowercase().startsWith("even")) "evening" else "morning").build()

    /** A vector drawable shipped in this library, for tab icons. */
    fun resourceUri(context: Context, drawableName: String): Uri =
        Uri.parse("android.resource://${context.packageName}/drawable/$drawableName")

    /** What to draw for a provider path, or null when the path is not one of ours. */
    internal fun spec(segments: List<String>): Pair<String, String>? {
        fun book(ho: String) = BibleCatalog.book(ho)
        return when {
            segments.size == 3 && segments[0] == "chapter" -> {
                val b = book(segments[1]) ?: return null
                val c = segments[2].toIntOrNull()?.takeIf { it in 1..b.chapters } ?: return null
                b.name to c.toString()
            }
            segments.size == 2 && segments[0] == "book" -> {
                val b = book(segments[1]) ?: return null
                b.name to (if (b.chapters == 1) "1 chapter" else "${b.chapters} chapters")
            }
            segments.size == 4 && segments[0] == "range" -> {
                val b = book(segments[1]) ?: return null
                val from = segments[2].toIntOrNull() ?: return null
                val to = segments[3].toIntOrNull() ?: return null
                b.name to "$from–$to"
            }
            segments.size == 2 && segments[0] == "testament" -> when (segments[1]) {
                "OT" -> "Old" to "Testament"
                "NT" -> "New" to "Testament"
                else -> null
            }
            segments.size == 2 && segments[0] == "devotional" -> when (segments[1]) {
                "morning" -> "Spurgeon" to "Morning"
                "evening" -> "Spurgeon" to "Evening"
                else -> null
            }
            segments.size == 1 && segments[0] == "today" -> "Today’s" to "Reading"
            segments.size == 1 && segments[0] == "continue" -> "Continue" to "Listening"
            segments.size == 1 && segments[0] == "bible" -> "The" to "Bible"
            else -> null
        }
    }

    /** The cached PNG for [segments], drawing it first if needed. */
    @Synchronized
    fun file(context: Context, segments: List<String>): File? {
        val (top, main) = spec(segments) ?: return null
        val dir = File(context.cacheDir, "car-artwork").apply { mkdirs() }
        val name = "v$VERSION-" + segments.joinToString("-") { it.replace(Regex("[^A-Za-z0-9]"), "_") } + ".png"
        val file = File(dir, name)
        if (file.isFile && file.length() > 0) return file
        val bitmap = when (segments[0]) {
            "chapter" -> render(top, main, bigNumber = true)
            // A book's name is what matters in a grid of books: large, with the count under it.
            "book", "range" -> renderTitleFirst(top, main)
            else -> render(top, main, bigNumber = false)
        }
        val tmp = File(dir, "$name.tmp")
        FileOutputStream(tmp).use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
        bitmap.recycle()
        if (!tmp.renameTo(file)) {
            tmp.delete()
            return null
        }
        return file
    }

    /** [small] above [main]; a chapter number is drawn very large. */
    fun render(small: String, main: String, bigNumber: Boolean): Bitmap {
        val size = SIZE_PX.toFloat()
        val bitmap = Bitmap.createBitmap(SIZE_PX, SIZE_PX, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(bitmap)
        val bg = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            shader = LinearGradient(0f, 0f, size, size, TOP, BOTTOM, Shader.TileMode.CLAMP)
        }
        canvas.drawRoundRect(RectF(0f, 0f, size, size), size * 0.06f, size * 0.06f, bg)

        val serifBold = Typeface.create(Typeface.SERIF, Typeface.BOLD)
        val margin = size * 0.1f
        val maxWidth = size - margin * 2

        val smallPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = INK
            typeface = serifBold
            textAlign = Paint.Align.CENTER
            textSize = if (bigNumber) size * 0.13f else size * 0.12f
        }
        fitWidth(smallPaint, small, maxWidth)

        val mainPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = INK
            typeface = serifBold
            textAlign = Paint.Align.CENTER
            textSize = if (bigNumber) size * 0.46f else size * 0.17f
        }
        fitWidth(mainPaint, main, maxWidth)

        if (bigNumber) {
            canvas.drawText(small, size / 2, size * 0.28f, smallPaint)
            canvas.drawText(main, size / 2, size * 0.78f, mainPaint)
        } else {
            canvas.drawText(small, size / 2, size * 0.44f, smallPaint)
            canvas.drawText(main, size / 2, size * 0.66f, mainPaint)
        }
        // A thin rule under the heading, as on the app's cards.
        val rule = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = INK; alpha = 90; strokeWidth = size * 0.008f }
        val ruleY = if (bigNumber) size * 0.35f else size * 0.51f
        canvas.drawLine(size * 0.38f, ruleY, size * 0.62f, ruleY, rule)
        return bitmap
    }

    /** [title] large, [caption] small beneath it. */
    fun renderTitleFirst(title: String, caption: String): Bitmap {
        val size = SIZE_PX.toFloat()
        val bitmap = Bitmap.createBitmap(SIZE_PX, SIZE_PX, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(bitmap)
        val bg = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            shader = LinearGradient(0f, 0f, size, size, TOP, BOTTOM, Shader.TileMode.CLAMP)
        }
        canvas.drawRoundRect(RectF(0f, 0f, size, size), size * 0.06f, size * 0.06f, bg)
        val serifBold = Typeface.create(Typeface.SERIF, Typeface.BOLD)
        val maxWidth = size * 0.84f
        val titlePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = INK; typeface = serifBold; textAlign = Paint.Align.CENTER; textSize = size * 0.2f
        }
        fitWidth(titlePaint, title, maxWidth)
        val captionPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = INK; alpha = 210; typeface = Typeface.create(Typeface.SERIF, Typeface.NORMAL)
            textAlign = Paint.Align.CENTER; textSize = size * 0.1f
        }
        fitWidth(captionPaint, caption, maxWidth)
        canvas.drawText(title, size / 2, size * 0.52f, titlePaint)
        val rule = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = INK; alpha = 90; strokeWidth = size * 0.008f }
        canvas.drawLine(size * 0.38f, size * 0.61f, size * 0.62f, size * 0.61f, rule)
        canvas.drawText(caption, size / 2, size * 0.74f, captionPaint)
        return bitmap
    }

    private fun fitWidth(paint: Paint, text: String, maxWidth: Float) {
        while (paint.textSize > 8f && paint.measureText(text) > maxWidth) paint.textSize *= 0.92f
    }
}

/** Serves [CarArtwork] tiles to Android Auto and the system media controls. Read-only. */
class CarArtworkProvider : ContentProvider() {
    override fun onCreate(): Boolean = true

    override fun getType(uri: Uri): String = "image/png"

    override fun openFile(uri: Uri, mode: String): ParcelFileDescriptor {
        if (mode != "r") throw SecurityException("read-only")
        val ctx = context ?: throw FileNotFoundException("no context")
        val file = CarArtwork.file(ctx, uri.pathSegments) ?: throw FileNotFoundException(uri.toString())
        return ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY)
    }

    override fun query(uri: Uri, projection: Array<out String>?, selection: String?, selectionArgs: Array<out String>?, sortOrder: String?): Cursor? = null
    override fun insert(uri: Uri, values: ContentValues?): Uri? = null
    override fun delete(uri: Uri, selection: String?, selectionArgs: Array<out String>?): Int = 0
    override fun update(uri: Uri, values: ContentValues?, selection: String?, selectionArgs: Array<out String>?): Int = 0
}
