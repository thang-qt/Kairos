package org.kairos.android.data

import java.nio.file.Files
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertNull
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.fail
import org.junit.Test

class PendingSendStoreTest {
    @Test
    fun reusesCommandIdAcrossStoreRecreationWithoutPersistingMessage() = runBlocking {
        val root = Files.createTempDirectory("kairos-send-journal").toFile()
        val cache = DiskCache(root)
        val store = PendingSendStore(cache)
        val settings = ConversationSettings(model = "test-model")
        val digest = store.fingerprint(
            sessionId = "chat-1",
            editId = null,
            message = "Private user prompt",
            settings = settings,
            attachments = listOf(AttachmentPayload("image/png", "private-base64-content")),
        )
        val first = store.acquire(digest)
        val serialized = checkNotNull(cache.readString("pending-send.json"))
        assertEquals(false, "Private user prompt" in serialized)
        assertEquals(false, "private-base64-content" in serialized)
        val restored = PendingSendStore(DiskCache(root))
        assertEquals(first, restored.acquire(digest))

        val modified = restored.fingerprint(
            sessionId = "chat-1",
            editId = null,
            message = "Edited user prompt",
            settings = settings,
            attachments = emptyList(),
        )
        val next = restored.acquire(modified)
        assertNotEquals(first, next)
        restored.forgetIf(first)
        assertEquals(next, restored.acquire(modified))
        restored.forgetIf(next)
        assertNotEquals(next, restored.acquire(modified))
    }

    @Test
    fun identityResetInvalidatesPendingCommand() = runBlocking {
        val root = Files.createTempDirectory("kairos-send-reset").toFile()
        val cache = DiskCache(root)
        val store = PendingSendStore(cache)
        val old = store.acquire("fixed-fingerprint")
        cache.clear()
        assertNotEquals(old, store.acquire("fixed-fingerprint"))
    }

    @Test
    fun delayedOldSendCannotCreateJournalAfterIdentityReset() = runBlocking {
        val cache = DiskCache(Files.createTempDirectory("kairos-send-stale").toFile())
        val store = PendingSendStore(cache)
        val originalGeneration = cache.generation
        cache.clear()

        try {
            store.acquire("old-fingerprint", originalGeneration)
            fail("old send must not write into the new identity cache")
        } catch (_: StaleIdentityException) {}

        assertNull(cache.readString("pending-send.json"))
    }

    @Test
    fun oldCleanupCannotDeleteTheNewIdentityJournal() = runBlocking {
        val cache = DiskCache(Files.createTempDirectory("kairos-send-cleanup").toFile())
        val store = PendingSendStore(cache)
        val oldGeneration = cache.generation
        val oldId = store.acquire("old-fingerprint", oldGeneration)

        cache.clear()
        val newId = store.acquire("new-fingerprint")
        store.forgetIf(oldId, oldGeneration)

        assertEquals(newId, store.acquire("new-fingerprint"))
    }
}
