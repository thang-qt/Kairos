package org.kairos.android.markdown

import android.util.Log
import android.util.LruCache
import ru.noties.jlatexmath.JLatexMathDrawable
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Native stand-in for KaTeX. JLaTeXMath loads ~1 MB of font tables on first use, so [prewarm]
 * does that off the main thread before the overlay renders its first formula.
 */
object MathRenderer {
    private class Entry(val drawable: JLatexMathDrawable?)
    private val cache = LruCache<String, Entry>(96)
    private val warmed = AtomicBoolean(false)

    fun prewarm() {
        if (!warmed.compareAndSet(false, true)) return
        Thread({
            val started = System.nanoTime()
            build("x^2+\\frac{1}{2}", 40f, 0xFF000000.toInt())
            Log.i("KairosPerf", "JLaTeXMath prewarm ${(System.nanoTime() - started) / 1_000_000} ms")
        }, "kairos-math-warmup").apply { priority = Thread.MIN_PRIORITY }.start()
    }

    /** Null when the TeX does not parse yet (often mid-stream); callers show the source instead. */
    fun drawable(tex: String, textSizePx: Float, color: Int): JLatexMathDrawable? {
        val key = "$textSizePx|$color|$tex"
        cache.get(key)?.let { return it.drawable }
        val drawable = build(tex, textSizePx, color)
        cache.put(key, Entry(drawable))
        return drawable
    }

    private fun build(tex: String, textSizePx: Float, color: Int): JLatexMathDrawable? = try {
        JLatexMathDrawable.builder(tex).textSize(textSizePx).color(color).align(JLatexMathDrawable.ALIGN_LEFT).build()
            .takeIf { it.intrinsicWidth > 0 && it.intrinsicHeight > 0 }
    } catch (_: Throwable) {
        // JLaTeXMath reports malformed input with a range of runtime exceptions and errors.
        null
    }
}
