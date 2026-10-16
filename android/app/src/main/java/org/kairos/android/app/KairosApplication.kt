package org.kairos.android.app

import android.app.Application
import android.content.Context
import android.content.MutableContextWrapper
import org.kairos.android.data.*
import org.kairos.android.transcript.TranscriptBridge
import java.io.File
import java.security.MessageDigest

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
    private val cacheRoot = File(context.filesDir, "kairos-data")

    // Disk history is a UI cache, never account state. A startup with a different
    // server or bearer token must not expose the last identity's cached transcript.
    init {
        val expected = cacheIdentity()
        val marker = File(cacheRoot, ".identity")
        if (marker.takeIf { it.isFile }?.readText() != expected) {
            cacheRoot.deleteRecursively()
        }
        cacheRoot.mkdirs()
        marker.writeText(expected)
    }

    private val cache = DiskCache(cacheRoot)
    private val historyCache =
        DiskCache(File(cacheRoot, "history"), maxBytes = 8L * 1024 * 1024)
    val api = KairosApi(server, tokens)
    val sessions = SessionsRepository(api, cache, tokens)
    val models = ModelsRepository(api, cache)
    // The assistant never constructs a WebView. Only the full application asks for this lazy
    // singleton.
    private val transcript = lazy { TranscriptBridge(api, MutableContextWrapper(context)) }
    val bridge
        get() = transcript.value

    private fun cacheIdentity(): String {
        val source = server.url + "\n" + tokens.token.orEmpty()
        val digest = MessageDigest.getInstance("SHA-256").digest(source.toByteArray(Charsets.UTF_8))
        return digest.joinToString("") { "%02x".format(it) }
    }

    /** Call after a new sign-in so all repositories start from that identity's data. */
    fun bindSignedInIdentity() {
        clearUserData()
        File(cacheRoot, ".identity").writeText(cacheIdentity())
    }

    fun clearUserData() {
        sessions.stopSync()
        sessions.clear()
        models.clear()
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

/** Navigation intent from UI actions; only the NavHost owns destination history. */
sealed interface NavigationRequest {
    data object Connect : NavigationRequest
    data object SignIn : NavigationRequest
    data object Settings : NavigationRequest
    data object Search : NavigationRequest
    data object Back : NavigationRequest
    data class Chat(val friendlyId: String?, val replaceCurrent: Boolean = false) : NavigationRequest
}
