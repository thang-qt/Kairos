package org.kairos.android

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import org.json.JSONObject
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.util.UUID
import kotlin.math.roundToInt

fun screenImageSize(width: Int, height: Int, maxEdge: Int = 1080): Pair<Int, Int> {
    require(width > 0 && height > 0 && maxEdge > 0)
    val scale = minOf(1.0, maxEdge.toDouble() / maxOf(width, height))
    return maxOf(1, (width * scale).roundToInt()) to maxOf(1, (height * scale).roundToInt())
}

/** Only explicitly attached, reduced JPEG bytes. No file, bitmap, Binder payload or disk cache. */
class ScreenAttachment internal constructor(
    val id: String,
    val width: Int,
    val height: Int,
    private val encoded: ByteArray,
) {
    val url get() = "https://appassets.androidplatform.net/screens/$id.jpg"
    fun json() = JSONObject().put("url", url).put("width", width).put("height", height)
    fun openStream() = ByteArrayInputStream(encoded)
    fun decode(): Bitmap = checkNotNull(BitmapFactory.decodeByteArray(encoded, 0, encoded.size))
    fun copyForHandoff() = ScreenAttachment(id, width, height, encoded.copyOf())

    companion object {
        fun fromBitmap(source: Bitmap): ScreenAttachment {
            val (width, height) = screenImageSize(source.width, source.height)
            // Hardware screenshots need a software copy for CPU scaling/compression.
            val software = if (source.config == Bitmap.Config.HARDWARE) checkNotNull(source.copy(Bitmap.Config.ARGB_8888, false)) else source
            val reduced = Bitmap.createScaledBitmap(software, width, height, true)
            try {
                val bytes = ByteArrayOutputStream()
                check(reduced.compress(Bitmap.CompressFormat.JPEG, 85, bytes))
                return ScreenAttachment(UUID.randomUUID().toString(), width, height, bytes.toByteArray())
            } finally {
                // Recycle only our temporary allocations, never the framework-owned source.
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
    var attached by mutableStateOf<ScreenAttachment?>(null)
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
        if (bitmap == null || bitmap.isRecycled) { showSettingsHint = true; return }
        attached = ScreenAttachment.fromBitmap(bitmap)
        showSettingsHint = false
    }
    fun remove() { attached = null }
    fun takeAttachment(): ScreenAttachment? = attached.also { attached = null }
    fun clear() {
        accepting = false
        source = null // Callback bitmap ownership is unspecified; let GC release it, not recycle.
        attached = null
        available = false
        showSettingsHint = false
    }
}

/** Worker-thread reads from WebView; atomically replace the images with the current conversation. */
class MemoryScreenImages {
    @Volatile private var images: Map<String, ScreenAttachment> = emptyMap()
    fun replace(messages: List<ChatMessage>) {
        images = messages.mapNotNull { it.attachment }.associateBy { "${it.id}.jpg" }
    }
    fun find(path: String): ScreenAttachment? = images[path]
    fun clear() { images = emptyMap() }
}
