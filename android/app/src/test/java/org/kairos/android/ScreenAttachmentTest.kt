package org.kairos.android

import org.junit.Assert.*
import org.junit.Test

class ScreenAttachmentTest {
    @Test fun boundsPortraitLandscapeAndSmallImagesWithoutUpscaling() {
        assertEquals(486 to 1080, screenImageSize(1440, 3200))
        assertEquals(1080 to 608, screenImageSize(3840, 2160))
        assertEquals(320 to 240, screenImageSize(320, 240))
        assertEquals(1 to 1080, screenImageSize(1, 4000))
    }
    @Test fun nullScreenshotRequiresExplicitSettingsHintAndHideClearsIt() {
        val capture = ScreenCaptureState()
        capture.begin()
        capture.receive(null)
        assertFalse(capture.available)
        assertNull(capture.attached)
        assertFalse(capture.showSettingsHint)
        capture.attach()
        assertTrue(capture.showSettingsHint)
        capture.clear()
        assertFalse(capture.available)
        assertFalse(capture.showSettingsHint)
        assertNull(capture.takeAttachment())
        capture.receive(null) // Late delivery after hide is ignored.
        assertFalse(capture.available)
        capture.begin()
        capture.receive(null)
        assertFalse(capture.showSettingsHint)
    }
    @Test fun handoffOwnsItsBytesAndStoreClearsOldConversation() {
        val bytes = byteArrayOf(1, 2, 3)
        val image = ScreenAttachment("random-id", 100, 200, bytes)
        val handoff = image.copyForHandoff()
        bytes[0] = 9
        assertArrayEquals(byteArrayOf(1, 2, 3), handoff.openStream().readBytes())
        val store = MemoryScreenImages()
        store.replace(listOf(ChatMessage("u", "user", "Question", attachment = handoff)))
        assertSame(handoff, store.find("random-id.jpg"))
        assertNull(store.find("../random-id.jpg"))
        store.replace(listOf(ChatMessage("next", "user", "No attachment")))
        assertNull(store.find("random-id.jpg"))
        store.replace(listOf(ChatMessage("u", "user", "Question", attachment = handoff)))
        store.clear()
        assertNull(store.find("random-id.jpg"))
    }
}
