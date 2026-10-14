package org.kairos.android

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.drawable.ColorDrawable
import android.os.Build
import android.os.Bundle
import android.service.voice.VoiceInteractionSession
import android.util.Log
import android.view.KeyEvent
import android.view.View
import android.view.WindowManager
import android.view.inputmethod.InputMethodManager
import androidx.compose.ui.platform.ComposeView
import androidx.compose.ui.platform.ViewCompositionStrategy
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowCompat
import androidx.lifecycle.setViewTreeLifecycleOwner
import androidx.lifecycle.setViewTreeViewModelStoreOwner
import androidx.savedstate.setViewTreeSavedStateRegistryOwner

class KairosSession(context: Context) : VoiceInteractionSession(context) {
    private val app = context.applicationContext as KairosApplication
    private val owner = SessionViewOwner()
    private val conversation = OverlayConversation(app.perf, "Assistant")
    private val screenCapture = ScreenCaptureState()
    private var content: ComposeView? = null
    private val backCallback = if (Build.VERSION.SDK_INT >= 33) android.window.OnBackInvokedCallback { hide() } else null

    init { setTheme(R.style.Theme_Kairos_Overlay) }

    override fun onCreate() {
        super.onCreate()
        owner.create()
        // Android only captures the screenshot as part of an assist-data request
        // (AssistDataRequester gates it on fetchData), so SHOW_WITH_ASSIST must stay
        // enabled. The structure/content it delivers is dropped in onHandleAssist.
        setDisabledShowContext(0)
    }

    override fun onCreateContentView(): View {
        val sessionWindow = window.window!!
        sessionWindow.clearFlags(WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_ALT_FOCUSABLE_IM or WindowManager.LayoutParams.FLAG_DIM_BEHIND)
        sessionWindow.setBackgroundDrawable(ColorDrawable(Color.TRANSPARENT))
        sessionWindow.setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE)
        WindowCompat.setDecorFitsSystemWindows(sessionWindow, false)
        sessionWindow.statusBarColor = Color.TRANSPARENT
        sessionWindow.navigationBarColor = Color.TRANSPARENT
        if (Build.VERSION.SDK_INT >= 29) sessionWindow.isNavigationBarContrastEnforced = false
        val decor = sessionWindow.decorView
        // The window recomposer searches the decor tree, not just the ComposeView subtree.
        ViewCompat.setOnApplyWindowInsetsListener(decor) { _, insets ->
            val ime = insets.getInsets(WindowInsetsCompat.Type.ime()).bottom
            val value = "$ime px"
            if (app.perf.numbers["Assistant IME inset"] != value) {
                app.perf.numbers["Assistant IME inset"] = value
                Log.i("KairosPerf", "Assistant window IME inset=$ime visible=${insets.isVisible(WindowInsetsCompat.Type.ime())}")
            }
            insets // Do not consume: Compose must receive the window's IME insets.
        }
        decor.setViewTreeLifecycleOwner(owner)
        decor.setViewTreeSavedStateRegistryOwner(owner)
        decor.setViewTreeViewModelStoreOwner(owner)
        return ComposeView(context).apply {
            id = View.generateViewId()
            setViewTreeLifecycleOwner(owner)
            setViewTreeSavedStateRegistryOwner(owner)
            setViewTreeViewModelStoreOwner(owner)
            setViewCompositionStrategy(ViewCompositionStrategy.DisposeOnViewTreeLifecycleDestroyed)
            installContent(this)
            content = this
        }
    }

    private fun installContent(view: ComposeView) {
        view.setContent {
            AssistantOverlay(app, conversation, screenCapture, onDismiss = { hide() }, onOpenApp = { messages ->
                if (messages.isNotEmpty()) app.pendingConversation = messages
                startAssistantActivity(mainAppIntent(context))
                hide()
            })
        }
    }

    override fun onPrepareShow(args: Bundle?, showFlags: Int) {
        super.onPrepareShow(args, showFlags)
        screenCapture.begin()
    }

    // Discard screen text, view structure and content unread; Kairos only offers the screenshot.
    override fun onHandleAssist(state: AssistState) = Unit

    // Nullable, non-deprecated in API 35. No callback at all without SHOW_WITH_SCREENSHOT.
    override fun onHandleScreenshot(screenshot: Bitmap?) {
        screenCapture.receive(screenshot)
    }

    override fun onShow(args: Bundle?, showFlags: Int) {
        // Do not inspect args (which can describe foreground activities).
        super.onShow(args, showFlags)
        conversation.show()
        content?.let(::installContent)
        owner.show()
        content?.requestApplyInsets()
        if (Build.VERSION.SDK_INT >= 33 && backCallback != null) {
            window.window?.onBackInvokedDispatcher?.registerOnBackInvokedCallback(android.window.OnBackInvokedDispatcher.PRIORITY_OVERLAY, backCallback)
        }
    }

    override fun onHide() {
        conversation.hide()
        screenCapture.clear()
        // Release remembered thumbnails too; a stopped lifecycle alone retains composition state.
        content?.disposeComposition()
        content?.let { (context.getSystemService(Context.INPUT_METHOD_SERVICE) as InputMethodManager).hideSoftInputFromWindow(it.windowToken, 0) }
        owner.hide()
        if (Build.VERSION.SDK_INT >= 33 && backCallback != null) window.window?.onBackInvokedDispatcher?.unregisterOnBackInvokedCallback(backCallback)
        super.onHide()
    }

    override fun onBackPressed() { hide() }
    override fun onKeyDown(keyCode: Int, event: KeyEvent): Boolean {
        if (keyCode == KeyEvent.KEYCODE_ESCAPE) { hide(); return true }
        return super.onKeyDown(keyCode, event)
    }

    override fun onComputeInsets(outInsets: Insets) {
        // Keep underlying app geometry unchanged; the session owns its full-screen scrim.
        super.onComputeInsets(outInsets)
        outInsets.touchableInsets = Insets.TOUCHABLE_INSETS_FRAME
    }

    override fun onDestroy() {
        screenCapture.clear()
        conversation.destroy()
        owner.destroy()
        content?.disposeComposition()
        content = null
        super.onDestroy()
    }
}
