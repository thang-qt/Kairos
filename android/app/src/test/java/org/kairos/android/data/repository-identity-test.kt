package org.kairos.android.data

import java.nio.file.Files
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.async
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import kotlinx.serialization.encodeToString
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class RepositoryIdentityTest {
    @Test
    fun delayedSessionRefreshCannotPublishOrPersistAfterIdentityClear() = runBlocking {
        val cache = DiskCache(Files.createTempDirectory("kairos-session-identity").toFile())
        var identity = RepositoryIdentity(4, "https://one.example", "token-one", cache.generation)
        val api = DeferredBackendApi()
        val sessions = SessionsRepository(api, cache, TokenStore("token-one")) { identity }

        val oldRefresh = async { sessions.refresh() }
        val oldCall = api.calls.receive()
        assertTrue(oldCall.path.startsWith("/api/sessions?"))

        identity = identity.copy(generation = 5, token = "token-two")
        sessions.clear()
        cache.clear()
        identity = identity.copy(cacheGeneration = cache.generation)
        oldCall.response.complete(
            wireJson.encodeToString(
                SessionsResponse(listOf(SessionSummary(friendlyId = "old-session", title = "Old")))
            )
        )
        try {
            oldRefresh.await()
            throw AssertionError("old refresh should be fenced")
        } catch (_: StaleIdentityException) {}

        assertTrue(sessions.sessions.value.isEmpty())
        assertEquals(null, cache.readSessions())

        val newRefresh = async { sessions.refresh() }
        val newCall = api.calls.receive()
        newCall.response.complete(
            wireJson.encodeToString(
                SessionsResponse(listOf(SessionSummary(friendlyId = "new-session", title = "New")))
            )
        )
        newRefresh.await()
        withTimeout(2_000) {
            while (cache.readSessions()?.merged()?.singleOrNull()?.friendlyId != "new-session") delay(5)
        }
        assertEquals(listOf("new-session"), sessions.sessions.value.map { it.friendlyId })
    }

    @Test
    fun delayedModelRefreshCannotRefillTheCatalogAfterClear() = runBlocking {
        val cache = DiskCache(Files.createTempDirectory("kairos-model-identity").toFile())
        var identity = RepositoryIdentity(2, "https://one.example", "token-one", cache.generation)
        val api = DeferredBackendApi()
        val models = ModelsRepository(api, cache) { identity }

        val oldRefresh = async { models.refresh() }
        val modelsCall = api.calls.receive()
        assertEquals("/api/models", modelsCall.path)
        modelsCall.response.complete(
            wireJson.encodeToString(ModelsResponse(models = listOf(Model(id = "old-model"))))
        )
        val settingsCall = api.calls.receive()
        assertEquals("/api/me/chat-settings", settingsCall.path)

        identity = identity.copy(generation = 3, token = "token-two")
        models.clear()
        cache.clear()
        identity = identity.copy(cacheGeneration = cache.generation)
        settingsCall.response.complete(wireJson.encodeToString(ChatSettingsResponse()))
        try {
            oldRefresh.await()
            throw AssertionError("old refresh should be fenced")
        } catch (_: StaleIdentityException) {}

        assertTrue(models.catalog.value.models.isEmpty())
        assertEquals(null, cache.readModels())
    }

    @Test
    fun staleMutationFailureCannotRollBackIntoTheNextIdentity() = runBlocking {
        val cache = DiskCache(Files.createTempDirectory("kairos-mutation-identity").toFile())
        val original = SessionSummary(friendlyId = "session-one", label = "Original")
        val seed = SessionListCache().apply { upsert(original) }
        cache.writeSessions(seed.encoded(), cache.generation)
        var identity = RepositoryIdentity(7, "https://one.example", "token-one", cache.generation)
        val api = DeferredBackendApi()
        val sessions = SessionsRepository(api, cache, TokenStore("token-one")) { identity }

        val rename = async { sessions.rename(original, "Optimistic") }
        val renameCall = api.calls.receive()
        assertEquals("/api/sessions/session-one", renameCall.path)
        assertEquals("Optimistic", sessions.sessions.value.single().label)

        identity = identity.copy(generation = 8, token = "token-two")
        sessions.clear()
        cache.clear()
        identity = identity.copy(cacheGeneration = cache.generation)
        renameCall.response.completeExceptionally(ApiException(500, "old account failed"))
        try {
            rename.await()
            throw AssertionError("stale mutation should be fenced")
        } catch (_: StaleIdentityException) {}

        assertTrue(sessions.sessions.value.isEmpty())
        assertEquals(null, cache.readSessions())
    }

    private class DeferredBackendApi :
        BackendApi(ServerStore("https://one.example"), TokenStore("token-one")) {
        val calls = Channel<PendingCall>(Channel.UNLIMITED)

        override suspend fun raw(
            path: String,
            method: String,
            body: String?,
            base: String,
            authenticated: Boolean,
        ): String {
            val response = CompletableDeferred<String>()
            calls.send(PendingCall(path, response))
            return response.await()
        }
    }

    private data class PendingCall(val path: String, val response: CompletableDeferred<String>)
}
