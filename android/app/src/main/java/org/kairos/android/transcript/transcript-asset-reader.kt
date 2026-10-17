package org.kairos.android.transcript

import java.io.ByteArrayOutputStream
import java.io.InputStream
import okhttp3.Response

/** Read at most [maxBytes] plus one sentinel byte, returning null when the body is oversized. */
internal fun readBoundedAsset(response: Response, maxBytes: Int): ByteArray? =
    response.use {
        require(maxBytes >= 0 && maxBytes < Int.MAX_VALUE)
        val body = response.body ?: return@use null
        if (body.contentLength() > maxBytes) return@use null
        readBoundedAsset(body.byteStream(), maxBytes)
    }

internal fun readBoundedAsset(input: InputStream, maxBytes: Int): ByteArray? {
    require(maxBytes >= 0 && maxBytes < Int.MAX_VALUE)
    val output = ByteArrayOutputStream(minOf(maxBytes, BUFFER_SIZE))
    val buffer = ByteArray(minOf(BUFFER_SIZE, maxBytes + 1))
    while (true) {
        val remaining = maxBytes + 1 - output.size()
        if (remaining <= 0) return null
        val count = input.read(buffer, 0, minOf(buffer.size, remaining))
        if (count < 0) return output.toByteArray()
        if (count == 0) {
            val next = input.read()
            if (next < 0) return output.toByteArray()
            output.write(next)
        } else {
            output.write(buffer, 0, count)
        }
        if (output.size() > maxBytes) return null
    }
}

private const val BUFFER_SIZE = 8 * 1024
