package org.kairos.android.transcript

import android.content.MutableContextWrapper
import android.net.Uri
import android.view.Choreographer
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.webkit.*
import java.io.ByteArrayInputStream
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.*
import org.json.JSONObject
import org.kairos.android.BuildConfig
import org.kairos.android.data.*
import java.net.URI

/**
 * Offline WebView transcript. The page origin is pinned to appassets.androidplatform.net; the
 * only network it reaches is /api/assets/{id}, proxied here through the authenticated API so
 * asset-sourced history images render without ever exposing the bearer token to the page.
 */
class TranscriptBridge(private val api: KairosApi, val context: MutableContextWrapper) {
    companion object {
        const val ORIGIN = "https://appassets.androidplatform.net"
        const val PAGE = "$ORIGIN/assets/transcript/transcript.html"
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
    private var ready = false
    private var pendingFrame = false
    private var forceInit = true
    private var sessionId: String? = null
    private var messages: List<JsonObject> = emptyList()
    private var sent: List<JsonObject> = emptyList()
    private var theme = TranscriptTheme("default", "light")
    private var insets = TranscriptInsets(72f, 120f)
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
                        return assetResponse(url.pathSegments[2]) ?: emptyResponse()
                    return assets.shouldInterceptRequest(request.url) ?: emptyResponse()
                }

                override fun shouldOverrideUrlLoading(
                    view: WebView,
                    request: WebResourceRequest,
                ): Boolean {
                    externalLink(request.url.toString())
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
                if (mainFrame && origin.toString() == ORIGIN)
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

    private fun assetResponse(assetId: String): WebResourceResponse? =
        runCatching {
            api.asset(assetId).use { response ->
                val body = response.body ?: return@runCatching null
                if (!response.isSuccessful) return@runCatching null
                // Assets are small images; read fully and close the connection before handing
                // the bytes to the WebView. The server's no-store directive is preserved.
                WebResourceResponse(
                    response.header("Content-Type") ?: "application/octet-stream",
                    null,
                    ByteArrayInputStream(body.bytes()),
                ).apply {
                    responseHeaders = mapOf("Cache-Control" to "no-store")
                }
            }
        }.getOrNull()

    fun render(id: String?, turns: List<JsonObject>) {
        if (sessionId != id) {
            sessionId = id
            forceInit = true
        }
        messages = turns
        schedule()
    }

    fun theme(value: TranscriptTheme) {
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

    fun insets(top: Float, bottom: Float) {
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

    private fun schedule() {
        if (!ready || pendingFrame) return
        pendingFrame = true
        // At most one upsert per affected message per display frame. User image parts are never
        // retransmitted for assistant deltas.
        Choreographer.getInstance().postFrameCallback {
            pendingFrame = false
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
                    wireJson.encodeToString(TranscriptRemove(id = removed.id))
                )
                val previous = sent.take(prefix).associateBy { it.id }
                for (turn in messages.take(prefix)) if (previous[turn.id] != turn)
                    send(wireJson.encodeToString(TranscriptUpsert(message = turn)))
                for (turn in messages.drop(prefix)) send(
                    wireJson.encodeToString(TranscriptUpsert(message = turn))
                )
            } else {
                for (removed in sent.filter { it.id !in ids }) send(
                    wireJson.encodeToString(TranscriptRemove(id = removed.id))
                )
                val previous = sent.associateBy { it.id }
                for (turn in messages) if (previous[turn.id] != turn)
                    send(wireJson.encodeToString(TranscriptUpsert(message = turn)))
            }
            sent = messages
        }
    }

    private fun send(json: String) {
        if (supported)
            WebViewCompat.postWebMessage(webView, WebMessageCompat(json), Uri.parse(ORIGIN))
    }
}
