package org.kairos.android.app

import android.content.*
import android.os.*
import android.util.Log
import android.view.ViewTreeObserver
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.compose.PredictiveBackHandler
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.runtime.*
import androidx.compose.ui.graphics.toArgb
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
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

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val app = (application as KairosApplication).container
        chat =
            ViewModelProvider(
                this,
                object : ViewModelProvider.Factory {
                    override fun <T : ViewModel> create(modelClass: Class<T>): T {
                        @Suppress("UNCHECKED_CAST")
                        return ChatViewModel(app) as T
                    }
                },
            )[ChatViewModel::class.java]
        if (savedInstanceState != null) chat.openIntent(savedInstanceState.getString(SESSION_EXTRA))
        else if (intent.hasExtra(SESSION_EXTRA))
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
            PredictiveBackHandler(
                enabled = chat.screen == Screen.SignIn || chat.screen == Screen.Settings
            ) { events ->
                events.collect {}
                chat.back()
            }
            KairosTheme(colors, dark) {
                when (chat.screen) {
                    Screen.Connect,
                    Screen.SignIn -> AuthScreen(chat)
                    Screen.Chat -> ChatScreen(chat, bridge, ::copy)
                    Screen.Settings -> SettingsScreen(chat)
                }
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        chat.openIntent(intent.getStringExtra(SESSION_EXTRA))
    }

    override fun onSaveInstanceState(outState: Bundle) {
        outState.putString(SESSION_EXTRA, chat.sessionId)
        super.onSaveInstanceState(outState)
    }

    override fun onStart() {
        super.onStart()
        if (::chat.isInitialized && chat.screen == Screen.Chat) chat.conversation.resume()
    }

    override fun onStop() {
        if (::chat.isInitialized) chat.conversation.pause()
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
