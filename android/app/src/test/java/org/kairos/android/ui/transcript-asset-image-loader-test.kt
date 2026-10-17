package org.kairos.android.ui

import org.junit.Assert.assertEquals
import org.junit.Test

class TranscriptAssetImageLoaderTest {
    @Test
    fun sampleSizeKeepsLargeImagesNearTheDecodeLimit() {
        assertEquals(8, transcriptImageSampleSize(10_000, 7_000))
        assertEquals(1, transcriptImageSampleSize(1_280, 720))
        assertEquals(1, transcriptImageSampleSize(0, 720))
        assertEquals(1 shl 30, transcriptImageSampleSize(Int.MAX_VALUE, 1, 1))
    }
}
