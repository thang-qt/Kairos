package org.kairos.android

import android.app.Application
import android.content.MutableContextWrapper
import android.os.SystemClock
import android.util.Log
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.ui.graphics.toArgb

class KairosApplication : Application() {
    val perf = Performance()
    val theme = PrototypeTheme()
    val screenImages = MemoryScreenImages()
    // Assistant/preview startup is native only. MainActivity prewarms before setContent.
    val bridge by lazy { TranscriptBridge(MutableContextWrapper(this), perf, screenImages).apply {
        webView.setBackgroundColor(theme.colors.surface.toArgb())
    } }
    val chat by lazy { PrototypeChat(bridge, theme).also { bridge.onEvent = it::onEvent } }
    var pendingConversation: List<ChatMessage>? = null

    fun takeConversation(): List<ChatMessage>? = pendingConversation.also { pendingConversation = null }

}

class Performance {
    val numbers = mutableStateMapOf<String, String>()
    private var nextTrace = 0
    private val outstanding = linkedMapOf<Int, Pair<String, Long>>()

    fun record(label: String, milliseconds: Double) {
        val text = String.format(java.util.Locale.US, "%.1f ms", milliseconds)
        numbers[label] = text
        Log.i("KairosPerf", "$label: $text")
    }

    fun trace(stage: String): Int {
        val id = ++nextTrace
        outstanding[id] = stage to SystemClock.uptimeMillis()
        // Keep instrumentation bounded if the renderer fails or a session is replaced mid-paint.
        if (outstanding.size > 64) outstanding.remove(outstanding.keys.first())
        return id
    }

    fun painted(id: Int, webElapsed: Double) {
        val (stage, sent) = outstanding.remove(id) ?: return
        record(stage, (SystemClock.uptimeMillis() - sent).toDouble())
        Log.i("KairosPerf", "paint #$id: web commit/frame proxy ${webElapsed}ms")
    }
}
