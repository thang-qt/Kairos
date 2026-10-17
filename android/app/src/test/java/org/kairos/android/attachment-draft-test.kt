package org.kairos.android.assistant

import org.junit.Assert.*
import org.junit.Test

class AttachmentDraftTest {
    private fun image(id: String) = ScreenAttachment(id, 1, 1, byteArrayOf(1))

    @Test fun addsRemovesAndSendsMultipleImages() {
        val state = ScreenCaptureState()
        val first = image("first")
        val second = image("second")
        state.receiveAttachment(first)
        state.receiveAttachment(second)
        assertEquals(listOf(first, second), state.attachments)
        state.remove(first)
        assertEquals(listOf(second), state.takeAttachments())
        assertTrue(state.attachments.isEmpty())
    }

    @Test fun dismissalClearsImagesAndRejectsLateDelivery() {
        val state = ScreenCaptureState()
        state.receiveAttachment(image("first"))
        state.clear()
        state.receiveAttachment(image("late"))
        assertTrue(state.attachments.isEmpty())
    }
}
