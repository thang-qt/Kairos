package org.kairos.android.chat

import androidx.compose.runtime.*
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.*
import kotlinx.serialization.json.JsonObject
import org.kairos.android.app.*
import org.kairos.android.data.*

class ChatViewModel(val app: AppContainer) : ViewModel() {
    val conversation = app.conversation()
    val history = conversation.history
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

    var sessionId by mutableStateOf<String?>(null)
        private set

    var model by mutableStateOf("")
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

    var longPressId by mutableStateOf<String?>(null)
    var activityId by mutableStateOf<String?>(null)
    var searchOpen by mutableStateOf(false)
        private set

    var conversationSettingsOpen by mutableStateOf(false)
        private set

    val pendingApprovals = app.mcp.pending
    private var selectionGeneration = 0
    private var pendingSession: String? = null
    val activeSession
        get() = sessions.value.find { it.friendlyId == sessionId }

    val modelLabel
        get() = app.models.name(activeSession?.settings?.model?.ifBlank { model } ?: model)

    val streaming
        get() = sending || activeRunId(history.value) != null

    init {
        viewModelScope.launch {
            app.tokens.signedIn.collect { signedIn ->
                if (!signedIn && screen in listOf(Screen.Chat, Screen.Settings)) {
                    conversation.open(null)
                    sessionId = null
                    app.clearUserData()
                    screen = if (app.server.url.isBlank()) Screen.Connect else Screen.SignIn
                }
            }
        }
        // Poll MCP approvals only while the newest assistant turn is a live remote tool call.
        viewModelScope.launch {
            while (isActive) {
                val needsPolling = approvalRunId(history.value.messages) != null
                if (needsPolling) app.mcp.refresh()
                delay(if (needsPolling) 1000 else 2000)
            }
        }
        if (app.tokens.signedIn.value) bootstrap()
    }

    private fun bootstrap() {
        viewModelScope.launch {
            try {
                val me = app.api.get<MeResponse>("/api/me")
                if (me.user == null) app.tokens.clear()
            } catch (e: Exception) {
                if (e is CancellationException) throw e
                if (app.tokens.signedIn.value) offline = true
            }
            if (app.tokens.signedIn.value) refreshAll()
        }
    }

    suspend fun refreshAll() {
        try {
            app.models.refresh()
            app.sessions.refresh()
            offline = false
            if (model.isBlank()) model = app.models.defaultModel()
        } catch (e: Exception) {
            if (e is CancellationException) throw e
            offline = true
        }
    }

    fun connect(url: String) = task {
        val normalized = normalizeServerUrl(url)
        val capabilities = app.api.connect(normalized)
        check(capabilities.capabilities.auth.enabled) {
            "This server has sign-in disabled. Kairos chat still requires an authenticated account. Enable authentication on the server."
        }
        app.server.save(normalized)
        screen = Screen.SignIn
    }

    fun signIn(email: String, password: String) = task {
        app.tokens.save(app.api.login(email.trim(), password))
        screen = Screen.Chat
        select(pendingSession)
        pendingSession = null
        refreshAll()
    }

    fun changeConnect() {
        error = null
        screen = Screen.Connect
    }

    fun settings() {
        screen = Screen.Settings
        conversation.pause()
    }

    fun back() {
        error = null
        when (screen) {
            Screen.SignIn -> screen = Screen.Connect
            Screen.Settings -> {
                screen = Screen.Chat
                conversation.resume()
            }
            else -> Unit
        }
    }

    fun select(id: String?) {
        selectionGeneration++
        sessionId = id
        conversation.open(id)
        editing = null
        composerSeed = ""
        composerGeneration++
        error = null
        conversationSettingsOpen = false
        app.mcp.clear()
        model =
            sessions.value
                .find { it.friendlyId == id }
                ?.settings
                ?.model
                ?.ifBlank { app.models.defaultModel() } ?: app.models.defaultModel()
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
    }

    fun openIntent(id: String?) {
        if (app.tokens.signedIn.value) {
            screen = Screen.Chat
            select(id)
        } else pendingSession = id
    }

    fun refreshSessions() =
        viewModelScope.launch {
            try {
                app.sessions.refresh()
            } catch (e: Exception) {
                if (e is CancellationException) throw e
                offline = true
            }
        }

    fun retryConnection() {
        error = null
        conversation.retryConnection()
        viewModelScope.launch { refreshAll() }
    }

    fun chooseModel(key: String) = task {
        val generation = selectionGeneration
        val settings = (activeSession?.settings ?: app.models.defaults(key)).copy(model = key)
        conversation.settings(settings)
        if (generation == selectionGeneration) model = key
    }

    fun send(text: String, attachments: List<AttachmentPayload> = emptyList()) = task {
        sending = true
        val generation = selectionGeneration
        val selected =
            activeSession?.settings
                ?: app.models.defaults(model.ifBlank { app.models.defaultModel() })
        try {
            val next = conversation.send(text, selected, attachments, editing?.id)
            if (generation == selectionGeneration) {
                sessionId = next
                editing = null
                offline = false
            }
        } catch (e: Exception) {
            if (e !is CancellationException && generation == selectionGeneration) seed(text)
            throw e
        } finally {
            sending = false
        }
    }

    fun stop() = task(exclusive = false) { conversation.stop() }

    fun edit(message: JsonObject) {
        editing = message
        seed(message.copyText())
    }

    fun cancelEdit() {
        editing = null
        seed("")
    }

    fun seed(text: String) {
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
        if (point?.role == "user") seed(point.copyText())
    }

    fun rename(session: SessionSummary, title: String) = task {
        app.sessions.rename(session, title.trim())
    }

    fun pin(session: SessionSummary) = task { app.sessions.pin(session) }

    fun loadMoreSessions() {
        viewModelScope.launch {
            try {
                app.sessions.loadMore()
            } catch (e: Exception) {
                if (e is CancellationException) throw e
                offline = true
            }
        }
    }

    fun setDefaultModel(key: String) = task { app.models.setDefault(key) }

    fun decideApproval(approval: McpApproval, decision: String, scope: String? = null) = task {
        app.mcp.decide(approval, decision, scope)
    }

    fun saveConversationSettings(settings: ConversationSettings) = task {
        conversation.settings(settings)
    }

    fun openSearch() {
        error = null
        searchOpen = true
    }

    fun closeSearch() {
        searchOpen = false
    }

    fun openConversationSettings() {
        error = null
        conversationSettingsOpen = true
    }

    fun closeConversationSettings() {
        conversationSettingsOpen = false
    }

    fun deleteSession(session: SessionSummary) = task {
        app.sessions.delete(session)
        if (sessionId == session.friendlyId) select(null)
    }

    fun logout(changeServer: Boolean = false) = task {
        app.api.logout()
        app.tokens.clear()
        if (changeServer) {
            app.server.clear()
            screen = Screen.Connect
        } else screen = Screen.SignIn
        select(null)
        app.sessions.clear()
        app.models.clear()
        app.mcp.clear()
    }

    fun showError(message: String) {
        error = message
    }

    private fun task(exclusive: Boolean = true, block: suspend () -> Unit): Job =
        viewModelScope.launch {
            if (exclusive && busy) return@launch
            if (exclusive) busy = true
            error = null
            try {
                block()
            } catch (e: Exception) {
                if (e is CancellationException) throw e
                error = e.message ?: "Request failed."
                if (e is ApiException && e.code == 409) conversation.refresh()
            } finally {
                if (exclusive) busy = false
            }
        }

    override fun onCleared() {
        conversation.close()
    }
}
