package org.kairos.android.transcript

import java.io.ByteArrayInputStream
import okhttp3.Protocol
import okhttp3.Request
import okhttp3.Response
import okhttp3.ResponseBody
import okio.Buffer
import okio.BufferedSource
import okio.ForwardingSource
import okio.buffer
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class TranscriptAssetReaderTest {
    @Test
    fun acceptsShortUnknownLengthBodyAndClosesResponse() {
        val body = TrackingBody("small image".encodeToByteArray())

        val bytes = readBoundedAsset(response(body), 64)

        assertArrayEquals("small image".encodeToByteArray(), bytes)
        assertTrue(body.closed)
    }

    @Test
    fun acceptsChunkedBodyAtLimitAndRejectsOversizedUnknownLengthBody() {
        val exact = "12345".encodeToByteArray()
        assertArrayEquals(exact, readBoundedAsset(ChunkedInputStream(exact), 5))

        val body = TrackingBody("123456".encodeToByteArray())
        assertNull(readBoundedAsset(response(body), 5))
        assertTrue(body.closed)
    }

    @Test
    fun shortReadsDoNotLookLikeEndOfStream() {
        val body = "short reads".encodeToByteArray()
        val input = ChunkedInputStream(body)

        assertArrayEquals(body, readBoundedAsset(input, body.size))
        assertFalse(input.failed)
    }

    private fun response(body: ResponseBody): Response =
        Response.Builder()
            .request(Request.Builder().url("https://kairos.test/api/assets/item").build())
            .protocol(Protocol.HTTP_1_1)
            .code(200)
            .message("OK")
            .body(body)
            .build()

    private class TrackingBody(private val bytes: ByteArray) : ResponseBody() {
        var closed = false
        private val bufferedSource =
            object : ForwardingSource(Buffer().write(bytes)) {
                override fun close() {
                    closed = true
                    super.close()
                }
            }.buffer()
        override fun contentLength(): Long = -1 // Exercise chunked/unknown-length handling.
        override fun contentType() = null
        override fun source(): BufferedSource = bufferedSource
    }

    private class ChunkedInputStream(bytes: ByteArray) : ByteArrayInputStream(bytes) {
        var failed = false
        override fun read(buffer: ByteArray, offset: Int, length: Int): Int =
            super.read(buffer, offset, minOf(length, 2)).also { if (it == 0) failed = true }
    }
}
