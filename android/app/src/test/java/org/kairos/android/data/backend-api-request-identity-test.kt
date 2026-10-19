package org.kairos.android.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.fail
import org.junit.Test

class BackendApiRequestIdentityTest {
    @Test
    fun requestKeepsTheServerAndBearerCapturedBeforeDispatch() {
        val server = ServerStore("https://one.example")
        val tokens = TokenStore("token-one")
        val api = BackendApi(server, tokens)
        val request = api.request("/api/sessions")
        val originalTokenGeneration = tokens.generation

        tokens.clear()
        server.save("https://two.example")

        assertEquals("https://one.example/api/sessions", request.url.toString())
        assertEquals("Bearer token-one", request.header("Authorization"))
        assertEquals(originalTokenGeneration + 1, tokens.generation)

        val nextRequest = api.request("/api/sessions")
        assertEquals("https://two.example/api/sessions", nextRequest.url.toString())
        assertNull(nextRequest.header("Authorization"))
    }

    @Test
    fun reconnectCannotBuildARequestUnderANewerIdentity() {
        val server = ServerStore("https://one.example")
        val tokens = TokenStore("token-one")
        val cache = DiskCache(java.nio.file.Files.createTempDirectory("kairos-request-owner").toFile())
        var identity = RepositoryIdentity(3, server.url, tokens.token, cache.generation)
        val api = BackendApi(server, tokens) { identity }
        val original = identity
        val frozenRequest = api.request("/api/events", expectedIdentity = original)

        identity = identity.copy(generation = 4)
        assertEquals("Bearer token-one", frozenRequest.header("Authorization"))
        try {
            api.request("/api/events", expectedIdentity = original)
            fail("a reconnect must not adopt a newer repository identity")
        } catch (_: StaleIdentityException) {}
    }
}
