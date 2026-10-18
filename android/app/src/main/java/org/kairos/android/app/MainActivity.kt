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
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.createSavedStateHandle
import androidx.lifecycle.viewmodel.CreationExtras
import org.kairos.android.assistant.openBrowser
import org.kairos.android.chat.ChatViewModel
import org.kairos.android.transcript.TranscriptBridge
import android.content.MutableContextWrapper
import org.kairos.android.data.AssistantRenderer
import org.kairos.android.ui.*
import org.kairos.android.ui.theme.*

class MainActivity : ComponentActivity() {
    companion object {
        const val SESSION_EXTRA = "kairos.sessionId"
    }

    private lateinit var chat: ChatViewModel
    private lateinit var app: AppContainer
    private var transcriptBridge: TranscriptBridge? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        app = (application as ChatApplication).container
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
            val identityVersion = app.identityVersion
            val renderer = app.preferences.appRenderer
            SideEffect {
                val bridge = transcriptBridge
                if (
                    bridge != null &&
                    (bridge.identityVersion != identityVersion || renderer != AssistantRenderer.WebView)
                ) discardBridge(bridge)
            }
            LaunchedEffect(dark, app.preferences.paletteIndex) {
                val style =
                    if (dark) SystemBarStyle.dark(android.graphics.Color.TRANSPARENT)
                    else
                        SystemBarStyle.light(
                            android.graphics.Color.TRANSPARENT,
                            android.graphics.Color.TRANSPARENT,
                        )
                enableEdgeToEdge(statusBarStyle = style, navigationBarStyle = style)
            }
            AppTheme(colors, dark) {
                AppNavigation(chat, ::activityBridge, ::copy)
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
        app.foregroundAssistant.register(this) { chat.openNewChatFromAssistant() }
        if (::chat.isInitialized && chat.screen == Screen.Chat) chat.conversation.resume()
    }

    override fun onStop() {
        app.foregroundAssistant.unregister(this)
        if (::chat.isInitialized) chat.conversation.pause()
        app.sessions.stopSync()
        super.onStop()
    }

    private fun copy(text: String) {
        (getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager).setPrimaryClip(
            ClipData.newPlainText("Kairos message", text)
        )
    }

    private fun activityBridge(): TranscriptBridge {
        val current = transcriptBridge
        if (current != null && current.identityVersion == app.identityVersion && !current.isDestroyed)
            return current
        current?.let(::discardBridge)
        return TranscriptBridge(
            api = app.api,
            context = MutableContextWrapper(this),
            identityVersionProvider = { app.identityVersion },
        )
            .also { bridge ->
                transcriptBridge = bridge
                bridge.externalLink = { openBrowser(this, it) }
            }
    }

    private fun discardBridge(bridge: TranscriptBridge) {
        bridge.externalLink = {}
        bridge.context.baseContext = applicationContext
        bridge.destroy()
        if (transcriptBridge === bridge) transcriptBridge = null
    }

    override fun onDestroy() {
        if (::app.isInitialized) app.foregroundAssistant.unregister(this)
        transcriptBridge?.let(::discardBridge)
        super.onDestroy()
    }
}
