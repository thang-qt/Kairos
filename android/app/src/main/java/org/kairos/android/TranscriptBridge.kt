package org.kairos.android

import android.content.MutableContextWrapper
import android.graphics.Color
import android.net.Uri
import android.os.SystemClock
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.webkit.WebMessageCompat
import androidx.webkit.WebViewAssetLoader
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import org.json.JSONObject
import java.io.ByteArrayInputStream

class TranscriptBridge(val context: MutableContextWrapper, val perf: Performance, val screenImages: MemoryScreenImages) {
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
    val supported = WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER) &&
        WebViewFeature.isFeatureSupported(WebViewFeature.POST_WEB_MESSAGE)
    private val pageStart: Long

    init {
        val creationStart = SystemClock.uptimeMillis()
        webView = WebView(context)
        webView.setBackgroundColor(Color.WHITE)
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
        val assets = WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(context))
            .addPathHandler("/screens/") { path ->
                val image = screenImages.find(path)
                WebResourceResponse("image/jpeg", null,
                    if (image != null) 200 else 404, if (image != null) "OK" else "Not Found",
                    mapOf("Cache-Control" to "no-store", "Pragma" to "no-cache", "X-Content-Type-Options" to "nosniff"),
                    image?.openStream() ?: ByteArrayInputStream(ByteArray(0)))
            }.build()
        webView.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse {
                return assets.shouldInterceptRequest(request.url)
                    ?: WebResourceResponse("text/plain", "UTF-8", ByteArrayInputStream(ByteArray(0)))
            }
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                externalLink(request.url.toString())
                return true
            }
        }
        if (supported) {
            WebViewCompat.addWebMessageListener(webView, "kairosNative", setOf(ORIGIN)) { _, message, origin, mainFrame, _ ->
                if (mainFrame && origin.toString() == ORIGIN) {
                    runCatching { JSONObject(message.data ?: "{}") }.onSuccess { event ->
                        if (event.optString("type") == "hscroll") {
                            horizontalActive = event.optBoolean("active")
                            when (event.optString("phase")) {
                                "start" -> touchDecisionReady = true
                                "move" -> touchDirectionReady = true
                            }
                        }
                        onEvent(event)
                    }
                }
            }
        }
        perf.record("WebView creation", (SystemClock.uptimeMillis() - creationStart).toDouble())
        pageStart = SystemClock.uptimeMillis()
        webView.loadUrl(PAGE)
    }

    fun pageReady(firstPaintMs: Double) {
        perf.record("Page ready (native)", (SystemClock.uptimeMillis() - pageStart).toDouble())
        perf.record("Page first paint (web)", firstPaintMs)
    }

    fun send(command: JSONObject, timingLabel: String? = null) {
        if (!supported) return
        if (timingLabel != null) command.put("trace", perf.trace(timingLabel))
        WebViewCompat.postWebMessage(webView, WebMessageCompat(command.toString()), Uri.parse(ORIGIN))
    }
}
