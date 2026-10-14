package org.kairos.android

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.graphics.toArgb
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject
import org.kairos.android.ui.theme.KairosPalettes

class PrototypeChat(private val bridge: TranscriptBridge, private val themeState: PrototypeTheme) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private var stream: Job? = null
    private var counter = 0
    private var ready = false
    val paletteIndex get() = themeState.paletteIndex
    val dark get() = themeState.dark
    var title by mutableStateOf(Fixtures.sessions.first().title)
        private set
    var streaming by mutableStateOf(false)
        private set
    var longPressId by mutableStateOf<String?>(null)
    var atBottom by mutableStateOf(true)
        private set
    var top = 72f
    var bottom = 120f
    val messages = Fixtures.conversation(0).toMutableList()
    val colors get() = themeState.colors

    private fun theme() = JSONObject().put("palette", KairosPalettes[paletteIndex].name).put("mode", if (dark) "dark" else "light")
    private fun insets() = JSONObject().put("top", top.toDouble()).put("bottom", bottom.toDouble())
    private fun init() {
        if (!ready) return
        bridge.send(JSONObject().put("type", "init").put("theme", theme()).put("insets", insets())
            .put("messages", JSONArray(messages.map { it.json() })), "Init → transcript painted")
    }

    fun onEvent(event: JSONObject) {
        when (event.optString("type")) {
            "ready" -> { ready = true; bridge.pageReady(event.optDouble("firstPaintMs")); init() }
            "paint" -> bridge.perf.painted(event.optInt("trace"), event.optDouble("elapsedMs"))
            "longPress" -> longPressId = event.optString("id").takeIf { id -> messages.any { it.id == id } }
            "link" -> bridge.externalLink(event.optString("href"))
            "atBottom" -> atBottom = event.optBoolean("value")
        }
    }

    fun updateInsets(newTop: Float, newBottom: Float) {
        if (top == newTop && bottom == newBottom) return
        top = newTop; bottom = newBottom
        if (ready) bridge.send(insets().put("type", "insets"))
    }

    fun cyclePalette() { themeState.cyclePalette(); syncTheme() }
    fun toggleMode() { themeState.toggleMode(); syncTheme() }
    private fun syncTheme() {
        bridge.webView.setBackgroundColor(colors.surface.toArgb())
        if (ready) bridge.send(theme().put("type", "theme"))
    }

    fun select(session: Session?) {
        stop()
        longPressId = null
        title = session?.title ?: "New session"
        messages.clear()
        bridge.screenImages.clear()
        if (session != null) messages.addAll(Fixtures.conversation(session.fixture))
        atBottom = true
        init()
    }

    fun loadConversation(conversation: List<ChatMessage>) {
        stop()
        longPressId = null
        title = "Assistant conversation"
        messages.clear()
        messages.addAll(conversation.map { it.copy(streaming = false) })
        bridge.screenImages.replace(messages)
        atBottom = true
        init()
    }

    fun stop() {
        stream?.cancel(); stream = null
        val index = messages.indexOfLast { it.streaming }
        if (index >= 0) {
            messages[index] = messages[index].copy(streaming = false)
            if (ready) bridge.send(JSONObject().put("type", "done").put("id", messages[index].id))
        }
        streaming = false
    }

    fun send(text: String) {
        if (text.isBlank() || streaming || !ready) return
        val user = ChatMessage("user-${++counter}", "user", text.trim())
        val assistant = ChatMessage("assistant-$counter", "assistant", "", "mock / compose", true)
        messages.add(user); messages.add(assistant)
        bridge.send(JSONObject().put("type", "append").put("message", user.json()))
        bridge.send(JSONObject().put("type", "append").put("message", assistant.json()))
        streaming = true
        stream = scope.launch {
            MockStreaming.reply { index, token ->
                val messageIndex = messages.indexOfFirst { it.id == assistant.id }
                if (messageIndex < 0) return@reply
                messages[messageIndex] = messages[messageIndex].copy(text = messages[messageIndex].text + token)
                val sampled = index in listOf(0, 9, 29, 59, 119)
                bridge.send(JSONObject().put("type", "delta").put("id", assistant.id).put("text", token),
                    if (sampled) "Token ${index + 1} → paint" else null)
            }
            stop()
        }
    }
}
