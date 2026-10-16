package org.kairos.android.data

import java.time.Instant
import java.time.ZoneId
import java.util.UUID
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.*
import kotlinx.serialization.json.*

/**
 * Paged, cached session list. The store mirrors the web's infinite query: the first page is
 * refetched on every refresh and older pages keep their request cursors; `loadMore` appends
 * pages on demand. Content is hydrated from a disk cache at construction so the sidebar is
 * warm before any network round-trip, then reconciled by the user-scoped SSE stream.
 */
class SessionsRepository(
    private val api: KairosApi,
    private val cache: DiskCache,
    private val tokens: TokenStore,
) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private val list: SessionListCache = cache.readSessions() ?: SessionListCache()
    private val _sessions = MutableStateFlow(list.merged())
    val sessions = _sessions.asStateFlow()
    private val _hasMore = MutableStateFlow(list.nextCursor != null)
    val hasMore = _hasMore.asStateFlow()
    private val _loadingMore = MutableStateFlow(false)
    val loadingMore = _loadingMore.asStateFlow()
    private val _ready = MutableStateFlow(list.loadedCount > 0)
    val ready = _ready.asStateFlow()
    private var syncJob: Job? = null
    private var streamJob: Job? = null
    private val scheduler = RefreshScheduler(scope, { refresh() })

    init {
        publish()
    }

    private fun publish() {
        _sessions.value = list.merged()
        _hasMore.value = list.nextCursor != null
    }

    private fun persist() {
        val snapshot = list.encoded()
        val cacheGeneration = cache.generation
        scope.launch(Dispatchers.IO) { cache.writeSessions(snapshot, cacheGeneration) }
    }

    suspend fun refresh() {
        // Refetch every loaded page; page 0 failures propagate to the caller so the UI can
        // surface them, older pages keep their previous slice when a refetch fails.
        val pageCount = list.pageCount
        var lastNext: String? = list.nextCursor
        var lastUpdated = -1
        for (index in 0 until pageCount) {
            val cursor = list.cursorFor(index)
            val query = buildString {
                append("limit=50")
                if (cursor != null) append("&" + api.parameter("cursor", cursor))
            }
            try {
                val response = api.get<SessionsResponse>("/api/sessions?" + query)
                list.set(index, cursor, response.sessions)
                // The list-wide cursor is the one from the deepest successfully refetched page.
                if (index >= lastUpdated) {
                    lastUpdated = index
                    lastNext = response.nextCursor
                }
            } catch (e: Exception) {
                if (e is CancellationException) throw e
                if (index == 0) throw e
            }
        }
        list.setNextCursor(lastNext)
        publish()
        _ready.value = true
        persist()
    }

    suspend fun loadMore() {
        if (_loadingMore.value) return
        val cursor = list.nextCursor ?: return
        _loadingMore.value = true
        try {
            val response =
                api.get<SessionsResponse>("/api/sessions?limit=50&" + api.parameter("cursor", cursor))
            list.append(cursor, response.sessions, response.nextCursor)
            publish()
            persist()
        } finally {
            _loadingMore.value = false
        }
    }

    /** Single-session lookup for ids missing from the loaded pages (deep links, old pages). */
    suspend fun fetch(friendlyId: String): SessionSummary {
        val session = api.get<SessionSummary>(api.sessionPath(friendlyId))
        upsert(session)
        return session
    }

    fun upsert(session: SessionSummary) {
        list.upsert(session)
        publish()
        persist()
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
        list.remove(session.friendlyId)
        publish()
        persist()
        try {
            api.raw(api.sessionPath(session.friendlyId), "DELETE")
        } catch (e: Exception) {
            list.clear()
            for (item in previous) list.upsert(item)
            publish()
            persist()
            throw e
        }
        refresh()
    }

    suspend fun search(query: String): List<SearchResult> =
        api.get<SearchResponse>("/api/sessions/search?" + api.query(query)).sessions

    fun clear() {
        list.clear()
        publish()
        _ready.value = false
        cache.delete(SESSIONS_CACHE_FILE)
    }

    /**
     * Keep the list synchronized while the app is in the foreground. The user-scoped stream
     * only signals change; a debounced first-page refresh carries the actual state. Sign-out
     * and 401 teardown both end the stream.
     */
    fun startSync() {
        if (syncJob?.isActive == true) return
        syncJob =
            scope.launch {
                tokens.signedIn.collect { signedIn ->
                    if (signedIn && api.server.url.isNotBlank()) {
                        if (streamJob?.isActive != true) {
                            streamJob = launch {
                                try {
                                    refresh()
                                } catch (e: CancellationException) {
                                    throw e
                                } catch (_: Exception) {
                                    // The stream and later notifications still reconcile.
                                }
                                sessionListEvents(api).collect { scheduler.schedule() }
                            }
                        }
                    } else {
                        streamJob?.cancel()
                        streamJob = null
                    }
                }
            }
    }

    fun stopSync() {
        syncJob?.cancel()
        syncJob = null
        streamJob?.cancel()
        streamJob = null
    }
}

class ModelsRepository(private val api: KairosApi, private val cache: DiskCache) {
    private val restored = cache.readModels()
    private val _catalog = MutableStateFlow(restored?.catalog ?: ModelsResponse())
    val catalog = _catalog.asStateFlow()
    var chatSettings = restored?.chatSettings ?: ChatSettingsPreferences()
        private set

    suspend fun refresh() {
        val response = api.get<ModelsResponse>("/api/models")
        val settings = api.get<ChatSettingsResponse>("/api/me/chat-settings").settings
        _catalog.value = response
        chatSettings = settings
        persist()
    }

    fun clear() {
        _catalog.value = ModelsResponse()
        chatSettings = ChatSettingsPreferences()
        cache.delete(MODELS_CACHE_FILE)
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

    /** PATCH /api/me/preferences; the response is the updated preferences object. */
    suspend fun setDefault(modelId: String) {
        val response =
            api.write<PreferencesResponse, PreferencesRequest>(
                "/api/me/preferences",
                "PATCH",
                PreferencesRequest(modelId),
            )
        _catalog.value = _catalog.value.copy(preferences = response.preferences)
        persist()
    }

    private suspend fun persist() {
        val snapshot = ModelsCacheState(catalog = _catalog.value, chatSettings = chatSettings)
        val cacheGeneration = cache.generation
        withContext(Dispatchers.IO) { cache.writeModels(snapshot, cacheGeneration) }
    }
}

class ConversationRepository(
    private val api: KairosApi,
    private val sessions: SessionsRepository,
    private val historyCache: DiskCache,
) {
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
            // A cached snapshot renders instantly; the authoritative refresh and stream reconcile
            // over it because server revisions never move backwards.
            val epoch = generation
            scope.launch {
                val cached = withContext(Dispatchers.IO) { historyCache.readHistory(id) }
                if (epoch == generation && cached != null && cached.revision > _history.value.revision)
                    _history.value = cached
            }
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
                                if (update.event.state != "delta") persistHistory(applied.history)
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
                    ) {
                        _history.value = fetched
                        persistHistory(fetched)
                    }
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

    private fun persistHistory(history: History) {
        val id = sessionId ?: return
        val epoch = generation
        val cacheGeneration = historyCache.generation
        scope.launch(Dispatchers.IO) {
            if (generation == epoch && sessionId == id) {
                historyCache.writeHistory(id, history, cacheGeneration)
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
