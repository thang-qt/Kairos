package org.kairos.android

import android.os.Build
import android.os.Bundle
import android.view.KeyEvent
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import org.kairos.android.markdown.MathRenderer

class OverlayPreviewActivity : ComponentActivity() {
    private val backCallback = if (Build.VERSION.SDK_INT >= 33) android.window.OnBackInvokedCallback { finish() } else null
    private val screenCapture = ScreenCaptureState()
    private lateinit var conversation: OverlayConversation
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        if (Build.VERSION.SDK_INT >= 33 && backCallback != null) window.onBackInvokedDispatcher.registerOnBackInvokedCallback(android.window.OnBackInvokedDispatcher.PRIORITY_OVERLAY, backCallback)
        val app = application as KairosApplication
        MathRenderer.prewarm()
        conversation = OverlayConversation(app.perf, "Preview")
        conversation.show()
        screenCapture.begin()
        screenCapture.receive(previewScreen(app))
        setContent {
            BackHandler { finish() }
            AssistantOverlay(app, conversation, screenCapture, onDismiss = { finish() }, onOpenApp = { messages ->
                if (messages.isNotEmpty()) app.pendingConversation = messages
                startActivity(mainAppIntent(this), openAppOptions(this))
                finish()
            })
        }
    }
    override fun onRestart() {
        super.onRestart()
        conversation.show()
        screenCapture.begin()
        screenCapture.receive(previewScreen(application as KairosApplication))
    }
    override fun onKeyDown(keyCode: Int, event: KeyEvent): Boolean {
        if (keyCode == KeyEvent.KEYCODE_ESCAPE) { finish(); return true }
        return super.onKeyDown(keyCode, event)
    }
    override fun onStop() { screenCapture.clear(); conversation.hide(); super.onStop() }
    override fun onDestroy() {
        if (Build.VERSION.SDK_INT >= 33 && backCallback != null) window.onBackInvokedDispatcher.unregisterOnBackInvokedCallback(backCallback)
        screenCapture.clear()
        conversation.destroy()
        super.onDestroy()
    }
}
