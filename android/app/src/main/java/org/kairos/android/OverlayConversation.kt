package org.kairos.android

import android.os.SystemClock
import android.util.Log
import androidx.compose.runtime.*
import kotlinx.coroutines.*

class OverlayConversation(private val perf: Performance, private val label: String) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private var job: Job? = null
    private var counter = 0
    private var shownAt = 0L
    private var frameReported = false
    private var keyboardReported = false
    val messages = mutableStateListOf<ChatMessage>()
    var streaming by mutableStateOf(false)
        private set
    var generation by mutableIntStateOf(0)
        private set
    var visible by mutableStateOf(false)
        private set

    fun show() {
        stop()
        messages.clear()
        generation++
        shownAt = SystemClock.uptimeMillis()
        frameReported = false
        keyboardReported = false
        visible = true
        Log.i("KairosPerf", "$label onShow uptime=$shownAt")
        perf.record("$label onShow (process)", (shownAt - android.os.Process.getStartUptimeMillis()).toDouble())
    }

    fun firstFrame(showGeneration: Int) {
        if (visible && showGeneration == generation && !frameReported) {
            frameReported = true
            perf.record("$label onShow → first frame", (SystemClock.uptimeMillis() - shownAt).toDouble())
        }
    }

    fun keyboardVisible(showGeneration: Int) {
        if (visible && showGeneration == generation && !keyboardReported) {
            keyboardReported = true
            perf.record("$label onShow → keyboard", (SystemClock.uptimeMillis() - shownAt).toDouble())
        }
    }

    fun send(text: String, attachment: ScreenAttachment? = null) {
        if ((text.isBlank() && attachment == null) || streaming) return
        val id = "overlay-${++counter}"
        messages.add(ChatMessage("$id-user", "user", text.trim(), attachment = attachment))
        messages.add(ChatMessage(id, "assistant", "", "mock / native", true))
        streaming = true
        job = scope.launch {
            MockStreaming.reply(attachedScreen = attachment != null) { _, token ->
                val index = messages.indexOfFirst { it.id == id }
                if (index >= 0) messages[index] = messages[index].copy(text = messages[index].text + token)
            }
            finishReply()
            job = null
        }
    }

    private fun finishReply() {
        val index = messages.indexOfLast { it.streaming }
        if (index >= 0) messages[index] = messages[index].copy(streaming = false)
        streaming = false
    }
    fun stop() { job?.cancel(); job = null; finishReply() }
    fun hide() { visible = false; stop(); messages.clear() }
    fun snapshot(): List<ChatMessage> { stop(); return messages.map { it.copy(attachment = it.attachment?.copyForHandoff()) } }
    fun destroy() { hide(); scope.cancel() }
}
