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
    private val identityPrefs =
        context.getSharedPreferences("identity-generation", Context.MODE_PRIVATE)

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
    private val identityGeneration =
        IdentityGeneration(identityPrefs.getLong("generation", 0L))
    /** Changes whenever authenticated data is cleared, fencing in-flight asset reads. */
    var identityVersion by mutableLongStateOf(identityGeneration.value())
        private set

    val api = BackendApi(server, tokens, ::captureIdentity)
    val mcpLabels = McpLabels(api)
    val pendingSends = PendingSendStore(cache)
    val lastSession = LastSessionStore(cache)

    val sessions = SessionsRepository(api, cache, tokens, ::captureIdentity)
    val models = ModelsRepository(api, cache, ::captureIdentity)

    private fun cacheIdentity(): String {
        val source = server.url + "\n" + tokens.token.orEmpty()
        val digest = MessageDigest.getInstance("SHA-256").digest(source.toByteArray(Charsets.UTF_8))
        return digest.joinToString("") { "%02x".format(it) }
    }

    /** Hashed marker for identity-owned SavedStateHandle values; never stores a bearer token. */
    fun savedStateIdentity(): String? = tokens.token?.let { cacheIdentity() }

    fun captureIdentity() =
        RepositoryIdentity(
            generation = identityGeneration.value(),
            serverUrl = server.url,
            token = tokens.token,
            cacheGeneration = cache.generation,
        )

    /** Call after a new sign-in so all repositories start from that identity's data. */
    fun bindSignedInIdentity() {
        clearUserData()
        File(cacheRoot, ".identity").writeText(cacheIdentity())
    }

    fun clearUserData() {
        // Advance before clearing repositories so all requests already in flight fail their
        // identity check even if the bearer token is immediately reused on the next sign-in.
        val generation = identityGeneration.advance()
        identityPrefs.edit().putLong("generation", generation).commit()
        identityVersion = generation
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
