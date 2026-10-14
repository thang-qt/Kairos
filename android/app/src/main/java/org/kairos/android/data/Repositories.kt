package org.kairos.android.data

import java.time.Instant
import java.time.ZoneId
import java.util.UUID
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.*
import kotlinx.serialization.json.*

class SessionsRepository(private val api: KairosApi) {
    private val _sessions = MutableStateFlow<List<SessionSummary>>(emptyList())
    val sessions = _sessions.asStateFlow()

    suspend fun refresh() {
        _sessions.value = api.get<SessionsResponse>("/api/sessions").sessions
    }

    fun clear() {
        _sessions.value = emptyList()
    }

    fun upsert(session: SessionSummary) {
        _sessions.value =
            (_sessions.value.filter { it.friendlyId != session.friendlyId } + session).sortedWith(
                compareByDescending<SessionSummary> { it.isPinned }
                    .thenByDescending { it.updatedAt }
            )
    }

    suspend fun rename(session: SessionSummary, label: String) {
        optimistic(session, session.copy(label = label)) {
            api.write<SessionSummary, RenameRequest>(
                api.sessionPath(session.friendlyId),
                "PATCH",
                RenameRequest(label),
            )
        }
    }

    suspend fun pin(session: SessionSummary) {
        optimistic(session, session.copy(isPinned = !session.isPinned)) {
            api.write<SessionSummary, PinRequest>(
                api.sessionPath(session.friendlyId) + "/pin",
                "PATCH",
                PinRequest(!session.isPinned),
            )
        }
    }

    private suspend fun optimistic(
        old: SessionSummary,
        next: SessionSummary,
        mutation: suspend () -> SessionSummary,
    ) {
        upsert(next)
        try {
            upsert(mutation())
        } catch (e: Exception) {
            upsert(old)
            throw e
        }
        refresh()
    }

    suspend fun delete(session: SessionSummary) {
        val previous = _sessions.value
        _sessions.value = previous.filter { it.friendlyId != session.friendlyId }
        try {
            api.raw(api.sessionPath(session.friendlyId), "DELETE")
        } catch (e: Exception) {
            _sessions.value = previous
            throw e
        }
        refresh()
    }

    suspend fun search(query: String): List<SearchResult> =
        api.get<SearchResponse>("/api/sessions/search?" + api.query(query)).sessions
}

class ModelsRepository(private val api: KairosApi) {
    private val _catalog = MutableStateFlow(ModelsResponse())
    val catalog = _catalog.asStateFlow()
    var chatSettings = ChatSettingsPreferences()
        private set

    suspend fun refresh() {
        _catalog.value = api.get("/api/models")
        chatSettings = api.get<ChatSettingsResponse>("/api/me/chat-settings").settings
    }

    fun clear() {
        _catalog.value = ModelsResponse()
        chatSettings = ChatSettingsPreferences()
    }

    fun defaultModel(): String {
        val requested = _catalog.value.preferences.defaultModelId
        return _catalog.value.models.find { it.key == requested || it.id == requested }?.key
            ?: _catalog.value.models.firstOrNull()?.key.orEmpty()
    }

    fun defaults(model: String) =
        (chatSettings.modelOverrides[model] ?: chatSettings.defaultSettings).copy(model = model)

    fun name(key: String) =
        _catalog.value.models.find { it.key == key || it.id == key }?.displayName
            ?: key.ifBlank { "Select model" }
}

class ConversationRepository(private val api: KairosApi, private val sessions: SessionsRepository) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private var stream: Job? = null
    private var refreshJob: Job? = null
    private var refreshAgain = false
    private var refreshGeneration = 0
    private var generation = 0
    private val _history = MutableStateFlow(History())
    val history = _history.asStateFlow()
    val turns = history.map { it.messages }.stateIn(scope, SharingStarted.Eagerly, emptyList())
    private val _connection = MutableStateFlow(ConnectionState.Connected)
    val connection = _connection.asStateFlow()
    var sessionId: String? = null
        private set

    fun open(id: String?) {
        generation++
        refreshGeneration++
        stream?.cancel()
        refreshJob?.cancel()
        refreshJob = null
        refreshAgain = false
        sessionId = id
        _history.value = History()
        _connection.value = ConnectionState.Connected
        if (id != null) {
            refresh()
            connect(id)
        }
    }

    private fun connect(id: String) {
        stream?.cancel()
        val epoch = generation
        stream =
            scope.launch {
                EventStream(api)
                    .events(id, _history.value.cursor)
                    .catch { if (epoch == generation) _connection.value = ConnectionState.Offline }
                    .collect { update ->
                        if (epoch != generation) return@collect
                        when (update) {
                            is StreamUpdate.Connection -> _connection.value = update.state
                            is StreamUpdate.Event -> {
                                val applied = handleConversationEvent(_history.value, update.event)
                                _history.value = applied.history
                                val affectedId = update.event.message?.id ?: update.event.turnId
                                val affected = applied.history.messages.find { it.id == affectedId }
                                if (
                                    applied.accepted &&
                                        affected?.role == "assistant" &&
                                        affected.status in
                                            listOf("completed", "aborted", "error", "interrupted")
                                ) {
                                    _history.value =
                                        _history.value.copy(
                                            activeRunIds =
                                                _history.value.activeRunIds.filter {
                                                    it != affected.runId
                                                }
                                        )
                                }
                                if (!applied.accepted) return@collect
                                update.event.session?.let(sessions::upsert)
                                if (applied.refetch) refresh()
                                // Terminal meaning comes from the turn, including
                                // aborted/interrupted error events.
                                if (
                                    affected?.let {
                                        it.role == "assistant" &&
                                            it.status in
                                                listOf(
                                                    "completed",
                                                    "aborted",
                                                    "error",
                                                    "interrupted",
                                                )
                                    } == true || update.event.state == "title"
                                )
                                    scope.launch { runCatching { sessions.refresh() } }
                            }
                        }
                    }
            }
    }

    fun refresh() {
        val id = sessionId ?: return
        if (refreshJob?.isActive == true) {
            refreshAgain = true
            return
        }
        val epoch = generation
        val refreshEpoch = refreshGeneration
        refreshJob =
            scope.launch {
                try {
                    val fetched = api.get<History>(api.sessionPath(id) + "/history")
                    if (
                        epoch == generation &&
                            refreshEpoch == refreshGeneration &&
                            fetched.revision >= _history.value.revision &&
                            fetched.cursor >= _history.value.cursor
                    )
                        _history.value = fetched
                } catch (e: Exception) {
                    if (e is CancellationException) throw e
                    if (epoch == generation && refreshEpoch == refreshGeneration)
                        _connection.value = ConnectionState.Offline
                } finally {
                    if (epoch == generation && refreshEpoch == refreshGeneration) {
                        refreshJob = null
                        if (refreshAgain) {
                            refreshAgain = false
                            refresh()
                        }
                    }
                }
            }
    }

    fun retryConnection() {
        sessionId?.let {
            refresh()
            connect(it)
        }
    }

    suspend fun readyRevision(): Long {
        if (_history.value.revision < 0) {
            val id = checkNotNull(sessionId)
            val fetched = api.get<History>(api.sessionPath(id) + "/history")
            if (sessionId == id) {
                _history.value =
                    handleConversationEvent(_history.value, ConversationEvent(snapshot = fetched))
                        .history
            } else return fetched.revision
        }
        return _history.value.revision
    }

    suspend fun send(
        text: String,
        settings: ConversationSettings,
        attachments: List<AttachmentPayload> = emptyList(),
        editId: String? = null,
    ): String? {
        val id = sessionId
        val epoch = generation
        val clientId = UUID.randomUUID().toString()
        val previous = _history.value
        val revision = if (id != null) readyRevision() else null
        val optimistic = buildJsonObject {
            put("id", "optimistic-$clientId")
            put("clientId", clientId)
            put("role", "user")
            put("timestamp", System.currentTimeMillis())
            put(
                "content",
                buildJsonArray {
                    if (text.isNotBlank())
                        add(
                            buildJsonObject {
                                put("type", "text")
                                put("text", text)
                            }
                        )
                    for (image in attachments) add(
                        buildJsonObject {
                            put("type", "image")
                            put(
                                "source",
                                buildJsonObject {
                                    put("type", "base64")
                                    put("media_type", image.mimeType)
                                    put("data", image.content)
                                },
                            )
                        }
                    )
                },
            )
        }
        if (epoch == generation)
            _history.value =
                _history.value.copy(
                    messages =
                        if (editId != null)
                            _history.value.messages.takeWhile { it.id != editId } + optimistic
                        else _history.value.messages + optimistic
                )
        val request =
            SendRequest(
                text,
                settings.model,
                clientId,
                clientTime = Instant.now().toString(),
                clientTimeZone = ZoneId.systemDefault().id,
                expectedRevision = revision,
                attachments = attachments,
                settings = if (id == null) settings else null,
                systemPrompt = settings.systemPrompt,
                webSearch = settings.webSearch,
                mathTools = settings.mathTools,
                advanced = requestAdvanced(settings.advanced),
            )
        try {
            val path =
                if (id == null) "/api/sessions"
                else
                    api.sessionPath(id) +
                        if (editId == null) "/messages"
                        else "/messages/${api.encodePath(editId)}/edit"
            val ack = api.write<CommandAck, SendRequest>(path, "POST", request)
            if (epoch != generation) return ack.friendlyId.ifBlank { id }
            acceptCommand(ack)
            if (id == null) {
                sessionId = ack.friendlyId
                connect(ack.friendlyId)
            }
            refresh()
            scope.launch { runCatching { sessions.refresh() } }
            return sessionId
        } catch (e: Exception) {
            if (epoch == generation) {
                // Remove only this command's optimistic item; preserve concurrent SSE updates.
                val current = _history.value
                _history.value =
                    current.copy(
                        messages =
                            current.messages
                                .filter { it.clientId != clientId }
                                .let { turns -> if (editId != null) previous.messages else turns }
                    )
                refresh()
                if (e !is ApiException) _connection.value = ConnectionState.Offline
            }
            throw e
        }
    }

    private fun acceptCommand(ack: CommandAck) {
        if ((ack.revision ?: -1) < _history.value.revision) return
        val accepted = acceptConversationCommand(_history.value, ack)
        _history.value =
            accepted.copy(
                activeRunIds =
                    (accepted.activeRunIds.filter { it !in ack.invalidatedRunIds } +
                            listOfNotNull(ack.runId))
                        .distinct()
            )
    }

    suspend fun stop() {
        val id = sessionId ?: return
        val runId = activeRunId(_history.value) ?: return
        api.write<JsonObject, StopRequest>(
            api.sessionPath(id) + "/stop",
            "POST",
            StopRequest(runId),
        )
        refresh()
    }

    suspend fun retry(turn: JsonObject) {
        val id = sessionId ?: return
        val epoch = generation
        val ack =
            api.write<CommandAck, RetryRequest>(
                api.sessionPath(id) + "/runs/${api.encodePath(turn.runId)}/retry",
                "POST",
                RetryRequest(UUID.randomUUID().toString(), readyRevision()),
            )
        if (epoch == generation) {
            acceptCommand(ack)
            refresh()
        }
    }

    suspend fun deleteUser(turnId: String) {
        val id = sessionId ?: return
        val epoch = generation
        val revision = readyRevision()
        val previous = _history.value
        if (epoch == generation)
            _history.value =
                previous.copy(messages = previous.messages.takeWhile { it.id != turnId })
        try {
            val ack =
                wireJson.decodeFromString<CommandAck>(
                    api.raw(
                        api.sessionPath(id) +
                            "/messages/${api.encodePath(turnId)}?revision=$revision",
                        "DELETE",
                    )
                )
            if (epoch == generation) {
                acceptCommand(ack)
                refresh()
            }
            sessions.refresh()
        } catch (e: Exception) {
            if (epoch == generation) {
                _history.value = previous
                refresh()
            }
            throw e
        }
    }

    suspend fun fork(messageId: String): String {
        val id = checkNotNull(sessionId)
        val result =
            api.write<CommandAck, CloneRequest>(
                api.sessionPath(id) + "/clone",
                "POST",
                CloneRequest(messageId),
            )
        sessions.refresh()
        return result.friendlyId
    }

    suspend fun settings(settings: ConversationSettings) {
        val id = sessionId ?: return
        sessions.upsert(
            api.write<SessionSummary, SettingsRequest>(
                api.sessionPath(id) + "/settings",
                "PATCH",
                SettingsRequest(settings),
            )
        )
    }

    fun pause() {
        refreshGeneration++
        stream?.cancel()
        stream = null
        refreshAgain = false
        refreshJob?.cancel()
        refreshJob = null
    }

    fun resume() {
        sessionId?.let {
            refresh()
            connect(it)
        }
    }

    fun close() {
        pause()
        scope.cancel()
    }
}

fun requestAdvanced(settings: AdvancedSettings): JsonObject = buildJsonObject {
    if (settings.reasoning)
        put("reasoning", buildJsonObject { put("effort", settings.reasoningEffort) })
    if (settings.sampling)
        put(
            "sampling",
            buildJsonObject {
                put("temperature", settings.temperature)
                put("topP", settings.topP)
                put("topK", settings.topK)
            },
        )
    if (settings.penalties)
        put(
            "penalties",
            buildJsonObject {
                put("frequencyPenalty", settings.frequencyPenalty)
                put("presencePenalty", settings.presencePenalty)
            },
        )
    if (settings.maxTokens) put("maxTokens", settings.maxTokensValue)
}
