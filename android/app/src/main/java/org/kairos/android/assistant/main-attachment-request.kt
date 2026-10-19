package org.kairos.android.assistant

import java.util.UUID

/** Captures the composer that launched a main-app picker or camera request. */
internal data class MainAttachmentRequest(
    val requestId: String,
    val identity: String,
    val identityGeneration: Long,
    val selectionGeneration: Int,
    val sessionId: String?,
    val source: Source,
) {
    enum class Source {
        Picker,
        Camera,
    }

    fun accepts(
        deliveredRequestId: String,
        deliveredSource: Source,
        currentIdentity: String?,
        currentIdentityGeneration: Long,
        currentSelectionGeneration: Int,
        currentSessionId: String?,
    ): Boolean =
        requestId.isNotBlank() && deliveredRequestId == requestId && source == deliveredSource &&
            identity == currentIdentity && identityGeneration == currentIdentityGeneration &&
            selectionGeneration == currentSelectionGeneration && sessionId == currentSessionId

    companion object {
        fun begin(
            identity: String?,
            identityGeneration: Long,
            selectionGeneration: Int,
            sessionId: String?,
            source: Source,
        ): MainAttachmentRequest? =
            identity?.let {
                MainAttachmentRequest(
                    UUID.randomUUID().toString(),
                    it,
                    identityGeneration,
                    selectionGeneration,
                    sessionId,
                    source,
                )
            }

        /** A launcher result has no request id; the one outstanding ticket owns its callback. */
        fun callbackTicket(
            outstanding: MainAttachmentRequest?,
            deliveredSource: Source,
        ): MainAttachmentRequest? = outstanding?.takeIf { it.source == deliveredSource }

        /** Never release a ticket on selection changes; only its launcher callback drains it. */
        fun canLaunch(outstanding: MainAttachmentRequest?): Boolean = outstanding == null
    }
}
