package org.kairos.android.assistant

import java.security.MessageDigest

internal const val ATTACHMENT_HANDOFF_TTL_MS = 30 * 60 * 1000L

/** No image bytes, bearer token, or composer text belong in the picker journal. */
internal data class AttachmentHandoff(
    val requestId: String,
    val identity: String,
    val createdAt: Long,
    val sessionId: String?,
    val uri: String? = null,
    val returned: Boolean = false,
) {
    fun isValid(currentIdentity: String?, now: Long): Boolean =
        currentIdentity != null && identity == currentIdentity && requestId.isNotBlank() &&
            createdAt >= 0 && createdAt <= now && now - createdAt < ATTACHMENT_HANDOFF_TTL_MS
}

internal fun attachmentIdentity(server: String, token: String?): String? {
    if (token == null) return null
    val bytes = MessageDigest.getInstance("SHA-256")
        .digest((server + "\n" + token).toByteArray(Charsets.UTF_8))
    return bytes.joinToString("") { "%02x".format(it) }
}

/** Invalidates asynchronous UI work across show/hide and account changes. */
internal class OverlayOperationEpoch {
    private var value = 0L
    fun capture(): Long = value
    fun advance() { value++ }
    fun accepts(epoch: Long): Boolean = value == epoch
}
