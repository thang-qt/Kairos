package org.kairos.android

import org.junit.Assert.*
import org.junit.Test
import org.kairos.android.assistant.*

class AttachmentHandoffTest {
    @Test
    fun ticketIsBoundToAccountServerAndExpiry() {
        val identity = checkNotNull(attachmentIdentity("https://one.example", "token-one"))
        val handoff = AttachmentHandoff("request", identity, 1000L, "session")
        assertTrue(handoff.isValid(identity, 1001L))
        assertFalse(handoff.isValid(attachmentIdentity("https://two.example", "token-one"), 1001L))
        assertFalse(handoff.isValid(attachmentIdentity("https://one.example", "token-two"), 1001L))
        assertFalse(handoff.isValid(null, 1001L))
        assertFalse(handoff.isValid(identity, 1000L + ATTACHMENT_HANDOFF_TTL_MS))
        assertFalse(handoff.isValid(identity, 999L))
        assertFalse(handoff.copy(createdAt = Long.MIN_VALUE).isValid(identity, 1001L))
        assertFalse(handoff.copy(requestId = "").isValid(identity, 1001L))
    }

    @Test
    fun oldCallbacksCannotUpdateReopenedOverlay() {
        val epochs = OverlayOperationEpoch()
        val first = epochs.capture()
        assertTrue(epochs.accepts(first))
        epochs.advance() // hide/account change
        epochs.advance() // show
        val second = epochs.capture()
        assertFalse(epochs.accepts(first))
        assertTrue(epochs.accepts(second))
        epochs.advance() // destroy
        assertFalse(epochs.accepts(second))
    }
}
