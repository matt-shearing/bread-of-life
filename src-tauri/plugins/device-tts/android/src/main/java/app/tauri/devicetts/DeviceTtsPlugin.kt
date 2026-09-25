package app.tauri.devicetts

import android.app.Activity
import android.content.Context
import android.os.Bundle
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import android.speech.tts.Voice
import android.util.Log
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import java.io.File
import java.io.FileOutputStream
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.Locale
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

private const val TAG = "DeviceTts"
private const val CACHE_DIR = "device-tts"
/** Rendered readings kept in the cache; a reading is about 7 MB of 24 kHz WAV. */
private const val KEEP_FILES = 4
private const val LEAD_SILENCE_SEC = 0.25

@InvokeArg
class SegmentArg {
    var text: String? = null
    /** Silence after this segment, in seconds. */
    var pause: Double? = null
}

@InvokeArg
class SynthesizeArgs {
    /** Cache key chosen by the frontend (reading id + a hash of the text); the file name. */
    var key: String? = null
    var segments: List<SegmentArg>? = null
    /** BCP-47 language to prefer, e.g. "en-GB". */
    var lang: String? = null
    /** Speech rate, 1.0 = the engine's normal. */
    var rate: Double? = null
}

/** The PCM layout of a WAV written by the TTS engine. */
private data class WavFormat(val channels: Int, val sampleRate: Int, val bitsPerSample: Int) {
    val blockAlign get() = channels * bitsPerSample / 8
    val byteRate get() = sampleRate * blockAlign
}

private class WavData(val format: WavFormat, val bytes: ByteArray)

/** One utterance to synthesise and the silence after it. */
private class Piece(val text: String, val pause: Double)

/**
 * Renders a devotional with the phone's text-to-speech engine into one WAV file in the
 * app's cache, so the native audio queue can play it like any other file. See
 * `src/lib/deviceTts.ts` for the frontend side and `src-tauri/plugins/device-tts/src/lib.rs`.
 */
@TauriPlugin
class DeviceTtsPlugin(private val activity: Activity) : Plugin(activity) {
    private val appContext: Context = activity.applicationContext
    /** One reading at a time: the engine is a single, stateful voice. */
    private val worker = Executors.newSingleThreadExecutor()
    private var tts: TextToSpeech? = null
    private val pending = ConcurrentHashMap<String, CountDownLatch>()
    private val failed = ConcurrentHashMap.newKeySet<String>()

    /**
     * `{ key, segments: [{ text, pause }], lang?, rate? }` →
     * `{ path, durationSec, voice, cached }`. Emits `progress` `{ key, done, total }` while
     * it works. Reuses the cached file when the key has been rendered before.
     */
    // Kotlin @Command names are camelCase; the JS command is `synthesize`.
    @Command
    fun synthesize(invoke: Invoke) {
        val args = invoke.parseArgs(SynthesizeArgs::class.java)
        val key = args.key?.replace(Regex("[^A-Za-z0-9._-]"), "_")
        val segments = args.segments.orEmpty().filter { !it.text.isNullOrBlank() }
        if (key.isNullOrEmpty() || segments.isEmpty()) {
            invoke.reject("key and segments are required")
            return
        }
        worker.execute {
            try {
                invoke.resolve(render(key, segments, args.lang ?: "en-GB", args.rate ?: 1.0))
            } catch (t: Throwable) {
                Log.w(TAG, "synthesize failed", t)
                invoke.reject(t.message ?: "Text-to-speech failed")
            }
        }
    }

    /* ------------------------------------------------------------------------------ */

    private fun render(key: String, segments: List<SegmentArg>, lang: String, rate: Double): JSObject {
        val dir = File(appContext.cacheDir, CACHE_DIR).apply { mkdirs() }
        val out = File(dir, "$key.wav")
        if (out.length() > 44) {
            out.setLastModified(System.currentTimeMillis())
            return result(out, readWav(out)?.let { durationOf(it) } ?: 0.0, null, true)
        }

        val engine = engine()
        val voice = chooseVoice(engine, Locale.forLanguageTag(lang))
        engine.setSpeechRate(rate.toFloat())

        val parts = File(dir, "$key.parts").apply { deleteRecursively(); mkdirs() }
        try {
            // Long input is split to the engine's limit (segments are normally < 300 chars).
            val max = TextToSpeech.getMaxSpeechInputLength().coerceAtLeast(200)
            val pieces = segments.flatMap { seg ->
                val chunks = chunk(seg.text!!.trim(), max)
                chunks.mapIndexed { i, c -> Piece(c, if (i == chunks.lastIndex) seg.pause ?: 0.3 else 0.15) }
            }

            var format: WavFormat? = null
            val pcm = java.io.ByteArrayOutputStream()
            pieces.forEachIndexed { i, piece ->
                val file = File(parts, "$i.wav")
                synthesizeOne(engine, piece.text, file, "$key-$i")
                val wav = readWav(file)
                if (wav != null && wav.bytes.isNotEmpty()) {
                    if (format == null) {
                        format = wav.format
                        pcm.write(silence(wav.format, LEAD_SILENCE_SEC))
                    }
                    if (wav.format == format) {
                        pcm.write(trimSilence(wav))
                        pcm.write(silence(format!!, piece.pause))
                    }
                }
                file.delete()
                trigger("progress", JSObject().apply {
                    put("key", key)
                    put("done", i + 1)
                    put("total", pieces.size)
                })
            }
            val fmt = format ?: throw IllegalStateException("The phone's voice produced no audio")
            val tmp = File(dir, "$key.wav.part")
            writeWav(tmp, fmt, pcm.toByteArray())
            if (!tmp.renameTo(out)) throw IllegalStateException("Could not save the spoken reading")
            prune(dir)
            return result(out, pcm.size().toDouble() / fmt.byteRate, voice?.name, false)
        } finally {
            parts.deleteRecursively()
        }
    }

    private fun result(file: File, durationSec: Double, voice: String?, cached: Boolean) = JSObject().apply {
        put("path", file.absolutePath)
        put("durationSec", durationSec)
        put("voice", voice)
        put("cached", cached)
    }

    /** Start the engine once and wait for it; called on the worker thread. */
    private fun engine(): TextToSpeech {
        tts?.let { return it }
        val latch = CountDownLatch(1)
        var status = TextToSpeech.ERROR
        // The init callback arrives on the main thread, which this worker does not block.
        val engine = TextToSpeech(appContext) { s ->
            status = s
            latch.countDown()
        }
        if (!latch.await(15, TimeUnit.SECONDS) || status != TextToSpeech.SUCCESS) {
            engine.shutdown()
            throw IllegalStateException("This phone has no text-to-speech voice available")
        }
        engine.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
            override fun onStart(utteranceId: String) {}
            override fun onDone(utteranceId: String) {
                pending.remove(utteranceId)?.countDown()
            }
            @Deprecated("Deprecated in Java")
            override fun onError(utteranceId: String) {
                failed.add(utteranceId)
                pending.remove(utteranceId)?.countDown()
            }
            override fun onError(utteranceId: String, errorCode: Int) {
                failed.add(utteranceId)
                pending.remove(utteranceId)?.countDown()
            }
        })
        tts = engine
        return engine
    }

    /** Prefer an installed, offline British voice; then any offline English voice. */
    private fun chooseVoice(engine: TextToSpeech, want: Locale): Voice? {
        val voices = runCatching { engine.voices }.getOrNull().orEmpty().filter { v ->
            v.locale.language == want.language &&
                !v.isNetworkConnectionRequired &&
                v.features?.contains(TextToSpeech.Engine.KEY_FEATURE_NOT_INSTALLED) != true
        }
        val pick = voices.sortedWith(
            compareByDescending<Voice> { it.locale.country.equals(want.country, ignoreCase = true) }
                .thenByDescending { it.quality }
                .thenBy { it.latency }
                .thenBy { it.name },
        ).firstOrNull()
        if (pick != null && engine.setVoice(pick) == TextToSpeech.SUCCESS) return pick
        val r = engine.setLanguage(want)
        if (r == TextToSpeech.LANG_MISSING_DATA || r == TextToSpeech.LANG_NOT_SUPPORTED) engine.setLanguage(Locale.UK)
        return engine.voice
    }

    private fun synthesizeOne(engine: TextToSpeech, text: String, file: File, id: String) {
        val latch = CountDownLatch(1)
        pending[id] = latch
        failed.remove(id)
        val params = Bundle().apply { putString(TextToSpeech.Engine.KEY_PARAM_UTTERANCE_ID, id) }
        if (engine.synthesizeToFile(text, params, file, id) != TextToSpeech.SUCCESS) {
            pending.remove(id)
            throw IllegalStateException("The phone's voice refused a passage")
        }
        if (!latch.await(60, TimeUnit.SECONDS)) {
            pending.remove(id)
            throw IllegalStateException("The phone's voice timed out")
        }
        if (failed.remove(id)) Log.w(TAG, "utterance $id failed; skipping it")
    }

    /* ------------------------------------ WAV ------------------------------------ */

    private fun readWav(file: File): WavData? {
        if (!file.exists() || file.length() < 12) return null
        val all = file.readBytes()
        val bb = ByteBuffer.wrap(all).order(ByteOrder.LITTLE_ENDIAN)
        if (String(all, 0, 4) != "RIFF" || String(all, 8, 4) != "WAVE") return null
        var pos = 12
        var format: WavFormat? = null
        while (pos + 8 <= all.size) {
            val id = String(all, pos, 4)
            val size = bb.getInt(pos + 4)
            val body = pos + 8
            if (id == "fmt ") {
                format = WavFormat(bb.getShort(body + 2).toInt(), bb.getInt(body + 4), bb.getShort(body + 14).toInt())
            } else if (id == "data" && format != null) {
                // Some engines stream the file and leave the size at 0 or too large.
                val len = if (size <= 0 || body + size > all.size) all.size - body else size
                return WavData(format, all.copyOfRange(body, body + len - len % format.blockAlign))
            }
            if (size < 0) return null
            pos = body + size + (size and 1)
        }
        return null
    }

    /** Drop the engine's own leading and trailing silence so our pauses set the pace. */
    private fun trimSilence(wav: WavData): ByteArray {
        val f = wav.format
        if (f.bitsPerSample != 16) return wav.bytes
        val bb = ByteBuffer.wrap(wav.bytes).order(ByteOrder.LITTLE_ENDIAN)
        val frames = wav.bytes.size / f.blockAlign
        val threshold = 100 // about -50 dBFS
        fun loud(frame: Int): Boolean {
            for (c in 0 until f.channels) {
                if (Math.abs(bb.getShort(frame * f.blockAlign + c * 2).toInt()) > threshold) return true
            }
            return false
        }
        var a = 0
        while (a < frames && !loud(a)) a++
        var b = frames
        while (b > a && !loud(b - 1)) b--
        if (a >= b) return ByteArray(0)
        val keep = (0.04 * f.sampleRate).toInt()
        a = (a - keep).coerceAtLeast(0)
        b = (b + keep).coerceAtMost(frames)
        return wav.bytes.copyOfRange(a * f.blockAlign, b * f.blockAlign)
    }

    private fun silence(f: WavFormat, seconds: Double): ByteArray {
        val frames = (seconds.coerceAtLeast(0.0) * f.sampleRate).toInt()
        return ByteArray(frames * f.blockAlign)
    }

    private fun writeWav(file: File, f: WavFormat, pcm: ByteArray) {
        val header = ByteBuffer.allocate(44).order(ByteOrder.LITTLE_ENDIAN).apply {
            put("RIFF".toByteArray()); putInt(36 + pcm.size); put("WAVE".toByteArray())
            put("fmt ".toByteArray()); putInt(16); putShort(1); putShort(f.channels.toShort())
            putInt(f.sampleRate); putInt(f.byteRate); putShort(f.blockAlign.toShort())
            putShort(f.bitsPerSample.toShort())
            put("data".toByteArray()); putInt(pcm.size)
        }
        FileOutputStream(file).use { out ->
            out.write(header.array())
            out.write(pcm)
        }
    }

    private fun durationOf(wav: WavData) = wav.bytes.size.toDouble() / wav.format.byteRate

    /** Keep the few most recently used readings. */
    private fun prune(dir: File) {
        dir.listFiles { f -> f.name.endsWith(".wav") }
            ?.sortedByDescending { it.lastModified() }
            ?.drop(KEEP_FILES)
            ?.forEach { it.delete() }
    }

    /** Split text to the engine's input limit, at sentence, clause or word boundaries. */
    private fun chunk(text: String, max: Int): List<String> {
        if (text.length <= max) return listOf(text)
        val out = mutableListOf<String>()
        var rest = text
        while (rest.length > max) {
            val window = rest.substring(0, max)
            val cut = listOf(". ", "; ", ", ", " ").map { window.lastIndexOf(it) }.firstOrNull { it > max / 3 }
                ?.plus(1) ?: max
            out.add(rest.substring(0, cut).trim())
            rest = rest.substring(cut).trim()
        }
        if (rest.isNotEmpty()) out.add(rest)
        return out
    }
}
