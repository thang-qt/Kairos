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
    private var pausedSessionId: String? = null
    private var pausedIdentity: String? = null
    private val operations = OverlayOperationEpoch()

    private fun identity(): String? = attachmentIdentity(app.server.url, app.tokens.token)
    private fun accepts(epoch: Long, owner: String?): Boolean =
        operations.accepts(epoch) && owner != null && owner == identity() && visible
    var draft by mutableStateOf("")
    var messages by mutableStateOf<List<JsonObject>>(emptyList())
        private set

    var pendingApprovals by mutableStateOf<List<McpApproval>>(emptyList())
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
                pendingApprovals = history.pendingMcpApprovals.filter { it.state == "pending" }
                streaming = sendJob?.isActive == true || activeRunId(history) != null
            }
        }
        scope.launch {
            app.tokens.signedIn.collect {
                if (!it) {
                    operations.advance()
                    pausedSessionId = null
                    pausedIdentity = null
                    draft = ""
                    error = null
                    sendJob?.cancel()
                    repository.open(null)
                    messages = emptyList()
                    pendingApprovals = emptyList()
                    streaming = false
                }
            }
        }
    }

    fun show(resume: Boolean = false, recoveredSessionId: String? = null) {
        operations.advance()
        sendJob?.cancel()
        val canResume = resume && pausedIdentity != null && pausedIdentity == identity()
        val target = recoveredSessionId ?: if (canResume) pausedSessionId else null
        repository.open(target)
        if (!canResume) draft = ""
        pausedSessionId = null
        pausedIdentity = null
        messages = emptyList()
        pendingApprovals = emptyList()
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

    fun send(text: String, attachments: List<ScreenAttachment> = emptyList()) {
        if ((text.isBlank() && attachments.isEmpty()) || streaming || !app.tokens.signedIn.value)
            return
        val epoch = operations.capture()
        val owner = identity()
        if (!visible || owner == null) return
        streaming = true
        draft = ""
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
                    if (accepts(epoch, owner))
                        repository.send(text, settings, attachments.map { it.payload() })
                } catch (e: Exception) {
                    if (e is CancellationException) throw e
                    if (accepts(epoch, owner)) error = e.message ?: "Can't reach server."
                } finally {
                    if (accepts(epoch, owner)) streaming = activeRunId(repository.history.value) != null
                }
            }
    }

    fun stop() {
        val epoch = operations.capture()
        val owner = identity()
        scope.launch {
            try {
                repository.stop()
            } catch (e: Exception) {
                if (e is CancellationException) throw e
                if (accepts(epoch, owner)) error = e.message
            }
        }
    }

    fun decide(approval: McpApproval, decision: String, decisionScope: String? = null) {
        val epoch = operations.capture()
        val owner = identity()
        scope.launch {
            try {
                app.api.decideApproval(approval, decision, decisionScope)
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                if (accepts(epoch, owner)) error = e.message ?: "Can't reach server."
            }
        }
    }

    fun requestOpen(onOpen: (String?) -> Unit) {
        val epoch = operations.capture()
        val owner = identity()
        val pendingSend = sendJob
        scope.launch {
            pendingSend?.join()
            if (accepts(epoch, owner)) onOpen(sessionId)
        }
    }

    fun hide(forPicker: Boolean = false) {
        operations.advance()
        pausedSessionId = if (forPicker) sessionId else null
        pausedIdentity = if (forPicker) identity() else null
        if (!forPicker) draft = ""
        visible = false
        sendJob?.cancel()
        repository.open(null)
        messages = emptyList()
        pendingApprovals = emptyList()
        streaming = false
        error = null
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
