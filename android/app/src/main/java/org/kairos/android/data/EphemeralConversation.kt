package org.kairos.android.data

import java.time.Instant
import java.time.ZoneId
import java.util.UUID
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.serialization.json.*

/**
 * Throwaway chat: messages stream from POST /api/ephemeral/messages and only ever live in
 * memory. The event application uses the ungated reducer (like the web's ephemeral hook) —
 * there is no server revision to race against. Stopping aborts the request and marks live
 * turns locally, mirroring the web's cancelEphemeralTurns.
 */
class EphemeralConversation(private val api: KairosApi) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private var sendJob: Job? = null
    private val _history = MutableStateFlow(History())
    val history = _history.asStateFlow()
    private val _streaming = MutableStateFlow(false)
    val streaming = _streaming.asStateFlow()
    private val _error = MutableStateFlow<String?>(null)
    val error = _error.asStateFlow()

    val active: Boolean
        get() = sendJob?.isActive == true

    fun reset() {
        sendJob?.cancel()
        sendJob = null
        _history.value = History()
        _streaming.value = false
        _error.value = null
    }

    fun stop() {
        sendJob?.cancel()
        sendJob = null
    }

    /**
     * Appends the optimistic user turn and streams the answer. `onFailedWithoutEvents` fires
     * when the request died before producing any stream event, so the caller can restore the
     * draft; the optimistic turn is removed in that case.
     */
    fun send(
        text: String,
        settings: ConversationSettings,
        attachments: List<AttachmentPayload> = emptyList(),
        onFailedWithoutEvents: (String) -> Unit = {},
    ) {
        if (sendJob?.isActive == true) return
        _error.value = null
        val clientId = UUID.randomUUID().toString()
        val previous = _history.value.messages
        _history.value =
            _history.value.copy(messages = previous + optimisticTurn(clientId, text, attachments))
        sendJob =
            scope.launch {
                _streaming.value = true
                var received = false
                try {
                    api.postStream(
                        "/api/ephemeral/messages",
                        wireJson.encodeToString(
                            EphemeralRequest(
                                history = previous,
                                message = text,
                                clientId = clientId,
                                clientTime = Instant.now().toString(),
                                clientTimeZone = ZoneId.systemDefault().id,
                                // The resolved draft replaces the backend base for this
                                // command: user defaults plus the picked model and preset.
                                settings = settings,
                                attachments = attachments,
                            )
                        ),
                    ) { frame ->
                        val event =
                            runCatching {
                                wireJson.decodeFromString<ConversationEvent>(frame.data)
                            }.getOrNull() ?: return@postStream
                        received = true
                        if (event.state == "heartbeat") return@postStream
                        _history.value =
                            _history.value.copy(
                                messages =
                                    applyConversationEvent(_history.value.messages, event),
                            )
                        if (event.state == "error")
                            _error.value = event.error?.trim()?.ifEmpty { null }
                    }
                } catch (e: CancellationException) {
                    // Stop = abort the request; live turns are marked locally, content stays.
                    _history.value =
                        _history.value.copy(messages = cancelledTurns(_history.value.messages))
                } catch (e: Exception) {
                    if (!received) {
                        _history.value =
                            _history.value.copy(
                                messages =
                                    _history.value.messages.filter { it.clientId != clientId },
                            )
                        onFailedWithoutEvents(text)
                        _error.value = e.message ?: "Can't reach server."
                    } else {
                        _error.value = e.message ?: "The model request failed."
                    }
                } finally {
                    _streaming.value = false
                    if (sendJob?.isCancelled != true) sendJob = null
                }
            }
    }

    fun clearError() {
        _error.value = null
    }

    fun close() {
        reset()
        scope.cancel()
    }

    private fun optimisticTurn(
        clientId: String,
        text: String,
        attachments: List<AttachmentPayload>,
    ): JsonObject = buildJsonObject {
        put("id", JsonPrimitive("optimistic-$clientId"))
        put("clientId", JsonPrimitive(clientId))
        put("role", JsonPrimitive("user"))
        put("timestamp", JsonPrimitive(System.currentTimeMillis()))
        put(
            "content",
            buildJsonArray {
                if (text.isNotBlank())
                    add(
                        buildJsonObject {
                            put("type", JsonPrimitive("text"))
                            put("text", JsonPrimitive(text))
                        },
                    )
                for (image in attachments)
                    add(
                        buildJsonObject {
                            put("type", JsonPrimitive("image"))
                            put(
                                "source",
                                buildJsonObject {
                                    put("type", JsonPrimitive("base64"))
                                    put("media_type", JsonPrimitive(image.mimeType))
                                    put("data", JsonPrimitive(image.content))
                                },
                            )
                        },
                    )
            },
        )
    }

    /** Port of cancelEphemeralTurns: abort live turns and their unanswered tool calls. */
    private fun cancelledTurns(messages: List<JsonObject>): List<JsonObject> =
        messages.map { turn ->
            if (turn.role != "assistant") return@map turn
            val streamRun = turn["__streamRunId"]
            if (streamRun == null || streamRun is JsonNull) return@map turn
            val completed =
                (turn["steps"] as? JsonArray)
                    .orEmpty()
                    .mapNotNull { it as? JsonObject }
                    .filter { it.role == "toolResult" }
                    .mapNotNull { it.string("toolCallId") }
                    .toSet()
            JsonObject(
                turn.toMutableMap().apply {
                    put("status", JsonPrimitive("aborted"))
                    put("__streamRunId", JsonNull)
                    (turn["content"] as? JsonArray)?.let { content ->
                        put(
                            "content",
                            JsonArray(
                                content.map { part ->
                                    val call = part as? JsonObject
                                    if (
                                        call?.string("type") == "toolCall" &&
                                            call.string("id")?.let { it in completed } != true
                                    )
                                        JsonObject(
                                            call.toMutableMap().apply {
                                                put("status", JsonPrimitive("aborted"))
                                            }
                                        )
                                    else part
                                },
                            ),
                        )
                    }
                },
            )
        }
}
