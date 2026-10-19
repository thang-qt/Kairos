package org.kairos.android.ui

import android.graphics.BitmapFactory
import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.sync.withPermit
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.kairos.android.assistant.ScreenAttachment
import org.kairos.android.data.BackendApi
import org.kairos.android.transcript.readBoundedAsset
import okhttp3.Call
import okhttp3.Callback
import okhttp3.Response
import java.io.IOException
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

internal fun transcriptImageSampleSize(width: Int, height: Int, maxEdge: Int = 1280): Int {
    if (width <= 0 || height <= 0 || maxEdge <= 0) return 1
    var sample = 1
    while (maxOf(width, height).toLong() / sample > maxEdge) {
        if (sample > Int.MAX_VALUE / 2) return sample
        sample *= 2
    }
    return sample
}

/** Bounds image requests and decoded memory for native transcript rows. */
internal class TranscriptAssetImageLoader(
    private val api: BackendApi,
    private val identityVersion: Long = 0L,
    private val identityVersionProvider: () -> Long = { identityVersion },
) {
    private val cache = LinkedHashMap<String, ScreenAttachment>(8, 0.75f, true)
    private var cacheIdentity: String? = identityKey()

    suspend fun loadAll(ids: List<String>): List<ScreenAttachment> = buildList {
        for (id in ids.distinct()) {
            val image = requests.withPermit { load(id) }
            if (image != null) add(image)
        }
    }

    private suspend fun load(id: String): ScreenAttachment? = withContext(Dispatchers.IO) io@{
        val identity = identityKey() ?: return@io null
        synchronized(cache) {
            if (cacheIdentity != identity) {
                cache.clear()
                cacheIdentity = identity
            }
            cache[id]?.let { return@io it }
        }
        try {
            val bytes = fetch(id) ?: return@io null
            if (identity != identityKey()) return@io null
            val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
            BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
            if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return@io null
            val options = BitmapFactory.Options().apply {
                inSampleSize = transcriptImageSampleSize(bounds.outWidth, bounds.outHeight)
                inPreferredConfig = android.graphics.Bitmap.Config.RGB_565
            }
            val bitmap = BitmapFactory.decodeByteArray(bytes, 0, bytes.size, options) ?: return@io null
            val image = try {
                ScreenAttachment.fromBitmap(bitmap, name = "Image")
            } finally {
                bitmap.recycle()
            }
            synchronized(cache) {
                if (identity != identityKey()) return@io null
                cache[id] = image
                while (cache.size > MAX_CACHED_IMAGES) {
                    val oldest = cache.entries.iterator()
                    if (!oldest.hasNext()) break
                    oldest.next()
                    oldest.remove()
                }
            }
            image
        } catch (_: IOException) {
            null
        } catch (_: IllegalArgumentException) {
            null
        }
    }

    private suspend fun fetch(id: String): ByteArray? = suspendCancellableCoroutine { continuation ->
        val call = api.client.newCall(api.request("/api/assets/" + api.encodePath(id)))
        continuation.invokeOnCancellation { call.cancel() }
        call.enqueue(
            object : Callback {
                override fun onFailure(call: Call, e: IOException) {
                    if (continuation.isActive) continuation.resumeWithException(e)
                }

                override fun onResponse(call: Call, response: Response) {
                    response.use {
                        try {
                            val bytes =
                                if (response.isSuccessful && continuation.isActive)
                                    readBoundedAsset(response, MAX_ASSET_BYTES.toInt())
                                else null
                            if (continuation.isActive) continuation.resume(bytes)
                        } catch (error: Exception) {
                            if (continuation.isActive) continuation.resumeWithException(error)
                        }
                    }
                }
            }
        )
    }

    private fun identityKey(): String? {
        if (identityVersionProvider() != identityVersion) return null
        return api.server.url + "\n" + api.tokens.token.orEmpty() + "\n" + identityVersion
    }

    private companion object {
        const val MAX_ASSET_BYTES = 8L * 1024 * 1024
        const val MAX_CACHED_IMAGES = 8
        val requests = Semaphore(2)
    }
}
