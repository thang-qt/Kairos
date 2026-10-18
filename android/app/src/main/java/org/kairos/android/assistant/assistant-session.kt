package org.kairos.android.assistant

import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.drawable.ColorDrawable
import android.os.Build
import android.os.Bundle
import android.service.voice.VoiceInteractionSession
import android.view.KeyEvent
import android.view.View
import android.view.WindowManager
import android.view.inputmethod.InputMethodManager
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.ComposeView
import androidx.compose.ui.platform.ViewCompositionStrategy
import androidx.core.view.WindowCompat
import androidx.lifecycle.setViewTreeLifecycleOwner
import androidx.lifecycle.setViewTreeViewModelStoreOwner
import androidx.savedstate.setViewTreeSavedStateRegistryOwner
import kotlinx.coroutines.*
import org.kairos.android.R
import org.kairos.android.app.ChatApplication
import org.kairos.android.markdown.MathRenderer

class AssistantSession(context: Context) : VoiceInteractionSession(context) {
    private val app = context.applicationContext as ChatApplication
    private val owner = SessionViewOwner()
    private val conversation = OverlayConversation(app.container, "Assistant")
    private val screenCapture = ScreenCaptureState()
    private val pickerScope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private var pickerJob: Job? = null
    private var content: ComposeView? = null
    private var pickerPending = false
    private var pickerLaunch: Intent? = null
    private var captureRequested = false
    private var routeToApp = false
    private var renderOverlay by androidx.compose.runtime.mutableStateOf(false)
    private val backCallback =
        if (Build.VERSION.SDK_INT >= 33) android.window.OnBackInvokedCallback { hide() } else null

    init {
        setTheme(R.style.Theme_AssistantOverlay)
    }

    override fun onCreate() {
        super.onCreate()
        owner.create()
        MathRenderer.prewarm()
        // Android only captures the screenshot as part of an assist-data request
        // (AssistDataRequester gates it on fetchData), so SHOW_WITH_ASSIST must stay
        // enabled. The structure/content it delivers is dropped in onHandleAssist.
        setDisabledShowContext(0)
    }

    override fun onCreateContentView(): View {
        val sessionWindow = window.window!!
        sessionWindow.clearFlags(
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
                WindowManager.LayoutParams.FLAG_ALT_FOCUSABLE_IM or
                WindowManager.LayoutParams.FLAG_DIM_BEHIND
        )
        sessionWindow.addFlags(WindowManager.LayoutParams.FLAG_HARDWARE_ACCELERATED)
        sessionWindow.setBackgroundDrawable(ColorDrawable(Color.TRANSPARENT))
        sessionWindow.setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE)
        WindowCompat.setDecorFitsSystemWindows(sessionWindow, false)
        sessionWindow.statusBarColor = Color.TRANSPARENT
        sessionWindow.navigationBarColor = Color.TRANSPARENT
        if (Build.VERSION.SDK_INT >= 29) sessionWindow.isNavigationBarContrastEnforced = false
        val decor = sessionWindow.decorView
        // The window recomposer searches the decor tree, not just the ComposeView subtree.
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
            if (!renderOverlay) return@setContent
            AssistantOverlay(
                app,
                conversation,
                screenCapture,
                onDismiss = { hide() },
                onOpenApp = { sessionId ->
                    // The options overload (API 31+) carries the slide-up entry animation.
                    if (Build.VERSION.SDK_INT >= 34)
                        startAssistantActivity(
                            mainAppIntent(context, sessionId),
                            openAppOptions(context),
                        )
                    else startAssistantActivity(mainAppIntent(context, sessionId))
                    hide()
                },
                onPickImage = { pickLibraryImage() },
                onTakePhoto = { pickLibraryImage(camera = true) },
            )
        }
    }

    override fun onPrepareShow(args: Bundle?, showFlags: Int) {
        super.onPrepareShow(args, showFlags)
        routeToApp = !pickerPending && LibraryAttachment.pending(context) == null &&
            app.container.foregroundAssistant.route()
        captureRequested = !routeToApp && !pickerPending
        if (captureRequested) screenCapture.begin()
    }

    // Discard screen text, view structure and content unread; Kairos only offers the screenshot.
    override fun onHandleAssist(state: AssistState) = Unit

    // Nullable, non-deprecated in API 35. No callback at all without SHOW_WITH_SCREENSHOT.
    override fun onHandleScreenshot(screenshot: Bitmap?) {
        if (captureRequested) screenCapture.receive(screenshot)
    }

    override fun onShow(args: Bundle?, showFlags: Int) {
        // Do not inspect args (which can describe foreground activities).
        super.onShow(args, showFlags)
        if (routeToApp) {
            routeToApp = false
            hide()
            return
        }
        renderOverlay = true
        val handoff = LibraryAttachment.pending(context)
        conversation.show(resume = pickerPending, recoveredSessionId = handoff?.sessionId)
        pickerPending = false
        content?.let(::installContent)
        owner.show()
        content?.requestApplyInsets()
        consumeLibraryAttachment()
        if (Build.VERSION.SDK_INT >= 33 && backCallback != null) {
            window.window
                ?.onBackInvokedDispatcher
                ?.registerOnBackInvokedCallback(
                    android.window.OnBackInvokedDispatcher.PRIORITY_OVERLAY,
                    backCallback,
                )
        }
    }

    /** Decode away from the UI thread and reject delivery into a later invocation. */
    private fun consumeLibraryAttachment() {
        val handoff = LibraryAttachment.pending(context) ?: return
        val uris = LibraryAttachment.selectedUris(context)
        if (uris.isEmpty()) {
            if (handoff.returned) LibraryAttachment.clear(context, handoff.requestId)
            return
        }
        val generation = conversation.generation
        pickerJob?.cancel()
        pickerJob = pickerScope.launch {
            val attachments = try {
                withContext(Dispatchers.IO) { uris.map { ScreenAttachment.fromUri(context, it) } }
            } catch (e: CancellationException) {
                throw e
            } catch (_: Exception) {
                LibraryAttachment.clear(context, handoff.requestId)
                return@launch
            }
            if (conversation.visible && conversation.generation == generation &&
                LibraryAttachment.pending(context)?.requestId == handoff.requestId) {
                attachments.forEach(screenCapture::receiveAttachment)
                LibraryAttachment.clear(context, handoff.requestId)
            }
        }
    }

    fun pickLibraryImage(camera: Boolean = false) {
        var requestId: String? = null
        try {
            requestId = LibraryAttachment.begin(context, conversation.sessionId)
            pickerPending = true
            pickerLaunch = Intent(context, PickerTrampolineActivity::class.java)
                .putExtra("camera", camera).putExtra("requestId", requestId)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            // VoiceInteractionSession remains above normal activities until explicitly hidden.
            // Launch from onHide, after its menu/composition and window have been dismissed.
            hide()
        } catch (_: Exception) {
            pickerPending = false
            pickerLaunch = null
            requestId?.let { LibraryAttachment.clear(context, it) }
        }
    }

    override fun onHide() {
        renderOverlay = false
        pickerJob?.cancel()
        conversation.hide(forPicker = pickerPending)
        if (!pickerPending) screenCapture.clear()
        // Release remembered thumbnails too; a stopped lifecycle alone retains composition state.
        content?.disposeComposition()
        content?.let {
            (context.getSystemService(Context.INPUT_METHOD_SERVICE) as InputMethodManager)
                .hideSoftInputFromWindow(it.windowToken, 0)
        }
        owner.hide()
        if (Build.VERSION.SDK_INT >= 33 && backCallback != null)
            window.window?.onBackInvokedDispatcher?.unregisterOnBackInvokedCallback(backCallback)
        super.onHide()
        val launch = pickerLaunch
        pickerLaunch = null
        if (launch != null) android.os.Handler(android.os.Looper.getMainLooper()).post {
            val requestId = launch.getStringExtra("requestId")
            if (requestId != null && LibraryAttachment.pending(context)?.requestId == requestId) {
                try { context.startActivity(launch) }
                catch (_: Exception) {
                    pickerPending = false
                    LibraryAttachment.clear(context, requestId)
                    android.widget.Toast.makeText(context, "Unable to open attachment source.", android.widget.Toast.LENGTH_SHORT).show()
                }
            }
        }
    }

    override fun onBackPressed() {
        hide()
    }

    override fun onKeyDown(keyCode: Int, event: KeyEvent): Boolean {
        if (keyCode == KeyEvent.KEYCODE_ESCAPE) {
            hide()
            return true
        }
        return super.onKeyDown(keyCode, event)
    }

    override fun onComputeInsets(outInsets: Insets) {
        // Keep underlying app geometry unchanged; the session owns its full-screen scrim.
        super.onComputeInsets(outInsets)
        outInsets.touchableInsets = Insets.TOUCHABLE_INSETS_FRAME
    }

    override fun onDestroy() {
        pickerScope.cancel()
        screenCapture.clear()
        conversation.destroy()
        owner.destroy()
        content?.disposeComposition()
        content = null
        super.onDestroy()
    }
}
