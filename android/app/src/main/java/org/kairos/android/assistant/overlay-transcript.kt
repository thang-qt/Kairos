package org.kairos.android.assistant

import android.content.MutableContextWrapper
import android.view.ViewGroup
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.viewinterop.AndroidView
import androidx.webkit.WebViewFeature
import org.kairos.android.app.ChatApplication
import kotlinx.serialization.json.JsonObject
import org.kairos.android.transcript.TranscriptBridge
import org.kairos.android.transcript.TranscriptTheme
import org.kairos.android.transcript.TranscriptPresentation
import org.kairos.android.ui.theme.ColorPalettes

fun supportsOverlayWebView(): Boolean =
    WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER) &&
        WebViewFeature.isFeatureSupported(WebViewFeature.POST_WEB_MESSAGE)

/** Owns an isolated transcript: never reparent the full app's WebView into the assistant. */
@Composable
fun OverlayTranscript(
    app: ChatApplication,
    response: JsonObject,
    sessionId: String?,
    generation: Int,
    modifier: Modifier = Modifier,
    onActivity: (String) -> Unit,
    onLink: (String) -> Unit,
    onContentHeight: (Float) -> Unit,
) {
    val context = LocalContext.current
    val activity by rememberUpdatedState(onActivity)
    val link by rememberUpdatedState(onLink)
    val contentHeight by rememberUpdatedState(onContentHeight)
    val bridge = remember(generation, app.container.identityVersion) {
        TranscriptBridge(
            api = app.container.api,
            context = MutableContextWrapper(context),
            identityVersionProvider = { app.container.identityVersion },
        )
    }
    DisposableEffect(bridge) {
        bridge.onEvent = { event ->
            when (event.optString("type")) {
                "activity" -> activity(event.optString("id"))
                "content-size" -> event.optDouble("height", 0.0).toFloat()
                    .takeIf { it.isFinite() && it > 0f }?.let { contentHeight(it) }
            }
        }
        bridge.externalLink = { link(it) }
        onDispose { bridge.destroy() }
    }
    val background = app.theme.colors.surface.toArgb()
    val theme = TranscriptTheme(ColorPalettes[app.theme.paletteIndex].name, if (app.theme.dark) "dark" else "light")
    val labels = app.container.mcpLabels.labels
    SideEffect {
        bridge.webView.setBackgroundColor(background)
        bridge.theme(theme)
        bridge.toolLabels(labels)
        bridge.scrollPolicy("top")
        bridge.presentation(TranscriptPresentation(showModel = false, showActivity = false))
        bridge.insets(0f, 0f)
        bridge.render(sessionId, listOf(response))
    }
    key(bridge) {
        AndroidView(
            factory = { bridge.webView },
            modifier = modifier,
            onRelease = { webView -> (webView.parent as? ViewGroup)?.removeView(webView) },
        )
    }
}
