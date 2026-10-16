package org.kairos.android.assistant

import android.os.SystemClock
import android.util.Log
import androidx.compose.runtime.*
import kotlinx.coroutines.*
import kotlinx.serialization.json.*
import org.kairos.android.app.AppContainer
import org.kairos.android.data.*

class OverlayConversation(private val app: AppContainer, private val label: String) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private val repository = app.conversation()
    private var sendJob: Job? = null
    private var shownAt = 0L
    private var frameReported = false
    var messages by mutableStateOf<List<JsonObject>>(emptyList())
        private set

    var streaming by mutableStateOf(false)
        private set

    var error by mutableStateOf<String?>(null)
        private set

    var generation by mutableIntStateOf(0)
        private set

    var visible by mutableStateOf(false)
        private set

    val sessionId
        get() = repository.sessionId

    init {
        scope.launch {
            repository.history.collect { history ->
                messages = history.messages
                streaming = sendJob?.isActive == true || activeRunId(history) != null
            }
        }
        scope.launch {
            app.tokens.signedIn.collect {
                if (!it) {
                    sendJob?.cancel()
                    repository.open(null)
                    messages = emptyList()
                    streaming = false
                }
            }
        }
    }

    fun show() {
        repository.open(null)
        sendJob?.cancel()
        messages = emptyList()
        streaming = false
        error = null
        generation++
        shownAt = SystemClock.uptimeMillis()
        frameReported = false
        visible = true
    }

    fun firstFrame(showGeneration: Int) {
        if (visible && showGeneration == generation && !frameReported) {
            frameReported = true
            Log.i(
                "KairosPerf",
                "$label onShow to first frame: ${SystemClock.uptimeMillis() - shownAt}ms",
            )
        }
    }

    fun send(text: String, attachment: ScreenAttachment? = null) {
        if ((text.isBlank() && attachment == null) || streaming || !app.tokens.signedIn.value)
            return
        streaming = true
        error = null
        sendJob =
            scope.launch {
                try {
                    if (app.models.catalog.value.models.isEmpty()) app.models.refresh()
                    // Sessions outside the cached pages resolve their summary on demand so the
                    // overlay keeps using the conversation's own model and settings.
                    val settings =
                        app.sessions.sessions.value.find { it.friendlyId == sessionId }?.settings
                            ?: sessionId?.let { id ->
                                try {
                                    app.sessions.fetch(id).settings
                                } catch (e: CancellationException) {
                                    throw e
                                } catch (_: Exception) {
                                    null
                                }
                            }
                            ?: app.models.defaults(app.models.defaultModel())
                    repository.send(text, settings, listOfNotNull(attachment?.payload()))
                } catch (e: Exception) {
                    if (e is CancellationException) throw e
                    error = e.message ?: "Can't reach server."
                } finally {
                    streaming = activeRunId(repository.history.value) != null
                }
            }
    }

    fun stop() {
        scope.launch {
            try {
                repository.stop()
            } catch (e: Exception) {
                if (e is CancellationException) throw e
                error = e.message
            }
        }
    }

    fun requestOpen(onOpen: (String?) -> Unit) {
        scope.launch {
            sendJob?.join()
            if (visible) onOpen(sessionId)
        }
    }

    fun hide() {
        visible = false
        sendJob?.cancel()
        repository.open(null)
        messages = emptyList()
    }

    fun destroy() {
        hide()
        repository.close()
        scope.cancel()
    }
}

fun JsonObject.overlayImages(): List<ScreenAttachment> =
    parts()
        .filter { it.string("type") == "image" }
        .mapNotNull { part ->
            val source = part["source"] as? JsonObject ?: return@mapNotNull null
            runCatching {
                    val bytes =
                        android.util.Base64.decode(
                            source.string("data"),
                            android.util.Base64.DEFAULT,
                        )
                    val bounds =
                        android.graphics.BitmapFactory.Options().apply { inJustDecodeBounds = true }
                    android.graphics.BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
                    if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return@mapNotNull null
                    ScreenAttachment(
                        id + "-image",
                        bounds.outWidth,
                        bounds.outHeight,
                        bytes,
                        source.string("media_type") ?: "image/jpeg",
                        "Image",
                    )
                }
                .getOrNull()
        }
