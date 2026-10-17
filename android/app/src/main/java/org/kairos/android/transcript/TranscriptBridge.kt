package org.kairos.android.transcript

import android.content.MutableContextWrapper
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.view.Choreographer
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.webkit.*
import okhttp3.Call
import java.io.ByteArrayInputStream
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.*
import org.json.JSONObject
import org.kairos.android.BuildConfig
import org.kairos.android.data.*
import java.net.URI
import java.util.concurrent.ConcurrentHashMap

/**
 * Offline WebView transcript. The page origin is pinned to appassets.androidplatform.net; the
 * only network it reaches is /api/assets/{id}, proxied here through the authenticated API so
 * asset-sourced history images render without ever exposing the bearer token to the page.
 */
class TranscriptBridge(
    private val api: KairosApi,
    val context: MutableContextWrapper,
    private val identityVersionProvider: () -> Long = { 0L },
    private val authIdentityProvider: () -> String = {
        api.server.url + "\n" + api.tokens.token.orEmpty()
    },
) {
    companion object {
        const val ORIGIN = "https://appassets.androidplatform.net"
        const val PAGE = "$ORIGIN/assets/transcript/transcript.html"
        private const val MAX_ASSET_BYTES = 8L * 1024 * 1024
    }

    val webView: WebView
    var onEvent: (JSONObject) -> Unit = {}
    var externalLink: (String) -> Unit = {}
    var horizontalActive = false
    var touchDecisionReady = false
    var touchDirectionReady = false
    val supported =
        WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER) &&
            WebViewFeature.isFeatureSupported(WebViewFeature.POST_WEB_MESSAGE)
    @Volatile private var destroyed = false
    val isDestroyed: Boolean get() = destroyed
    val identityVersion: Long = identityVersionProvider()
    private val authIdentity = authIdentityProvider()
    private var presentation = TranscriptPresentation()
    private var scrollPolicy = "bottom"
    private var ready = false
    private var pendingFrame = false
    private var forceInit = true
    private var toolLabels: Map<String, String> = emptyMap()
    private var sessionId: String? = null
    private var messages: List<JsonObject> = emptyList()
    private var sent: List<JsonObject> = emptyList()
    private var theme = TranscriptTheme("default", "light")
    private var insets = TranscriptInsets(72f, 120f)
    private val assetCalls = ConcurrentHashMap.newKeySet<Call>()
    private val mainHandler = Handler(Looper.getMainLooper())
    private val assetHost = URI(ORIGIN).host

    init {
        webView = WebView(context)
        webView.settings.apply {
            javaScriptEnabled = true
            allowFileAccess = false
            allowContentAccess = false
            domStorageEnabled = false
            cacheMode = android.webkit.WebSettings.LOAD_NO_CACHE
            javaScriptCanOpenWindowsAutomatically = false
            setSupportMultipleWindows(false)
            mixedContentMode = android.webkit.WebSettings.MIXED_CONTENT_NEVER_ALLOW
        }
        webView.isVerticalScrollBarEnabled = false
        webView.isHorizontalScrollBarEnabled = false
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG)
        val assets =
            WebViewAssetLoader.Builder()
                .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(context))
                .build()
        webView.webViewClient =
            object : WebViewClient() {
                override fun shouldInterceptRequest(
                    view: WebView,
                    request: WebResourceRequest,
                ): WebResourceResponse {
                    val url = request.url
                    if (
                        url.host == assetHost &&
                            url.pathSegments.size == 3 &&
                            url.pathSegments[0] == "api" &&
                            url.pathSegments[1] == "assets"
                    )
                        return if (destroyed) emptyResponse() else assetResponse(url.pathSegments[2]) ?: emptyResponse()
                    return assets.shouldInterceptRequest(request.url) ?: emptyResponse()
                }

                override fun shouldOverrideUrlLoading(
                    view: WebView,
                    request: WebResourceRequest,
                ): Boolean {
                    if (!destroyed && isCurrentIdentity()) externalLink(request.url.toString())
                    return true
                }
            }
        if (supported)
            WebViewCompat.addWebMessageListener(webView, "kairosNative", setOf(ORIGIN)) {
                _,
                message,
                origin,
                mainFrame,
                _ ->
                if (!destroyed && isCurrentIdentity() && mainFrame && origin.toString() == ORIGIN)
                    runCatching { JSONObject(message.data ?: "{}") }
                        .onSuccess { event ->
                            if (event.optString("type") == "ready") {
                                ready = true
                                forceInit = true
                                schedule()
                            }
                            if (event.optString("type") == "hscroll") {
                                horizontalActive = event.optBoolean("active")
                                when (event.optString("phase")) {
                                    "start" -> touchDecisionReady = true
                                    "move" -> touchDirectionReady = true
                                }
                            }
                            if (event.optString("type") == "link")
                                externalLink(event.optString("href"))
                            onEvent(event)
                        }
            }
        webView.loadUrl(PAGE)
    }

    private fun emptyResponse(): WebResourceResponse =
        WebResourceResponse("text/plain", "UTF-8", ByteArrayInputStream(ByteArray(0)))

    private fun assetResponse(assetId: String): WebResourceResponse? {
        if (!isCurrentIdentity()) return null
        val call = api.client.newCall(api.request("/api/assets/" + api.encodePath(assetId)))
        assetCalls.add(call)
        try {
            if (destroyed || !isCurrentIdentity()) return null
            return runCatching {
                call.execute().use { response ->
                    if (destroyed || !isCurrentIdentity() || !response.isSuccessful) return@use null
                    val contentType = response.header("Content-Type") ?: "application/octet-stream"
                    val bytes = readBoundedAsset(response, MAX_ASSET_BYTES.toInt()) ?: return@use null
                    if (destroyed || !isCurrentIdentity()) return@use null
                    WebResourceResponse(contentType, null, ByteArrayInputStream(bytes)).apply {
                        responseHeaders = mapOf("Cache-Control" to "no-store")
                    }
                }
            }.getOrNull()
        } finally {
            assetCalls.remove(call)
        }
    }

    fun render(id: String?, turns: List<JsonObject>) {
        if (!isCurrentIdentity()) {
            destroy()
            return
        }
        if (destroyed) return
        if (sessionId != id) {
            sessionId = id
            forceInit = true
        }
        messages = turns
        schedule()
    }

    fun theme(value: TranscriptTheme) {
        if (destroyed || !isCurrentIdentity()) return
        theme = value
        if (ready)
            send(
                buildJsonObject {
                        put("type", "theme")
                        put("palette", value.palette)
                        put("mode", value.mode)
                    }
                    .toString()
            )
    }

    fun presentation(value: TranscriptPresentation) {
        if (presentation == value) return
        presentation = value
        if (ready && !destroyed) send(buildJsonObject {
            put("type", "presentation")
            put("showModel", value.showModel)
            put("showActivity", value.showActivity)
        }.toString())
    }

    fun scrollPolicy(value: String) {
        require(value == "top" || value == "bottom")
        if (scrollPolicy == value) return
        scrollPolicy = value
        if (ready && !destroyed) send(buildJsonObject {
            put("type", "scroll-policy")
            put("policy", value)
        }.toString())
    }

    fun toolLabels(value: Map<String, String>) {
        if (destroyed || !isCurrentIdentity()) return
        if (toolLabels == value) return
        toolLabels = value
        if (ready && !destroyed) send(buildJsonObject {
            put("type", "tool-labels")
            put("labels", JsonObject(value.mapValues { JsonPrimitive(it.value) }))
        }.toString())
    }

    fun insets(top: Float, bottom: Float) {
        if (destroyed || !isCurrentIdentity()) return
        if (insets == TranscriptInsets(top, bottom)) return
        insets = TranscriptInsets(top, bottom)
        if (ready)
            send(
                buildJsonObject {
                        put("type", "insets")
                        put("top", top)
                        put("bottom", bottom)
                    }
                    .toString()
            )
    }

    fun destroy() {
        if (destroyed) return
        destroyed = true
        onEvent = {}
        externalLink = {}
        messages = emptyList()
        sent = emptyList()
        assetCalls.forEach(Call::cancel)
        assetCalls.clear()
        webView.stopLoading()
        (webView.parent as? android.view.ViewGroup)?.removeView(webView)
        webView.destroy()
    }

    private fun schedule() {
        if (destroyed || !isCurrentIdentity() || !ready || pendingFrame) return
        pendingFrame = true
        // At most one upsert per affected message per display frame. User image parts are never
        // retransmitted for assistant deltas.
        Choreographer.getInstance().postFrameCallback {
            pendingFrame = false
            if (destroyed || !isCurrentIdentity()) return@postFrameCallback
            val ids = messages.map { it.id }.toSet()
            val priorIds = sent.map { it.id }.toSet()
            val expectedOrder =
                sent.filter { it.id in ids }.map { it.id } +
                    messages.filter { it.id !in priorIds }.map { it.id }
            if (forceInit) {
                send(
                    transcriptJson.encodeToString(
                        TranscriptInit(
                            theme = theme,
                            insets = insets,
                            messages = messages,
                            sessionId = sessionId,
                            toolLabels = toolLabels,
                            scrollPolicy = scrollPolicy,
                            presentation = presentation,
                        )
                    )
                )
                forceInit = false
            } else if (expectedOrder != messages.map { it.id }) {
                // An optimistic id can become authoritative after an assistant has already arrived.
                // Rebuild only the reordered suffix, preserving earlier rows and their large
                // images.
                val prefix =
                    sent.zip(messages).takeWhile { (before, after) -> before.id == after.id }.size
                for (removed in sent.drop(prefix)) send(
                    transcriptJson.encodeToString(TranscriptRemove(id = removed.id))
                )
                val previous = sent.take(prefix).associateBy { it.id }
                for (turn in messages.take(prefix)) if (previous[turn.id] != turn)
                    send(transcriptJson.encodeToString(TranscriptUpsert(message = turn)))
                for (turn in messages.drop(prefix)) send(
                    transcriptJson.encodeToString(TranscriptUpsert(message = turn))
                )
            } else {
                for (removed in sent.filter { it.id !in ids }) send(
                    transcriptJson.encodeToString(TranscriptRemove(id = removed.id))
                )
                val previous = sent.associateBy { it.id }
                for (turn in messages) if (previous[turn.id] != turn)
                    send(transcriptJson.encodeToString(TranscriptUpsert(message = turn)))
            }
            sent = messages
        }
    }

    private fun send(json: String) {
        if (!destroyed && isCurrentIdentity() && supported)
            WebViewCompat.postWebMessage(webView, WebMessageCompat(json), Uri.parse(ORIGIN))
    }

    private fun isCurrentIdentity(): Boolean {
        val current =
            identityVersionProvider() == identityVersion && authIdentityProvider() == authIdentity
        if (!current && !destroyed) {
            if (Looper.myLooper() == Looper.getMainLooper()) destroy()
            else mainHandler.post { destroy() }
        }
        return current
    }

}
