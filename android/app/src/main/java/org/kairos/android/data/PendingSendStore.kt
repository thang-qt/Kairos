package org.kairos.android.data

import java.nio.ByteBuffer
import java.security.MessageDigest
import java.util.UUID
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString

private const val PENDING_SEND_FILE = "pending-send.json"

@Serializable
private data class PendingSendRecord(
    val fingerprint: String,
    val clientId: String,
)

/**
 * A private, identity-scoped command journal. Stores only a payload digest and
 * idempotency key, never prompt or image content. Write BEFORE making the HTTP
 * call so re-submitting after process death retains its server command identity.
 */
class PendingSendStore(private val cache: DiskCache) {
    private val mutex = Mutex()

    fun fingerprint(
        sessionId: String?,
        editId: String?,
        message: String,
        settings: ConversationSettings,
        attachments: List<AttachmentPayload>,
    ): String {
        val digest = MessageDigest.getInstance("SHA-256")
        fun update(value: String) {
            val bytes = value.toByteArray(Charsets.UTF_8)
            digest.update(ByteBuffer.allocate(4).putInt(bytes.size).array())
            digest.update(bytes)
        }
        update(sessionId.orEmpty())
        update(editId.orEmpty())
        update(message)
        update(wireJson.encodeToString(settings))
        update(attachments.size.toString())
        attachments.forEach {
            update(it.mimeType)
            update(it.content)
        }
        return digest.digest().joinToString("") { "%02x".format(it) }
    }

    suspend fun acquire(fingerprint: String): String = mutex.withLock {
        withContext(Dispatchers.IO) {
            val stored = cache.readString(PENDING_SEND_FILE)?.let { text ->
                runCatching { wireJson.decodeFromString<PendingSendRecord>(text) }.getOrNull()
            }
            if (stored?.fingerprint == fingerprint) {
                stored.clientId
            } else {
                val next = PendingSendRecord(fingerprint, UUID.randomUUID().toString())
                cache.writeString(PENDING_SEND_FILE, wireJson.encodeToString(next))
                next.clientId
            }
        }
    }

    suspend fun forgetIf(clientId: String) = mutex.withLock {
        withContext(Dispatchers.IO) {
            val stored = cache.readString(PENDING_SEND_FILE)?.let { text ->
                runCatching { wireJson.decodeFromString<PendingSendRecord>(text) }.getOrNull()
            }
            if (stored?.clientId == clientId) cache.delete(PENDING_SEND_FILE)
        }
    }
}
