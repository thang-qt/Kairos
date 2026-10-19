package org.kairos.android.assistant

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.ImageDecoder
import android.net.Uri
import android.os.Build
import android.util.Base64
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.util.UUID
import kotlin.math.roundToInt
import org.kairos.android.data.AttachmentPayload

fun screenImageSize(width: Int, height: Int, maxEdge: Int = 1280): Pair<Int, Int> {
    require(width > 0 && height > 0 && maxEdge > 0)
    val scale = minOf(1.0, maxEdge.toDouble() / maxOf(width, height))
    return maxOf(1, (width * scale).roundToInt()) to maxOf(1, (height * scale).roundToInt())
}

/**
 * Explicitly selected, reduced image bytes, owned by the draft. Never logged or written to disk.
 */
class ScreenAttachment
internal constructor(
    val id: String,
    val width: Int,
    val height: Int,
    private val encoded: ByteArray,
    val mimeType: String = "image/jpeg",
    val name: String = "Screen",
) {
    fun payload() = AttachmentPayload(mimeType, Base64.encodeToString(encoded, Base64.NO_WRAP))

    fun openStream() = ByteArrayInputStream(encoded)

    fun decode(): Bitmap = checkNotNull(BitmapFactory.decodeByteArray(encoded, 0, encoded.size))

    companion object {
        fun fromUri(context: Context, uri: Uri): ScreenAttachment {
            val resolver = context.contentResolver
            val png = resolver.getType(uri) == "image/png"
            val bitmap =
                if (Build.VERSION.SDK_INT >= 28) {
                    ImageDecoder.decodeBitmap(ImageDecoder.createSource(resolver, uri)) {
                        decoder,
                        info,
                        _ ->
                        val (width, height) = screenImageSize(info.size.width, info.size.height)
                        decoder.setTargetSize(width, height)
                        decoder.allocator = ImageDecoder.ALLOCATOR_SOFTWARE
                    }
                } else {
                    val options = BitmapFactory.Options().apply { inJustDecodeBounds = true }
                    resolver.openInputStream(uri).use {
                        BitmapFactory.decodeStream(it, null, options)
                    }
                    require(options.outWidth > 0 && options.outHeight > 0) {
                        "Unable to read this image."
                    }
                    options.inSampleSize = 1
                    while (
                        maxOf(options.outWidth, options.outHeight) / options.inSampleSize > 2560
                    ) options.inSampleSize *= 2
                    options.inJustDecodeBounds = false
                    resolver.openInputStream(uri).use {
                        checkNotNull(BitmapFactory.decodeStream(it, null, options)) {
                            "Unable to read this image."
                        }
                    }
                }
            try {
                return fromBitmap(bitmap, png, "Image")
            } finally {
                bitmap.recycle()
            }
        }

        fun fromBitmap(
            source: Bitmap,
            png: Boolean = false,
            name: String = "Screen",
        ): ScreenAttachment {
            val (width, height) = screenImageSize(source.width, source.height)
            val software =
                if (source.config == Bitmap.Config.HARDWARE)
                    checkNotNull(source.copy(Bitmap.Config.ARGB_8888, false))
                else source
            val reduced = Bitmap.createScaledBitmap(software, width, height, true)
            try {
                val bytes = ByteArrayOutputStream()
                var quality = 75
                val format = if (png) Bitmap.CompressFormat.PNG else Bitmap.CompressFormat.JPEG
                do {
                    bytes.reset()
                    check(reduced.compress(format, quality, bytes))
                    if (png || bytes.size() <= 300 * 1024 || quality <= 30) break
                    quality -= 10
                } while (true)
                return ScreenAttachment(
                    UUID.randomUUID().toString(),
                    width,
                    height,
                    bytes.toByteArray(),
                    if (png) "image/png" else "image/jpeg",
                    name,
                )
            } finally {
                if (reduced !== software) reduced.recycle()
                if (software !== source) software.recycle()
            }
        }
    }
}

/** Owned by one session/preview. The original screenshot is never exposed to the app store. */
class ScreenCaptureState {
    private var source: Bitmap? = null
    private var accepting = true
    private var prepared = false
    var available by mutableStateOf(false)
        private set

    var attachments by mutableStateOf<List<ScreenAttachment>>(emptyList())
        private set

    var showSettingsHint by mutableStateOf(false)
        private set

    fun begin() {
        if (prepared) clear()
        prepared = true
        accepting = true
    }

    fun receive(bitmap: Bitmap?) {
        if (!accepting) return // Discard delivery after hide/destroy; do not retain or log it.
        source = bitmap?.takeUnless { it.isRecycled }
        available = source != null
        if (available) showSettingsHint = false
        // Late arrival updates availability only. It NEVER automatically attaches.
    }

    fun attach() {
        val bitmap = source
        if (bitmap == null || bitmap.isRecycled) {
            showSettingsHint = true
            return
        }
        receiveAttachment(ScreenAttachment.fromBitmap(bitmap))
        showSettingsHint = false
    }

    fun remove(attachment: ScreenAttachment) {
        attachments = attachments.filterNot { it.id == attachment.id }
    }

    fun takeAttachments(): List<ScreenAttachment> = attachments.also { attachments = emptyList() }

    fun receiveAttachment(attachment: ScreenAttachment) {
        if (!accepting) return // Same retention rules as system screenshots.
        attachments = attachments + attachment
        showSettingsHint = false
    }

    fun clear() {
        accepting = false
        source = null // Callback bitmap ownership is unspecified; let GC release it, not recycle.
        attachments = emptyList()
        available = false
        showSettingsHint = false
    }
}
