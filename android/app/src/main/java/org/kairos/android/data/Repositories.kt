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
    private val api: BackendApi,
    private val cache: DiskCache,
    private val tokens: TokenStore,
    private val identityProvider: () -> RepositoryIdentity = {
        RepositoryIdentity(0L, api.server.url, api.tokens.token, cache.generation)
    },
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

    fun captureIdentity(): RepositoryIdentity = identityProvider()

    fun isCurrent(identity: RepositoryIdentity): Boolean = identity == identityProvider()

    fun requireCurrent(identity: RepositoryIdentity) {
        if (!isCurrent(identity)) throw StaleIdentityException()
    }

    private fun persist(identity: RepositoryIdentity = captureIdentity()) {
        val snapshot = list.encoded()
        scope.launch(Dispatchers.IO) {
            if (isCurrent(identity)) cache.writeSessions(snapshot, identity.cacheGeneration)
        }
    }

    suspend fun refresh(expectedIdentity: RepositoryIdentity? = null) {
        val identity = expectedIdentity ?: captureIdentity()
        requireCurrent(identity)
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
                requireCurrent(identity)
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
        requireCurrent(identity)
        list.setNextCursor(lastNext)
        publish()
        _ready.value = true
        persist(identity)
    }

    suspend fun loadMore(expectedIdentity: RepositoryIdentity? = null) {
        if (_loadingMore.value) return
        val cursor = list.nextCursor ?: return
        val identity = expectedIdentity ?: captureIdentity()
        requireCurrent(identity)
        val loadingGeneration = ++loadingMoreGeneration
        _loadingMore.value = true
        try {
            val response =
                api.get<SessionsResponse>("/api/sessions?limit=50&" + api.parameter("cursor", cursor))
            requireCurrent(identity)
            list.append(cursor, response.sessions, response.nextCursor)
            publish()
            persist(identity)
        } finally {
            if (loadingGeneration == loadingMoreGeneration) _loadingMore.value = false
        }
    }

    private var loadingMoreGeneration = 0L

    /** Single-session lookup for ids missing from the loaded pages (deep links, old pages). */
    suspend fun fetch(friendlyId: String): SessionSummary {
        val identity = captureIdentity()
        val session = api.get<SessionSummary>(api.sessionPath(friendlyId))
        requireCurrent(identity)
        upsert(session, identity)
        return session
    }

    fun upsert(session: SessionSummary, identity: RepositoryIdentity = captureIdentity()) {
        if (!isCurrent(identity)) return
        list.upsert(session)
        publish()
        persist(identity)
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
        val identity = captureIdentity()
        requireCurrent(identity)
        upsert(next, identity)
        try {
            val response = mutation()
            requireCurrent(identity)
            upsert(response, identity)
        } catch (e: Exception) {
            requireCurrent(identity)
            upsert(old, identity)
            throw e
        }
        refresh(identity)
    }

    suspend fun delete(session: SessionSummary) {
        val identity = captureIdentity()
        requireCurrent(identity)
        val previous = _sessions.value
        list.remove(session.friendlyId)
        publish()
        persist(identity)
        try {
            api.raw(api.sessionPath(session.friendlyId), "DELETE")
            requireCurrent(identity)
        } catch (e: Exception) {
            requireCurrent(identity)
            list.clear()
            for (item in previous) list.upsert(item)
            publish()
            persist(identity)
            throw e
        }
        refresh(identity)
    }

    suspend fun search(query: String): List<SearchResult> {
        val identity = captureIdentity()
        val results = api.get<SearchResponse>("/api/sessions/search?" + api.query(query)).sessions
        requireCurrent(identity)
        return results
    }

    fun clear() {
        loadingMoreGeneration++
        list.clear()
        publish()
        _ready.value = false
        _loadingMore.value = false
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
                                val identity = captureIdentity()
                                try {
                                    refresh(identity)
                                } catch (e: CancellationException) {
                                    throw e
                                } catch (_: Exception) {
                                    // The stream and later notifications still reconcile.
                                }
                                sessionListEvents(api, identity).collect {
                                    if (isCurrent(identity)) scheduler.schedule()
                                }
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

class ModelsRepository(
    private val api: BackendApi,
    private val cache: DiskCache,
    private val identityProvider: () -> RepositoryIdentity = {
        RepositoryIdentity(0L, api.server.url, api.tokens.token, cache.generation)
    },
) {
    private val restored = cache.readModels()
    private val _catalog = MutableStateFlow(restored?.catalog ?: ModelsResponse())
    val catalog = _catalog.asStateFlow()
    var chatSettings = restored?.chatSettings ?: ChatSettingsPreferences()
        private set

    suspend fun refresh(expectedIdentity: RepositoryIdentity? = null) {
        val identity = expectedIdentity ?: identityProvider()
        requireCurrent(identity)
        val response = api.get<ModelsResponse>("/api/models")
        requireCurrent(identity)
        val settings = api.get<ChatSettingsResponse>("/api/me/chat-settings").settings
        requireCurrent(identity)
        _catalog.value = response
        chatSettings = settings
        persist(identity)
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
        val identity = identityProvider()
        val response =
            api.write<PreferencesResponse, PreferencesRequest>(
                "/api/me/preferences",
                "PATCH",
                PreferencesRequest(modelId),
            )
        requireCurrent(identity)
        _catalog.value = _catalog.value.copy(preferences = response.preferences)
        persist(identity)
    }

    private fun requireCurrent(identity: RepositoryIdentity) {
        if (identity != identityProvider()) throw StaleIdentityException()
    }

    private suspend fun persist(identity: RepositoryIdentity) {
        requireCurrent(identity)
        val snapshot = ModelsCacheState(catalog = _catalog.value, chatSettings = chatSettings)
        withContext(Dispatchers.IO) {
            if (identity == identityProvider())
                cache.writeModels(snapshot, identity.cacheGeneration)
        }
    }
}

class ConversationRepository(
    private val api: BackendApi,
    private val sessions: SessionsRepository,
    private val historyCache: DiskCache,
    private val pendingSends: PendingSendStore? = null,
    private val identityProvider: () -> RepositoryIdentity = sessions::captureIdentity,
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

    private data class PendingSend(
        val sessionId: String?,
        val editId: String?,
        val text: String,
        val attachments: List<AttachmentPayload>,
        val settings: ConversationSettings,
        val clientId: String,
    )
    // Retain the command identity after an ambiguous network failure: a retry of
    // the same input must not create a second run if the first reached the server.
    private var ambiguousSend: PendingSend? = null
    var sessionId: String? = null
        private set

    fun open(id: String?) {
        val identity = identityProvider()
        val cacheGeneration = historyCache.generation
        ambiguousSend = null
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
                if (
                    epoch == generation && sessions.isCurrent(identity) &&
                        cacheGeneration == historyCache.generation && cached != null &&
                        cached.revision > _history.value.revision
                )
                    _history.value = cached
            }
            refresh()
            connect(id, identity)
        }
    }

    private fun connect(id: String, expectedIdentity: RepositoryIdentity? = null) {
        val identity = expectedIdentity ?: identityProvider()
        if (!sessions.isCurrent(identity)) return
        val cacheGeneration = historyCache.generation
        stream?.cancel()
        val epoch = generation
        stream =
            scope.launch {
                EventStream(api, identity)
                    .events(id, _history.value.cursor)
                    .catch {
                        if (epoch == generation && sessions.isCurrent(identity))
                            _connection.value = ConnectionState.Offline
                    }
                    .collect { update ->
                        if (epoch != generation || !sessions.isCurrent(identity)) return@collect
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
                                if (update.event.state != "delta")
                                    persistHistory(applied.history, id, identity, cacheGeneration)
                                update.event.session?.let { sessions.upsert(it, identity) }
                                if (applied.refetch) refresh(identity)
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
                                    scope.launch {
                                        if (sessions.isCurrent(identity))
                                            runCatching { sessions.refresh(identity) }
                                    }
                            }
                        }
                    }
            }
    }

    fun refresh(expectedIdentity: RepositoryIdentity? = null) {
        val id = sessionId ?: return
        val identity = expectedIdentity ?: identityProvider()
        if (!sessions.isCurrent(identity)) return
        if (refreshJob?.isActive == true) {
            refreshAgain = true
            return
        }
        val cacheGeneration = historyCache.generation
        val epoch = generation
        val refreshEpoch = refreshGeneration
        refreshJob =
            scope.launch {
                try {
                    val fetched = api.get<History>(api.sessionPath(id) + "/history")
                    if (
                        epoch == generation && sessions.isCurrent(identity) &&
                            refreshEpoch == refreshGeneration &&
                            fetched.revision >= _history.value.revision &&
                            fetched.cursor >= _history.value.cursor
                    ) {
                        _history.value = fetched
                        persistHistory(fetched, id, identity, cacheGeneration)
                    }
                } catch (e: Exception) {
                    if (e is CancellationException) throw e
                    if (
                        epoch == generation && sessions.isCurrent(identity) &&
                            refreshEpoch == refreshGeneration
                    )
                        _connection.value = ConnectionState.Offline
                } finally {
                    if (
                        epoch == generation && refreshEpoch == refreshGeneration &&
                            sessions.isCurrent(identity)
                    ) {
                        refreshJob = null
                        if (refreshAgain) {
                            refreshAgain = false
                            refresh(identity)
                        }
                    }
                }
            }
    }

    private fun persistHistory(
        history: History,
        id: String,
        identity: RepositoryIdentity,
        cacheGeneration: Long,
    ) {
        val epoch = generation
        scope.launch(Dispatchers.IO) {
            if (
                generation == epoch && sessionId == id && sessions.isCurrent(identity) &&
                    historyCache.generation == cacheGeneration
            ) {
                historyCache.writeHistory(id, history, cacheGeneration)
            }
        }
    }

    fun retryConnection() {
        val identity = identityProvider()
        sessionId?.let {
            refresh(identity)
            connect(it, identity)
        }
    }

    suspend fun readyRevision(identity: RepositoryIdentity = identityProvider()): Long {
        sessions.requireCurrent(identity)
        if (_history.value.revision < 0) {
            val id = checkNotNull(sessionId)
            val fetched = api.get<History>(api.sessionPath(id) + "/history")
            sessions.requireCurrent(identity)
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
        val identity = identityProvider()
        val prior = ambiguousSend
        // Hashing can cover megabytes of attachment bytes; never do it on the main thread.
        val fingerprint =
            pendingSends?.let { store ->
                withContext(Dispatchers.IO) {
                    store.fingerprint(id, editId, text, settings, attachments)
                }
            }
        sessions.requireCurrent(identity)
        val clientId =
            if (fingerprint != null) {
                checkNotNull(pendingSends).acquire(fingerprint, identity.cacheGeneration)
            } else if (
                prior != null &&
                    prior.sessionId == id &&
                    prior.editId == editId &&
                    prior.text == text &&
                    prior.attachments == attachments &&
                    prior.settings == settings
            ) prior.clientId else UUID.randomUUID().toString()
        sessions.requireCurrent(identity)
        ambiguousSend = null
        val previous = _history.value
        val revision = if (id != null) readyRevision(identity) else null
        sessions.requireCurrent(identity)
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
                message = text,
                clientId = clientId,
                clientTime = Instant.now().toString(),
                clientTimeZone = ZoneId.systemDefault().id,
                expectedRevision = revision,
                attachments = attachments,
                // Creation persists this draft as the new conversation's settings. Existing
                // conversations send no generation fields at all: omitted overrides inherit
                // the backend's authoritative saved settings.
                settings = if (id == null) settings else null,
            )
        try {
            val path =
                if (id == null) "/api/sessions"
                else
                    api.sessionPath(id) +
                        if (editId == null) "/messages"
                        else "/messages/${api.encodePath(editId)}/edit"
            val ack = api.write<CommandAck, SendRequest>(path, "POST", request)
            sessions.requireCurrent(identity)
            pendingSends?.forgetIf(clientId, identity.cacheGeneration)
            sessions.requireCurrent(identity)
            if (epoch != generation) return ack.friendlyId.ifBlank { id }
            acceptCommand(ack)
            if (id == null) {
                sessionId = ack.friendlyId
                connect(ack.friendlyId)
            }
            refresh(identity)
            scope.launch {
                if (sessions.isCurrent(identity)) runCatching { sessions.refresh(identity) }
            }
            return sessionId
        } catch (e: Exception) {
            if (!sessions.isCurrent(identity)) throw StaleIdentityException()
            if (e is ApiException && e.code != 408 && e.code < 500) {
                // A definitive rejection cannot be replayed as the same command.
                withContext(NonCancellable) {
                    pendingSends?.forgetIf(clientId, identity.cacheGeneration)
                }
            }
            sessions.requireCurrent(identity)
            if (epoch == generation && e !is CancellationException) {
                // A timeout, transport error, or 5xx may occur after backend acceptance.
                // Keep the idempotency key for the user's next matching retry.
                if (e !is ApiException || e.code == 408 || e.code >= 500) {
                    ambiguousSend = PendingSend(id, editId, text, attachments, settings, clientId)
                }
            }
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
                refresh(identity)
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
        val identity = identityProvider()
        api.write<JsonObject, StopRequest>(
            api.sessionPath(id) + "/stop",
            "POST",
            StopRequest(runId),
        )
        sessions.requireCurrent(identity)
        refresh(identity)
    }

    suspend fun retry(turn: JsonObject) {
        val id = sessionId ?: return
        val epoch = generation
        val identity = identityProvider()
        val revision = readyRevision(identity)
        sessions.requireCurrent(identity)
        val ack =
            api.write<CommandAck, RetryRequest>(
                api.sessionPath(id) + "/runs/${api.encodePath(turn.runId)}/retry",
                "POST",
                RetryRequest(UUID.randomUUID().toString(), revision),
            )
        sessions.requireCurrent(identity)
        if (epoch == generation) {
            acceptCommand(ack)
            refresh(identity)
        }
    }

    suspend fun deleteUser(turnId: String) {
        val id = sessionId ?: return
        val epoch = generation
        val identity = identityProvider()
        val revision = readyRevision(identity)
        sessions.requireCurrent(identity)
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
            sessions.requireCurrent(identity)
            if (epoch == generation) {
                acceptCommand(ack)
                refresh(identity)
            }
            sessions.refresh(identity)
        } catch (e: Exception) {
            if (!sessions.isCurrent(identity)) throw StaleIdentityException()
            if (epoch == generation) {
                _history.value = previous
                refresh(identity)
            }
            throw e
        }
    }

    suspend fun fork(messageId: String): String {
        val id = checkNotNull(sessionId)
        val identity = identityProvider()
        val result =
            api.write<CommandAck, CloneRequest>(
                api.sessionPath(id) + "/clone",
                "POST",
                CloneRequest(messageId),
            )
        sessions.requireCurrent(identity)
        sessions.refresh(identity)
        sessions.requireCurrent(identity)
        return result.friendlyId
    }

    suspend fun settings(settings: ConversationSettings) {
        val id = sessionId ?: return
        val identity = identityProvider()
        val response = api.write<SessionSummary, SettingsRequest>(
                api.sessionPath(id) + "/settings",
                "PATCH",
                SettingsRequest(settings),
            )
        sessions.requireCurrent(identity)
        sessions.upsert(response, identity)
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
        val identity = identityProvider()
        sessionId?.let {
            refresh(identity)
            connect(it, identity)
        }
    }

    fun close() {
        pause()
        scope.cancel()
    }
}

