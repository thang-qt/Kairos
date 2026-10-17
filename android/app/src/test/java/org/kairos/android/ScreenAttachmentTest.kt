package org.kairos.android

import org.junit.Assert.*
import org.junit.Test
import org.kairos.android.assistant.*

class ScreenAttachmentTest {
    @Test
    fun boundsPortraitLandscapeAndSmallImagesWithoutUpscaling() {
        assertEquals(576 to 1280, screenImageSize(1440, 3200))
        assertEquals(1280 to 720, screenImageSize(3840, 2160))
        assertEquals(320 to 240, screenImageSize(320, 240))
        assertEquals(1 to 1280, screenImageSize(1, 4000))
    }

    @Test
    fun nullScreenshotRequiresExplicitSettingsHintAndHideClearsIt() {
        val capture = ScreenCaptureState()
        capture.begin()
        capture.receive(null)
        assertFalse(capture.available)
        assertTrue(capture.attachments.isEmpty())
        assertFalse(capture.showSettingsHint)
        capture.attach()
        assertTrue(capture.showSettingsHint)
        capture.clear()
        assertFalse(capture.available)
        assertFalse(capture.showSettingsHint)
        assertTrue(capture.takeAttachments().isEmpty())
        capture.receive(null) // Late delivery after hide is ignored.
        assertFalse(capture.available)
        capture.begin()
        capture.receive(null)
        assertFalse(capture.showSettingsHint)
    }
}
