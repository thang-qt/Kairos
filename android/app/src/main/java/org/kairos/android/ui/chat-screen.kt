@file:OptIn(
    androidx.compose.foundation.ExperimentalFoundationApi::class,
    androidx.compose.material3.ExperimentalMaterial3Api::class,
)

package org.kairos.android.ui

import androidx.lifecycle.compose.collectAsStateWithLifecycle

import android.view.HapticFeedbackConstants
import android.view.ViewGroup
import androidx.activity.compose.PredictiveBackHandler
import androidx.compose.animation.rememberSplineBasedDecay
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.AnchoredDraggableDefaults
import androidx.compose.foundation.gestures.AnchoredDraggableState
import androidx.compose.foundation.gestures.DraggableAnchors
import androidx.compose.foundation.gestures.Orientation
import androidx.compose.foundation.gestures.anchoredDraggable
import androidx.compose.foundation.gestures.animateTo
import androidx.compose.foundation.gestures.animateToWithDecay
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.input.pointer.PointerEventPass
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import kotlin.math.abs
import kotlin.math.roundToInt
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import org.kairos.android.assistant.ScreenAttachment
import org.kairos.android.chat.ChatViewModel
import org.kairos.android.data.AssistantRenderer
import org.kairos.android.data.ConnectionState
import org.kairos.android.data.activeRunId
import org.kairos.android.data.id
import org.kairos.android.transcript.TranscriptBridge
import org.kairos.android.transcript.TranscriptTheme
import org.kairos.android.transcript.TranscriptTouchHost
import org.kairos.android.ui.theme.LocalThemeColors
import org.kairos.android.ui.theme.ColorPalettes

enum class DrawerPosition {
    Closed,
    Open,
}

@Composable
fun ChatScreen(
    chat: ChatViewModel,
    bridgeFactory: () -> TranscriptBridge,
    onCopy: (String) -> Unit,
) {
    val renderer = chat.app.preferences.appRenderer
    val bridge = remember(renderer, chat.app.identityVersion) {
        if (renderer == AssistantRenderer.WebView) bridgeFactory() else null
    }
    val colors = LocalThemeColors.current
    val context = LocalContext.current
    val view = LocalView.current
    val density = LocalDensity.current
    val layoutDirection = LocalLayoutDirection.current
    val scope = rememberCoroutineScope()
    val keyboard = LocalSoftwareKeyboardController.current
    val focusManager = LocalFocusManager.current
    val drawer = remember { AnchoredDraggableState(DrawerPosition.Closed) }
    val decay = rememberSplineBasedDecay<Float>()
    var animationJob by remember { mutableStateOf<Job?>(null) }
    var width by remember { mutableFloatStateOf(1f) }
    val attachmentIdentity = chat.app.savedStateIdentity()
    // Keep the original launcher ticket across account/selection changes and recreation. The
    // Activity Result callback has no request id, so this single slot stays occupied until its
    // own launcher returns; otherwise a late result could inherit a newer request's identity.
    var attachmentRequestId by rememberSaveable { mutableStateOf<String?>(null) }
    var attachmentRequestIdentity by rememberSaveable { mutableStateOf<String?>(null) }
    var attachmentRequestIdentityGeneration by rememberSaveable {
        mutableLongStateOf(-1L)
    }
    var attachmentRequestSelectionGeneration by rememberSaveable {
        mutableIntStateOf(-1)
    }
    var attachmentRequestSessionId by rememberSaveable {
        mutableStateOf<String?>(null)
    }
    var attachmentRequestSource by rememberSaveable { mutableStateOf<String?>(null) }
    var cameraUri by androidx.compose.runtime.saveable.rememberSaveable {
        mutableStateOf<String?>(null)
    }
    fun activeAttachmentRequest(
        source: org.kairos.android.assistant.MainAttachmentRequest.Source? = null,
    ): org.kairos.android.assistant.MainAttachmentRequest? {
        val id = attachmentRequestId ?: return null
        val identity = attachmentRequestIdentity ?: return null
        val requestSource =
            when (attachmentRequestSource) {
                "picker" -> org.kairos.android.assistant.MainAttachmentRequest.Source.Picker
                "camera" -> org.kairos.android.assistant.MainAttachmentRequest.Source.Camera
                else -> return null
            }
        if (source != null && source != requestSource) return null
        return org.kairos.android.assistant.MainAttachmentRequest(
            id,
            identity,
            attachmentRequestIdentityGeneration,
            attachmentRequestSelectionGeneration,
            attachmentRequestSessionId,
            requestSource,
        )
    }
    fun rememberAttachmentRequest(request: org.kairos.android.assistant.MainAttachmentRequest) {
        attachmentRequestId = request.requestId
        attachmentRequestIdentity = request.identity
        attachmentRequestIdentityGeneration = request.identityGeneration
        attachmentRequestSelectionGeneration = request.selectionGeneration
        attachmentRequestSessionId = request.sessionId
        attachmentRequestSource =
            if (request.source == org.kairos.android.assistant.MainAttachmentRequest.Source.Picker)
                "picker"
            else "camera"
    }
    fun clearAttachmentRequest(request: org.kairos.android.assistant.MainAttachmentRequest) {
        if (activeAttachmentRequest(request.source) != request) return
        attachmentRequestId = null
        attachmentRequestIdentity = null
        attachmentRequestIdentityGeneration = -1L
        attachmentRequestSelectionGeneration = -1
        attachmentRequestSessionId = null
        attachmentRequestSource = null
    }
    fun acceptsAttachmentRequest(request: org.kairos.android.assistant.MainAttachmentRequest) =
        request.accepts(
            deliveredRequestId = attachmentRequestId.orEmpty(),
            deliveredSource = request.source,
            currentIdentity = chat.app.savedStateIdentity(),
            currentIdentityGeneration = chat.app.identityVersion,
            currentSelectionGeneration = chat.selectionGeneration,
            currentSessionId = chat.sessionId,
        )
    val history by chat.history.collectAsStateWithLifecycle()
    val connection by chat.connection.collectAsStateWithLifecycle()
    var bannerHeight by remember { mutableFloatStateOf(0f) }
    val banner =
        chat.error
            ?: if (chat.offline || connection == ConnectionState.Offline) "Can't reach server"
            else if (connection == ConnectionState.Reconnecting) "Reconnecting…"
            else if (chat.ephemeralMode && history.messages.isEmpty())
                "Throwaway chat — nothing is saved"
            else null
    LaunchedEffect(banner) { if (banner == null) bannerHeight = 0f }
    var attachments by
        remember(chat.sessionId, chat.app.identityVersion) { mutableStateOf<List<ScreenAttachment>>(emptyList()) }
    LaunchedEffect(chat.editing?.id) { if (chat.editing != null) attachments = emptyList() }
    val picker =
        androidx.activity.compose.rememberLauncherForActivityResult(
            androidx.activity.result.contract.ActivityResultContracts.PickVisualMedia()
        ) { uri ->
            val request =
                org.kairos.android.assistant.MainAttachmentRequest.callbackTicket(
                    activeAttachmentRequest(),
                    org.kairos.android.assistant.MainAttachmentRequest.Source.Picker,
                ) ?: return@rememberLauncherForActivityResult
            if (uri == null || !acceptsAttachmentRequest(request)) {
                clearAttachmentRequest(request)
                return@rememberLauncherForActivityResult
            }
            scope.launch {
                try {
                    val image =
                        kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) {
                            ScreenAttachment.fromUri(context, uri)
                        }
                    if (acceptsAttachmentRequest(request)) attachments = attachments + image
                } catch (e: Exception) {
                    if (e is CancellationException) throw e
                    if (acceptsAttachmentRequest(request)) chat.showError("Unable to attach this image.")
                } finally {
                    clearAttachmentRequest(request)
                }
            }
        }
    val camera = androidx.activity.compose.rememberLauncherForActivityResult(
        androidx.activity.result.contract.ActivityResultContracts.TakePicture()
    ) { success ->
        val request =
            org.kairos.android.assistant.MainAttachmentRequest.callbackTicket(
                activeAttachmentRequest(),
                org.kairos.android.assistant.MainAttachmentRequest.Source.Camera,
            ) ?: return@rememberLauncherForActivityResult
        val uri = cameraUri?.let(android.net.Uri::parse)
        cameraUri = null
        if (success && uri != null && acceptsAttachmentRequest(request)) scope.launch {
            try {
                val image = kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) {
                    org.kairos.android.assistant.ScreenAttachment.fromUri(context, uri)
                }
                if (acceptsAttachmentRequest(request)) attachments = attachments + image
            } catch (e: Exception) {
                if (e is CancellationException) throw e
                if (acceptsAttachmentRequest(request)) chat.showError("Unable to attach this photo.")
            } finally {
                org.kairos.android.assistant.CameraAttachment.remove(context, uri)
                clearAttachmentRequest(request)
            }
        } else {
            org.kairos.android.assistant.CameraAttachment.remove(context, uri)
            clearAttachmentRequest(request)
        }
    }
    LaunchedEffect(chat.sessionId) { chat.app.mcpLabels.refresh() }
    SideEffect {
        bridge?.let {
            it.webView.setBackgroundColor(chat.app.preferences.colors.surface.toArgb())
            it.theme(
                TranscriptTheme(
                    ColorPalettes[chat.app.preferences.paletteIndex].name,
                    if (chat.app.preferences.dark) "dark" else "light",
                )
            )
            it.toolLabels(chat.app.mcpLabels.labels)
        }
    }
    LaunchedEffect(history, chat.sessionId, renderer, bridge) {
        bridge?.render(chat.sessionId, if (renderer == AssistantRenderer.WebView) history.messages else emptyList())
    }
    DisposableEffect(bridge, chat) {
        if (bridge == null) return@DisposableEffect onDispose {}
        val handler: (org.json.JSONObject) -> Unit = { event ->
            when (event.optString("type")) {
                "longPress" -> chat.longPressId = event.optString("id")
                "activity" -> chat.activityId = event.optString("id")
            }
        }
        bridge.onEvent = handler
        onDispose {
            if (bridge.onEvent === handler) bridge.onEvent = {}
        }
    }
    var webTouch by remember { mutableStateOf(false) }
    var verticalGesture by remember { mutableStateOf(false) }
    var edgeGesture by remember { mutableStateOf(false) }
    var composerBodyHeight by remember { mutableFloatStateOf(72f) }
    val bottomInset =
        maxOf(WindowInsets.ime.getBottom(density), WindowInsets.navigationBars.getBottom(density)) /
            density.density
    val composerHeight = composerBodyHeight + bottomInset + bannerHeight
    val statusTop = WindowInsets.statusBars.getTop(density) / density.density
    val leftEdge =
        maxOf(
                WindowInsets.systemGestures.getLeft(density, layoutDirection),
                with(density) { 24.dp.roundToPx() },
            )
            .toFloat()
    val rightEdge =
        maxOf(
                WindowInsets.systemGestures.getRight(density, layoutDirection),
                with(density) { 24.dp.roundToPx() },
            )
            .toFloat()
    val offset = drawer.offset.takeIf { !it.isNaN() } ?: 0f
    val fraction = (offset / width).coerceIn(0f, 1f)

    LaunchedEffect(statusTop, composerHeight, bridge) {
        bridge?.insets(statusTop + 48f, composerHeight)
    }
    LaunchedEffect(drawer) {
        var last = DrawerPosition.Closed
        snapshotFlow { drawer.settledValue }
            .collect { position ->
                if (position != last) {
                    view.performHapticFeedback(HapticFeedbackConstants.CLOCK_TICK)
                    if (position == DrawerPosition.Open) {
                        chat.refreshSessions()
                        // An open drawer and a focused composer fight for the IME.
                        keyboard?.hide()
                        focusManager.clearFocus()
                    }
                }
                last = position
            }
    }
    fun settle(velocity: Float) {
        animationJob?.cancel()
        animationJob =
            scope.launch {
                val target =
                    if (abs(velocity) > with(density) { 125.dp.toPx() }) {
                        if (velocity > 0) DrawerPosition.Open else DrawerPosition.Closed
                    } else if (drawer.requireOffset() > width / 2) DrawerPosition.Open
                    else DrawerPosition.Closed
                drawer.animateToWithDecay(target, velocity, decayAnimationSpec = decay)
            }
    }
    fun close() {
        animationJob?.cancel()
        animationJob = scope.launch { drawer.animateTo(DrawerPosition.Closed) }
    }
    fun open() {
        animationJob?.cancel()
        animationJob = scope.launch { drawer.animateTo(DrawerPosition.Open) }
    }

    PredictiveBackHandler(
        enabled = fraction > 0.001f,
    ) { events ->
        val initial = drawer.requireOffset()
        try {
            drawer.anchoredDrag {
                events.collect { event -> dragTo(initial * (1 - event.progress)) }
            }
            drawer.animateTo(DrawerPosition.Closed)
        } catch (cancelled: CancellationException) {
            // Back cancellation must restore the fully open anchor, including a partial drag.
            scope.launch { drawer.animateTo(DrawerPosition.Open) }
            throw cancelled
        }
    }

    BoxWithConstraints(Modifier.fillMaxSize().background(colors.p(100))) {
        val widthPx = with(density) { maxWidth.toPx() }
        LaunchedEffect(widthPx) {
            width = widthPx
            drawer.updateAnchors(
                DraggableAnchors {
                    DrawerPosition.Closed at 0f
                    DrawerPosition.Open at widthPx
                }
            )
        }
        Sidebar(
            chat = chat,
            modifier =
                Modifier.fillMaxSize()
                    .offset { IntOffset((-widthPx * 0.12f * (1 - fraction)).roundToInt(), 0) }
                    .pointerInput(leftEdge, rightEdge) {
                        awaitEachGesture {
                            val down =
                                awaitFirstDown(
                                    requireUnconsumed = false,
                                    pass = PointerEventPass.Initial,
                                )
                            verticalGesture = false
                            edgeGesture =
                                down.position.x < leftEdge ||
                                    size.width - down.position.x < rightEdge
                            var directionKnown = false
                            do {
                                val event = awaitPointerEvent(PointerEventPass.Initial)
                                val pointer =
                                    event.changes.firstOrNull { it.id == down.id } ?: break
                                val delta = pointer.position - down.position
                                if (
                                    !directionKnown &&
                                        delta.getDistance() > viewConfiguration.touchSlop
                                ) {
                                    directionKnown = true
                                    verticalGesture = abs(delta.y) >= abs(delta.x) / 1.25f
                                }
                            } while (event.changes.any { it.pressed })
                            verticalGesture = false
                            edgeGesture = false
                        }
                    }
                    .anchoredDraggable(
                        state = drawer,
                        orientation = Orientation.Horizontal,
                        enabled = !verticalGesture && !edgeGesture,
                        flingBehavior = AnchoredDraggableDefaults.flingBehavior(drawer),
                    ),
            onSelect = { session ->
                chat.select(session.friendlyId)
                close()
            },
            onNew = {
                chat.select(null)
                close()
            },
            onClose = ::close,
        )
        Box(
            Modifier.fillMaxSize()
                .offset { IntOffset(offset.roundToInt(), 0) }
                .background(colors.surface)
                // Observe native touches before anchoredDraggable: latch the initial direction.
                // WebView touches are arbitrated in TranscriptTouchHost, sharing this state.
                .pointerInput(leftEdge, rightEdge) {
                    awaitEachGesture {
                        val down =
                            awaitFirstDown(
                                requireUnconsumed = false,
                                pass = PointerEventPass.Initial,
                            )
                        verticalGesture = false
                        edgeGesture =
                            down.position.x < leftEdge || size.width - down.position.x < rightEdge
                        var directionKnown = false
                        do {
                            val event = awaitPointerEvent(PointerEventPass.Initial)
                            val pointer = event.changes.firstOrNull { it.id == down.id } ?: break
                            val delta = pointer.position - down.position
                            if (
                                !directionKnown && delta.getDistance() > viewConfiguration.touchSlop
                            ) {
                                directionKnown = true
                                verticalGesture = abs(delta.y) >= abs(delta.x) / 1.25f
                            }
                        } while (event.changes.any { it.pressed })
                        verticalGesture = false
                        edgeGesture = false
                    }
                }
                .anchoredDraggable(
                    state = drawer,
                    orientation = Orientation.Horizontal,
                    enabled = !webTouch && !verticalGesture && !edgeGesture,
                    flingBehavior = AnchoredDraggableDefaults.flingBehavior(drawer),
                )
        ) {
            if (renderer == AssistantRenderer.Native || bridge == null || !bridge.supported) {
                key(chat.selectionGeneration, chat.app.identityVersion) {
                    NativeTranscript(
                        messages = history.messages,
                        dark = chat.app.preferences.dark,
                        api = chat.app.api,
                        identityVersion = chat.app.identityVersion,
                        identityVersionProvider = { chat.app.identityVersion },
                        modifier = Modifier.fillMaxSize(),
                        contentPadding = PaddingValues(
                            start = 16.dp, end = 16.dp,
                            top = statusTop.dp + 64.dp,
                            bottom = composerHeight.dp + 16.dp,
                        ),
                        onActivity = { chat.activityId = it },
                        onMessageActions = { chat.longPressId = it },
                        onLink = { org.kairos.android.assistant.openBrowser(context, it) },
                    )
                }
            } else {
                key(bridge) {
                    AndroidView(
                        factory = { ctx ->
                            (bridge.webView.parent as? ViewGroup)?.removeView(bridge.webView)
                            TranscriptTouchHost(ctx, bridge).apply {
                                onDrag = { delta ->
                                    animationJob?.cancel()
                                    animationJob = null
                                    drawer.dispatchRawDelta(delta)
                                }
                                onRelease = ::settle
                                onTouchActive = { webTouch = it }
                                systemEdge = maxOf(leftEdge, rightEdge)
                            }
                        },
                        update = { host -> host.systemEdge = maxOf(leftEdge, rightEdge) },
                        modifier = Modifier.fillMaxSize(),
                        onRelease = { host -> host.removeView(bridge.webView) },
                    )
                }
            }
            ChatHeader(chat, onOpenSidebar = ::open)
            // A sibling layer covers the entire bottom inset; padding cannot clip its paint.
            Box(
                Modifier.align(Alignment.BottomCenter)
                    .fillMaxWidth()
                    .height((composerBodyHeight * 4f / 3f + bottomInset).dp)
                    .background(
                        Brush.verticalGradient(
                            0f to colors.surface.copy(alpha = 0f),
                            0.5f to colors.surface,
                            1f to colors.surface,
                            endY = with(density) { (composerBodyHeight * 4f / 3f).dp.toPx() },
                        )
                    )
            )
            Column(
                Modifier.align(Alignment.BottomCenter)
                    .fillMaxWidth()
                    .imePadding()
                    .navigationBarsPadding()
            ) {
                // Approvals arrive with the conversation history and stream updates; they are
                // session-scoped, so no run filter is needed.
                val currentApprovals =
                    history.pendingMcpApprovals.filter { it.state == "pending" }
                if (currentApprovals.isNotEmpty())
                    McpApprovalCard(
                        currentApprovals,
                        busy = chat.busy,
                        onDecide = { decision, scope ->
                            chat.decideApproval(currentApprovals.first(), decision, scope)
                        },
                        modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
                    )
                if (banner != null)
                    Row(
                        Modifier.align(Alignment.CenterHorizontally)
                            .onSizeChanged { bannerHeight = it.height / density.density }
                            .padding(horizontal = 20.dp, vertical = 6.dp)
                            .background(colors.p(100), RoundedCornerShape(16.dp))
                            .padding(horizontal = 12.dp, vertical = 6.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(6.dp),
                    ) {
                        Text(
                            banner,
                            color = colors.p(700),
                            fontSize = 12.sp,
                            modifier = Modifier.weight(1f, fill = false),
                        )
                        if (
                            chat.error != null ||
                                ((chat.offline || connection == ConnectionState.Offline) &&
                                    connection != ConnectionState.Reconnecting)
                        )
                            Text(
                                "· Retry",
                                Modifier.pressable(onClick = chat::retryConnection),
                                color = colors.p(900),
                                fontSize = 12.sp,
                            )
                    }
                NativeComposer(
                    streaming = chat.streaming,
                    enabled = !chat.busy,
                    onSend = { text ->
                        keyboard?.hide()
                        focusManager.clearFocus()
                        scope.launch {
                            chat.send(text, attachments.map { it.payload() }).join()
                            if (chat.error == null) {
                                attachments = emptyList()
                            }
                        }
                    },
                    onStop = { chat.stop() },
                    focusRequestKey = chat.composerGeneration,
                    focusKey = chat.composerFocusGeneration.takeIf { it > 0 },
                    initialDraft = chat.composerSeed,
                    onDraftChange = chat::saveDraft,
                    editing = chat.editing != null,
                    onCancelEdit = chat::cancelEdit,
                    attachments = attachments,
                    onRemoveAttachment = { selected ->
                        attachments = attachments.filter { it.id != selected.id }
                    },
                    onAttach = onAttach@{
                        if (!org.kairos.android.assistant.MainAttachmentRequest.canLaunch(activeAttachmentRequest())) return@onAttach
                        val request =
                            org.kairos.android.assistant.MainAttachmentRequest.begin(
                                attachmentIdentity,
                                chat.app.identityVersion,
                                chat.selectionGeneration,
                                chat.sessionId,
                                org.kairos.android.assistant.MainAttachmentRequest.Source.Picker,
                            ) ?: return@onAttach
                        rememberAttachmentRequest(request)
                        try {
                            picker.launch(
                                androidx.activity.result.PickVisualMediaRequest(
                                    androidx.activity.result.contract.ActivityResultContracts
                                        .PickVisualMedia
                                        .ImageOnly
                                )
                            )
                        } catch (_: Exception) {
                            clearAttachmentRequest(request)
                            chat.showError("Unable to open image selection.")
                        }
                    },
                    onTakePhoto = onTakePhoto@{
                        if (!org.kairos.android.assistant.MainAttachmentRequest.canLaunch(activeAttachmentRequest())) return@onTakePhoto
                        val request =
                            org.kairos.android.assistant.MainAttachmentRequest.begin(
                                attachmentIdentity,
                                chat.app.identityVersion,
                                chat.selectionGeneration,
                                chat.sessionId,
                                org.kairos.android.assistant.MainAttachmentRequest.Source.Camera,
                            ) ?: return@onTakePhoto
                        try {
                            val uri = org.kairos.android.assistant.CameraAttachment.create(context)
                            rememberAttachmentRequest(request)
                            cameraUri = uri.toString()
                            camera.launch(uri)
                        } catch (_: Exception) {
                            org.kairos.android.assistant.CameraAttachment.remove(context, cameraUri?.let(android.net.Uri::parse))
                            cameraUri = null
                            clearAttachmentRequest(request)
                            chat.showError("Unable to open camera.")
                        }
                    },
                    onBodyHeight = { height -> composerBodyHeight = height / density.density },
                )
            }
            if (fraction > 0.001f)
                Box(
                    Modifier.fillMaxSize()
                        .background(colors.ink.copy(alpha = fraction * 0.16f))
                        .clickable(onClick = ::close)
                )

        }
    }
    chat.longPressId?.let { id ->
        history.messages
            .find { it.id == id }
            ?.let { message ->
                MessageActionsSheet(
                    message,
                    chat,
                    { chat.longPressId = null },
                    onCopy,
                    ephemeral = chat.ephemeralMode,
                )
            }
    }
    chat.activityId?.let { id ->
        history.messages
            .find { it.id == id }
            ?.let { turn -> ActivitySheet(turn, chat.app.mcpLabels.labels) { chat.activityId = null } }
    }
    if (chat.conversationSettingsOpen)
        ConversationSettingsSheet(chat) { chat.closeConversationSettings() }
}
