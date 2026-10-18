package org.kairos.android.app

import android.content.Context
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.setValue
import org.kairos.android.data.*
import org.kairos.android.assistant.LibraryAttachment
import java.io.File
import java.security.MessageDigest

class AppContainer(context: Context) {
    private val appContext = context.applicationContext
    val server = ServerStore(context)
    val tokens = TokenStore(context)
    val preferences = PreferencesStore(context)
    val foregroundAssistant = ForegroundAssistantRouter()
    private val cacheRoot = File(context.filesDir, "kairos-data")

    // Disk history is a UI cache, never account state. A startup with a different
    // server or bearer token must not expose the last identity's cached transcript.
    init {
        if (!tokens.signedIn.value) LibraryAttachment.clear(appContext)
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
    val api = BackendApi(server, tokens)
    val mcpLabels = McpLabels(api)
    val pendingSends = PendingSendStore(cache)
    val lastSession = LastSessionStore(cache)
    val sessions = SessionsRepository(api, cache, tokens)
    val models = ModelsRepository(api, cache)
    /** Changes whenever authenticated data is cleared, fencing in-flight asset reads. */
    var identityVersion by mutableLongStateOf(0L)
        private set

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
        identityVersion++
        // A photo selected for the previous account must never appear in a new session.
        LibraryAttachment.clear(appContext)
        mcpLabels.clear()
        sessions.stopSync()
        sessions.clear()
        models.clear()
        cache.clear()
        historyCache.clear()
    }

    fun conversation() = ConversationRepository(api, sessions, historyCache, pendingSends)
}
