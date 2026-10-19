package org.kairos.android

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.kairos.android.assistant.MainAttachmentRequest

class MainAttachmentRequestTest {
    private val picker = MainAttachmentRequest.Source.Picker
    private val camera = MainAttachmentRequest.Source.Camera

    @Test
    fun acceptsOnlyTheOriginalAccountRequestAndSelection() {
        val request =
            checkNotNull(
                MainAttachmentRequest.begin(
                    identity = "account-one",
                    identityGeneration = 8,
                    selectionGeneration = 12,
                    sessionId = null,
                    source = picker,
                )
            )

        assertTrue(request.accepts(request.requestId, picker, "account-one", 8, 12, null))
        assertFalse(request.accepts("another-request", picker, "account-one", 8, 12, null))
        assertFalse(request.accepts(request.requestId, picker, "account-two", 8, 12, null))
        assertFalse(request.accepts(request.requestId, picker, "account-one", 9, 12, null))
        // The composer has returned to new-chat (null), but it is a different selection.
        assertFalse(request.accepts(request.requestId, picker, "account-one", 8, 14, null))
        assertFalse(request.accepts(request.requestId, picker, "account-one", 8, 12, "session-one"))
        assertFalse(request.accepts(request.requestId, camera, "account-one", 8, 12, null))
    }

    @Test
    fun latePickerResultCannotTakeOwnershipOfANewerLaunch() {
        val requestA =
            checkNotNull(MainAttachmentRequest.begin("account-one", 8, 12, null, picker))
        // A selection change invalidates A, but its launch ticket stays outstanding until the
        // Activity Result callback drains. That blocks B from replacing A's ownership.
        assertFalse(MainAttachmentRequest.canLaunch(requestA))
        val callbackTicket = MainAttachmentRequest.callbackTicket(requestA, picker)
        assertTrue(callbackTicket === requestA)
        assertFalse(MainAttachmentRequest.callbackTicket(requestA, camera) === requestA)
        assertFalse(
            checkNotNull(callbackTicket).accepts(
                callbackTicket.requestId,
                picker,
                currentIdentity = "account-two",
                currentIdentityGeneration = 9,
                currentSelectionGeneration = 13,
                currentSessionId = null,
            )
        )

        // Only A's callback clears A; the next launch then gets an independent ticket.
        assertTrue(MainAttachmentRequest.canLaunch(null))
        val requestB =
            checkNotNull(MainAttachmentRequest.begin("account-two", 9, 13, null, picker))
        assertFalse(requestB.requestId == requestA.requestId)
        assertTrue(requestB.accepts(requestB.requestId, picker, "account-two", 9, 13, null))
    }
}
