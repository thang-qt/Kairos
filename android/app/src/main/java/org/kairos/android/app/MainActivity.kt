package org.kairos.android.app

import android.content.*
import android.os.*
import android.util.Log
import android.view.ViewTreeObserver
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.runtime.*
import androidx.compose.ui.graphics.toArgb
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.createSavedStateHandle
import androidx.lifecycle.viewmodel.CreationExtras
import org.kairos.android.assistant.openBrowser
import org.kairos.android.chat.ChatViewModel
import org.kairos.android.transcript.TranscriptTheme
import org.kairos.android.ui.*
import org.kairos.android.ui.theme.*

class MainActivity : ComponentActivity() {
    companion object {
        const val SESSION_EXTRA = "kairos.sessionId"
    }

    private lateinit var chat: ChatViewModel
    private lateinit var app: AppContainer

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        app = (application as KairosApplication).container
        chat =
            ViewModelProvider(
                this,
                object : ViewModelProvider.Factory {
                    override fun <T : ViewModel> create(
                        modelClass: Class<T>,
                        extras: CreationExtras,
                    ): T {
                        @Suppress("UNCHECKED_CAST")
                        return ChatViewModel(app, extras.createSavedStateHandle()) as T
                    }
                },
            )[ChatViewModel::class.java]
        // Navigation Compose restores its own back stack. Only fresh intents override it.
        if (savedInstanceState == null && intent.hasExtra(SESSION_EXTRA))
            chat.openIntent(intent.getStringExtra(SESSION_EXTRA))
        val bridge = app.bridge
        bridge.webView.setBackgroundColor(app.preferences.colors.surface.toArgb())
        bridge.context.baseContext = this
        bridge.externalLink = { openBrowser(this, it) }
        enableEdgeToEdge()
        val root = window.decorView
        var reported = false
        root.viewTreeObserver.addOnDrawListener(
            object : ViewTreeObserver.OnDrawListener {
                override fun onDraw() {
                    if (reported) return
                    reported = true
                    root.post {
                        root.viewTreeObserver.removeOnDrawListener(this)
                        Log.i(
                            "KairosPerf",
                            "Process to first frame: ${SystemClock.uptimeMillis() - Process.getStartUptimeMillis()}ms",
                        )
                        reportFullyDrawn()
                    }
                }
            }
        )
        setContent {
            val darkSystem = isSystemInDarkTheme()
            SideEffect { app.preferences.systemDark = darkSystem }
            val dark = app.preferences.dark
            val colors = app.preferences.colors
            LaunchedEffect(dark, app.preferences.paletteIndex) {
                val style =
                    if (dark) SystemBarStyle.dark(android.graphics.Color.TRANSPARENT)
                    else
                        SystemBarStyle.light(
                            android.graphics.Color.TRANSPARENT,
                            android.graphics.Color.TRANSPARENT,
                        )
                enableEdgeToEdge(statusBarStyle = style, navigationBarStyle = style)
                bridge.webView.setBackgroundColor(colors.surface.toArgb())
                bridge.theme(
                    TranscriptTheme(
                        KairosPalettes[app.preferences.paletteIndex].name,
                        if (dark) "dark" else "light",
                    )
                )
            }
            KairosTheme(colors, dark) {
                KairosNavigation(chat, bridge, ::copy)
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        if (intent.hasExtra(SESSION_EXTRA))
            chat.openIntent(intent.getStringExtra(SESSION_EXTRA))
    }

    override fun onStart() {
        super.onStart()
        app.sessions.startSync()
        if (::chat.isInitialized && chat.screen == Screen.Chat) chat.conversation.resume()
    }

    override fun onStop() {
        if (::chat.isInitialized) chat.conversation.pause()
        app.sessions.stopSync()
        super.onStop()
    }

    private fun copy(text: String) {
        (getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager).setPrimaryClip(
            ClipData.newPlainText("Kairos message", text)
        )
    }

    override fun onDestroy() {
        val bridge = (application as KairosApplication).container.bridge
        bridge.externalLink = {}
        bridge.context.baseContext = applicationContext
        super.onDestroy()
    }
}
