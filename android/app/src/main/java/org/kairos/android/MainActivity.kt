package org.kairos.android

import android.content.ActivityNotFoundException
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.os.Process
import android.os.SystemClock
import android.view.ViewTreeObserver
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.enableEdgeToEdge
import androidx.activity.SystemBarStyle
import androidx.activity.compose.setContent
import androidx.compose.runtime.LaunchedEffect
import org.kairos.android.ui.theme.KairosTheme

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val app = application as KairosApplication
        // Prewarm only the full app path, before any Compose frame.
        app.chat
        app.takeConversation()?.let(app.chat::loadConversation)
        app.bridge.context.baseContext = this
        app.bridge.externalLink = ::openLink
        enableEdgeToEdge()
        val root = window.decorView
        var reported = false
        val drawListener = object : ViewTreeObserver.OnDrawListener {
            override fun onDraw() {
                if (reported) return
                reported = true
                root.post {
                    root.viewTreeObserver.removeOnDrawListener(this)
                    app.perf.record("Process → Compose frame", (SystemClock.uptimeMillis() - Process.getStartUptimeMillis()).toDouble())
                    reportFullyDrawn()
                }
            }
        }
        root.viewTreeObserver.addOnDrawListener(drawListener)
        setContent {
            val dark = app.chat.dark
            LaunchedEffect(dark) {
                val style = if (dark) SystemBarStyle.dark(android.graphics.Color.TRANSPARENT)
                    else SystemBarStyle.light(android.graphics.Color.TRANSPARENT, android.graphics.Color.TRANSPARENT)
                enableEdgeToEdge(statusBarStyle = style, navigationBarStyle = style)
            }
            KairosTheme(app.chat.colors, dark) { PrototypeApp(app.chat, app.bridge, app.perf, ::copy) }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        val app = application as KairosApplication
        app.takeConversation()?.let(app.chat::loadConversation)
    }

    private fun openLink(href: String) {
        val uri = Uri.parse(href)
        if (uri.scheme !in listOf("https", "http")) return
        try { startActivity(Intent(Intent.ACTION_VIEW, uri)) }
        catch (_: ActivityNotFoundException) { Toast.makeText(this, "No browser installed", Toast.LENGTH_SHORT).show() }
    }

    private fun copy(text: String) {
        (getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager).setPrimaryClip(ClipData.newPlainText("Kairos message", text))
        Toast.makeText(this, "Copied", Toast.LENGTH_SHORT).show()
    }

    override fun onDestroy() {
        val bridge = (application as KairosApplication).bridge
        bridge.externalLink = {}
        bridge.context.baseContext = applicationContext
        super.onDestroy()
    }
}
