package org.kairos.android.app

import android.app.Application
import android.content.Context
import android.content.MutableContextWrapper
import org.kairos.android.data.*
import org.kairos.android.transcript.TranscriptBridge
import java.io.File

class KairosApplication : Application() {
    lateinit var container: AppContainer
        private set

    val theme
        get() = container.preferences

    override fun onCreate() {
        super.onCreate()
        container = AppContainer(this)
    }
}

class AppContainer(context: Context) {
    val server = ServerStore(context)
    val tokens = TokenStore(context)
    val preferences = PreferencesStore(context)
    private val cache = DiskCache(File(context.filesDir, "kairos-data"))
    private val historyCache =
        DiskCache(File(context.filesDir, "kairos-data/history"), maxBytes = 8L * 1024 * 1024)
    val api = KairosApi(server, tokens)
    val sessions = SessionsRepository(api, cache, tokens)
    val models = ModelsRepository(api, cache)
    val mcp = McpApprovalsRepository(api)
    // The assistant never constructs a WebView. Only the full application asks for this lazy
    // singleton.
    private val transcript = lazy { TranscriptBridge(api, MutableContextWrapper(context)) }
    val bridge
        get() = transcript.value

    fun clearUserData() {
        sessions.clear()
        models.clear()
        mcp.clear()
        cache.clear()
        historyCache.clear()
        if (transcript.isInitialized()) transcript.value.render(null, emptyList())
    }

    fun conversation() = ConversationRepository(api, sessions, historyCache)
}

sealed interface Screen {
    data object Connect : Screen

    data object SignIn : Screen

    data object Chat : Screen

    data object Settings : Screen
}
