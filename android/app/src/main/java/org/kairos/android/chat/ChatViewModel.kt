package org.kairos.android.chat

import androidx.compose.runtime.*
import androidx.lifecycle.ViewModel
import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.*
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.encodeToString
import kotlinx.serialization.decodeFromString
import org.kairos.android.app.*
import org.kairos.android.data.*

class ChatViewModel(val app: AppContainer, private val savedState: SavedStateHandle) : ViewModel() {
    private val stateIdentity = app.savedStateIdentity()
    private val canRestoreIdentityState = IdentitySavedState.canRestore(savedState, stateIdentity)
    private val drafts: MutableMap<String, String> =
        if (canRestoreIdentityState)
            savedState.get<HashMap<String, String>>(IdentitySavedState.DRAFTS_KEY)?.toMutableMap()
                ?: mutableMapOf()
        else mutableMapOf()

    private fun draftKey(id: String?): String = id ?: "__new_chat__"

    fun saveDraft(text: String) {
        val key = draftKey(sessionId)
        if (text.isEmpty()) drafts.remove(key) else drafts[key] = text
        savedState[IdentitySavedState.DRAFTS_KEY] = HashMap(drafts)
        saveStateIdentity()
    }

    var newChatSettings by mutableStateOf(
        if (canRestoreIdentityState)
            savedState.get<String>(IdentitySavedState.NEW_CHAT_SETTINGS_KEY)?.let { raw ->
            runCatching { wireJson.decodeFromString<ConversationSettings>(raw) }.getOrNull()
        } else null
    )
        private set

    private fun updateNewChatDraftSettings(settings: ConversationSettings?) {
        newChatSettings = settings
        if (settings == null) savedState.remove<String>(IdentitySavedState.NEW_CHAT_SETTINGS_KEY)
        else savedState[IdentitySavedState.NEW_CHAT_SETTINGS_KEY] = wireJson.encodeToString(settings)
        saveStateIdentity()
    }
    val conversation = app.conversation()
    private val ephemeral = EphemeralConversation(app.api, app::captureIdentity)
    private val navigationEvents = MutableSharedFlow<NavigationRequest>(extraBufferCapacity = 16)
    val navigation = navigationEvents.asSharedFlow()

    private fun navigate(request: NavigationRequest) {
        navigationEvents.tryEmit(request)
    }

    /** Invoked by NavHost on process restoration and system Back. */
    fun enterRoute(destination: Screen, id: String? = null, search: Boolean = false) {
        val previous = screen
        screen = destination
        searchOpen = search
        when (destination) {
            Screen.Chat -> {
                if (!search && conversation.sessionId != id) {
                    if (restoredSelectionPending && sessionId == id) {
                        restoredSelectionPending = false
                        select(id, notifyNavigation = false, preserveGeneration = true)
                    } else select(id, notifyNavigation = false)
                }
                else if (previous == Screen.Settings) conversation.resume()
            }
            Screen.Settings -> conversation.pause()
            else -> Unit
        }
    }

    // Saved sessions stream from the repository; throwaway mode swaps in its local history.
    private val mergedHistory = MutableStateFlow(History())
    val history: StateFlow<History> = mergedHistory.asStateFlow()
    val connection = conversation.connection
    val sessions = app.sessions.sessions
    val hasMore = app.sessions.hasMore
    val loadingMore = app.sessions.loadingMore
    val sessionsReady = app.sessions.ready
    val catalog = app.models.catalog
    var screen by
        mutableStateOf<Screen>(
            if (app.tokens.signedIn.value && app.server.url.isNotBlank()) Screen.Chat
            else if (app.server.url.isBlank()) Screen.Connect else Screen.SignIn
        )
        private set

    var sessionId by mutableStateOf(
        if (canRestoreIdentityState)
            savedState.get<String>(IdentitySavedState.SELECTED_CONVERSATION_KEY)
        else null
    )
        private set

    private var restoredSelectionPending = canRestoreIdentityState && sessionId != null

    var model by mutableStateOf(
        newChatSettings?.model?.takeIf { it.isNotBlank() } ?: app.models.defaultModel()
    )
        private set

    var busy by mutableStateOf(false)
        private set

    var sending by mutableStateOf(false)
        private set

    var error by mutableStateOf<String?>(null)
        private set

    var offline by mutableStateOf(false)
        private set

    var editing by mutableStateOf<JsonObject?>(null)
        private set

    var composerSeed by mutableStateOf("")
        private set

    var composerGeneration by mutableIntStateOf(0)
        private set

    /** Focus pops only when the draft is intentionally pre-filled (edit, fork), never on open. */
    var composerFocusGeneration by mutableIntStateOf(0)
        private set

    var ephemeralMode by mutableStateOf(false)
        private set

    var longPressId by mutableStateOf<String?>(null)
    var activityId by mutableStateOf<String?>(null)
    var searchOpen by mutableStateOf(false)
        private set

    var conversationSettingsOpen by mutableStateOf(false)
        private set

    var conversationSettingsTarget by mutableStateOf<String?>(null)
        private set

    var selectionGeneration by mutableIntStateOf(
        if (canRestoreIdentityState)
            savedState.get<Int>(IdentitySavedState.SELECTION_GENERATION_KEY) ?: 0
        else 0
    )
        private set
    private var pendingSession: String? = null
    private var viewModelOperationGeneration = 0L

    private fun saveStateIdentity() {
        IdentitySavedState.bind(savedState, app.savedStateIdentity())
    }

    private fun clearSavedIdentityState() {
        IdentitySavedState.clear(savedState)
    }

    private fun clearIdentityOwnedState() {
        viewModelOperationGeneration++
        drafts.clear()
        clearSavedIdentityState()
        saveStateIdentity()
        sessionId = null
        savedState.remove<String>(IdentitySavedState.SELECTED_CONVERSATION_KEY)
        selectionGeneration++
        savedState.remove<Int>(IdentitySavedState.SELECTION_GENERATION_KEY)
        pendingSession = null
        conversation.open(null)
        ephemeral.reset()
        ephemeralMode = false
        mergedHistory.value = History()
        editing = null
        composerSeed = ""
        composerGeneration++
        composerFocusGeneration = 0
        newChatSettings = null
        model = ""
        error = null
        offline = false
        busy = false
        sending = false
        searchOpen = false
        conversationSettingsOpen = false
        conversationSettingsTarget = null
        longPressId = null
        activityId = null
    }
    val activeSession
        get() = sessions.value.find { it.friendlyId == sessionId }

    val modelLabel
        get() = app.models.name(activeSession?.settings?.model?.ifBlank { model } ?: model)

    val streaming
        get() =
            sending ||
                ephemeral.streaming.value ||
                activeRunId(mergedHistory.value) != null

    init {
        saveStateIdentity()
        viewModelScope.launch {
            conversation.history.collect { if (!ephemeralMode) mergedHistory.value = it }
        }
        viewModelScope.launch {
            ephemeral.history.collect { if (ephemeralMode) mergedHistory.value = it }
        }
        viewModelScope.launch {
            ephemeral.error.collect { value ->
                if (value != null) {
                    error = value
                    ephemeral.clearError()
                }
            }
        }
        viewModelScope.launch {
            app.tokens.signedIn.collect { signedIn ->
                if (!signedIn && screen in listOf(Screen.Chat, Screen.Settings)) {
                    clearIdentityOwnedState()
                    app.clearUserData()
                    screen = if (app.server.url.isBlank()) Screen.Connect else Screen.SignIn
                    navigate(if (screen == Screen.Connect) NavigationRequest.Connect else NavigationRequest.SignIn)
                }
            }
        }
        if (app.tokens.signedIn.value) bootstrap()
    }

    private fun bootstrap() {
        viewModelScope.launch {
            val identity = app.captureIdentity()
            try {
                val me = app.api.get<MeResponse>("/api/me")
                app.sessions.requireCurrent(identity)
                if (me.user == null) app.tokens.clear()
            } catch (e: Exception) {
                if (e is CancellationException) throw e
                if (app.sessions.isCurrent(identity) && app.tokens.signedIn.value) offline = true
            }
            if (app.sessions.isCurrent(identity) && app.tokens.signedIn.value)
                refreshAll(identity)
        }
    }

    suspend fun refreshAll(expectedIdentity: RepositoryIdentity? = null) {
        val identity = expectedIdentity ?: app.captureIdentity()
        app.sessions.requireCurrent(identity)
        try {
            app.models.refresh(identity)
            app.sessions.refresh(identity)
            app.sessions.requireCurrent(identity)
            offline = false
            if (model.isBlank()) model = app.models.defaultModel()
        } catch (e: Exception) {
            if (e is CancellationException) throw e
            if (app.sessions.isCurrent(identity)) offline = true
        }
    }

    fun connect(url: String) = task {
        val identity = app.captureIdentity()
        val normalized = normalizeServerUrl(url)
        val capabilities = app.api.connect(normalized)
        app.sessions.requireCurrent(identity)
        check(capabilities.capabilities.auth.enabled) {
            "This server has sign-in disabled. Kairos chat still requires an authenticated account. Enable authentication on the server."
        }
        // A server change invalidates the old account's local projection.
        clearIdentityOwnedState()
        app.tokens.clear()
        app.clearUserData()
        app.server.save(normalized)
        screen = Screen.SignIn
        navigate(NavigationRequest.SignIn)
    }

    fun signIn(email: String, password: String) = task {
        val requestedSession = pendingSession
        val identity = app.captureIdentity()
        val response = app.api.login(email.trim(), password)
        app.sessions.requireCurrent(identity)
        clearIdentityOwnedState()
        app.tokens.save(response)
        app.bindSignedInIdentity()
        saveStateIdentity()
        screen = Screen.Chat
        select(requestedSession)
        refreshAll()
        app.sessions.startSync()
    }

    fun changeConnect() {
        error = null
        clearIdentityOwnedState()
        app.tokens.clear()
        app.clearUserData()
        screen = Screen.Connect
        navigate(NavigationRequest.Connect)
    }

    fun settings() {
        screen = Screen.Settings
        conversation.pause()
        navigate(NavigationRequest.Settings)
    }

    fun back() {
        error = null
        when (screen) {
            Screen.SignIn -> {
                screen = Screen.Connect
                navigate(NavigationRequest.Connect)
            }
            Screen.Settings -> {
                screen = Screen.Chat
                conversation.resume()
                navigate(NavigationRequest.Back)
            }
            else -> Unit
        }
    }

    fun select(
        id: String?,
        notifyNavigation: Boolean = true,
        preserveGeneration: Boolean = false,
    ) {
        if (!preserveGeneration) {
            selectionGeneration++
            savedState[IdentitySavedState.SELECTION_GENERATION_KEY] = selectionGeneration
        }
        sessionId = id
        savedState[IdentitySavedState.SELECTED_CONVERSATION_KEY] = id
        app.lastSession.save(id)
        ephemeralMode = false
        ephemeral.reset()
        // Clear the previous chat before opening the requested conversation.
        // The repository will hydrate that conversation's cached snapshot.
        mergedHistory.value = History()
        conversation.open(id)
        editing = null
        composerSeed = drafts[draftKey(id)].orEmpty()
        composerGeneration++
        composerFocusGeneration = 0
        error = null
        conversationSettingsOpen = false
        conversationSettingsTarget = null
        model =
            if (id == null) {
                newChatSettings?.model?.ifBlank { app.models.defaultModel() }
                    ?: app.models.defaultModel()
            } else {
                sessions.value.find { it.friendlyId == id }?.settings?.model
                    ?.ifBlank { app.models.defaultModel() }
                    ?: app.models.defaultModel()
            }
        // Sessions outside the loaded pages (deep links, older than the first page) resolve
        // their summary in the background instead of falling back to default settings.
        if (id != null && sessions.value.none { it.friendlyId == id }) {
            val generation = selectionGeneration
            viewModelScope.launch {
                try {
                    val session = app.sessions.fetch(id)
                    if (selectionGeneration == generation && sessionId == id)
                        model = session.settings.model.ifBlank { model }
                } catch (e: CancellationException) {
                    throw e
                } catch (_: Exception) {
                    // Deep-linked sessions missing from the pages stay on default settings.
                }
            }
        }
        if (notifyNavigation) navigate(NavigationRequest.Chat(id))
    }

    fun openNewChatFromAssistant() {
        openIntent(null)
        if (app.tokens.signedIn.value) composerFocusGeneration++
    }

    fun openIntent(id: String?) {
        if (app.tokens.signedIn.value) {
            screen = Screen.Chat
            select(id)
        } else pendingSession = id
    }

    fun refreshSessions() =
        viewModelScope.launch {
            val identity = app.captureIdentity()
            try {
                app.sessions.refresh(identity)
            } catch (e: Exception) {
                if (e is CancellationException) throw e
                if (app.sessions.isCurrent(identity)) offline = true
            }
        }

    fun retryConnection() {
        error = null
        conversation.retryConnection()
        viewModelScope.launch { refreshAll() }
    }

    fun chooseModel(key: String) = task {
        val generation = selectionGeneration
        val settings =
            (activeSession?.settings ?: newChatSettings ?: app.models.defaults(key)).copy(model = key)
        if (sessionId == null) updateNewChatDraftSettings(settings) else conversation.settings(settings)
        if (generation == selectionGeneration) model = key
    }

    /** Throwaway mode only exists on a fresh, empty new chat, like the web. */
    fun toggleEphemeral() {
        if (sessionId != null || mergedHistory.value.messages.isNotEmpty()) return
        ephemeralMode = !ephemeralMode
        ephemeral.reset()
        error = null
        mergedHistory.value = History()
    }

    fun send(text: String, attachments: List<AttachmentPayload> = emptyList()) = task {
        val operationGeneration = viewModelOperationGeneration
        sending = true
        val generation = selectionGeneration
        val selected =
            activeSession?.settings
                ?: newChatSettings
                ?: app.models.defaults(model.ifBlank { app.models.defaultModel() })
        try {
            if (ephemeralMode) {
                ephemeral.send(text, selected, attachments) { seed(text) }
            } else {
                val next = conversation.send(text, selected, attachments, editing?.id)
                if (generation == selectionGeneration) {
                    val wasNewConversation = sessionId == null
                    sessionId = next
                    savedState[IdentitySavedState.SELECTED_CONVERSATION_KEY] = next
                    app.lastSession.save(next)
                    editing = null
                    offline = false
                    if (wasNewConversation && next != null) {
                        updateNewChatDraftSettings(null)
                        navigate(NavigationRequest.Chat(next))
                    }
                }
            }
        } catch (e: Exception) {
            if (
                e !is CancellationException && operationGeneration == viewModelOperationGeneration &&
                    generation == selectionGeneration
            ) seed(text)
            throw e
        } finally {
            if (operationGeneration == viewModelOperationGeneration) sending = false
        }
    }

    fun stop() = task(exclusive = false) {
        if (ephemeralMode) ephemeral.stop() else conversation.stop()
    }

    fun edit(message: JsonObject) {
        editing = message
        seed(message.copyText())
        composerFocusGeneration++
    }

    fun cancelEdit() {
        editing = null
        seed("")
    }

    fun seed(text: String) {
        saveDraft(text)
        composerSeed = text
        composerGeneration++
    }

    fun retry(message: JsonObject) = task {
        sending = true
        try {
            conversation.retry(message)
        } finally {
            sending = false
        }
    }

    fun deleteMessage(message: JsonObject) = task {
        // The web deletes user turns (and the corresponding answer), never standalone assistant
        // rows.
        val turns = history.value.messages
        val index = turns.indexOfFirst { it.id == message.id }
        val user =
            if (message.role == "user") message
            else turns.take(index.coerceAtLeast(0)).lastOrNull { it.role == "user" }
        if (user != null) conversation.deleteUser(user.id)
    }

    fun fork(message: JsonObject? = null) = task {
        val turns = history.value.messages
        val point = message ?: turns.lastOrNull { it.role != "toolResult" }
        val previous =
            if (point?.role == "user")
                turns.take(turns.indexOf(point)).lastOrNull { it.role != "toolResult" }
            else point
        if (previous == null) select(null) else select(conversation.fork(previous.id))
        if (point?.role == "user") {
            seed(point.copyText())
            composerFocusGeneration++
        }
    }

    fun rename(session: SessionSummary, title: String) = task {
        app.sessions.rename(session, title.trim())
    }

    fun pin(session: SessionSummary) = task { app.sessions.pin(session) }

    fun loadMoreSessions() {
        viewModelScope.launch {
            val identity = app.captureIdentity()
            try {
                app.sessions.loadMore(identity)
            } catch (e: Exception) {
                if (e is CancellationException) throw e
                if (app.sessions.isCurrent(identity)) offline = true
            }
        }
    }

    fun setDefaultModel(key: String) = task { app.models.setDefault(key) }

    fun decideApproval(approval: McpApproval, decision: String, scope: String? = null) = task {
        app.api.decideApproval(approval, decision, scope)
    }

    fun saveConversationSettings(settings: ConversationSettings) = task {
        val identity = app.captureIdentity()
        val target = conversationSettingsTarget
        if (target == null && sessionId == null) {
            updateNewChatDraftSettings(settings)
            model = settings.model
        } else if (target == null || target == sessionId) {
            conversation.settings(settings)
        } else {
            val updated = app.api.write<SessionSummary, SettingsRequest>(
                app.api.sessionPath(target) + "/settings",
                "PATCH",
                SettingsRequest(settings),
            )
            app.sessions.requireCurrent(identity)
            app.sessions.upsert(updated, identity)
        }
    }

    fun openSearch() {
        error = null
        searchOpen = true
        navigate(NavigationRequest.Search)
    }

    fun closeSearch(navigateBack: Boolean = true) {
        searchOpen = false
        if (navigateBack) navigate(NavigationRequest.Back)
    }

    fun openConversationSettings(target: String? = sessionId) {
        error = null
        conversationSettingsTarget = target
        conversationSettingsOpen = true
    }

    fun closeConversationSettings() {
        conversationSettingsOpen = false
        conversationSettingsTarget = null
    }

    fun deleteSession(session: SessionSummary) = task {
        app.sessions.delete(session)
        if (sessionId == session.friendlyId) select(null)
    }

    fun logout(changeServer: Boolean = false) = task {
        val identity = app.captureIdentity()
        // Remote revocation is best-effort. The user must be able to sign out locally
        // even when the server is unreachable or the token is already invalid.
        try {
            app.api.logout()
        } catch (e: CancellationException) {
            throw e
        } catch (_: Exception) {
            // Always clear local credentials in finally.
        } finally {
            val currentIdentity = app.captureIdentity()
            // An interceptor/observer may already have signed out this identity. Allow that
            // teardown, but never let a suspended logout erase a newer sign-in or server.
            if (app.server.url == identity.serverUrl &&
                (currentIdentity.token == null || currentIdentity == identity)
            ) {
                app.tokens.clear()
                clearIdentityOwnedState()
                app.clearUserData()
                if (changeServer) app.server.clear()
                screen = if (changeServer) Screen.Connect else Screen.SignIn
                navigate(if (changeServer) NavigationRequest.Connect else NavigationRequest.SignIn)
            }
        }
    }

    fun showError(message: String) {
        error = message
    }

    private fun task(exclusive: Boolean = true, block: suspend () -> Unit): Job {
        val operationGeneration = viewModelOperationGeneration
        return viewModelScope.launch {
            if (operationGeneration != viewModelOperationGeneration) return@launch
            if (exclusive && busy) return@launch
            if (exclusive) busy = true
            error = null
            try {
                block()
            } catch (e: Exception) {
                if (e is CancellationException) throw e
                if (operationGeneration == viewModelOperationGeneration) {
                    error = e.message ?: "Request failed."
                    if (e is ApiException && e.code == 409) conversation.refresh()
                }
            } finally {
                if (operationGeneration == viewModelOperationGeneration && exclusive)
                    busy = false
            }
        }
    }

    override fun onCleared() {
        conversation.close()
        ephemeral.close()
    }
}
