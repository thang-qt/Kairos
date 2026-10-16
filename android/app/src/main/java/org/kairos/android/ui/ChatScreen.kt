@file:OptIn(
    androidx.compose.foundation.ExperimentalFoundationApi::class,
    androidx.compose.material3.ExperimentalMaterial3Api::class,
)

package org.kairos.android.ui

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
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
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
import org.kairos.android.data.ConnectionState
import org.kairos.android.data.activeRunId
import org.kairos.android.data.approvalRunId
import org.kairos.android.data.id
import org.kairos.android.transcript.TranscriptBridge
import org.kairos.android.transcript.TranscriptTouchHost
import org.kairos.android.ui.theme.LocalKairosColors

enum class DrawerPosition {
    Closed,
    Open,
}

@Composable
fun ChatScreen(chat: ChatViewModel, bridge: TranscriptBridge, onCopy: (String) -> Unit) {
    val colors = LocalKairosColors.current
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
    val history by chat.history.collectAsState()
    val connection by chat.connection.collectAsState()
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
        remember(chat.sessionId) { mutableStateOf<List<ScreenAttachment>>(emptyList()) }
    LaunchedEffect(chat.editing?.id) { if (chat.editing != null) attachments = emptyList() }
    val picker =
        androidx.activity.compose.rememberLauncherForActivityResult(
            androidx.activity.result.contract.ActivityResultContracts.PickVisualMedia()
        ) { uri ->
            val target = chat.sessionId
            if (uri != null)
                scope.launch {
                    try {
                        val image =
                            kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) {
                                ScreenAttachment.fromUri(context, uri)
                            }
                        if (chat.sessionId == target) attachments = attachments + image
                    } catch (e: Exception) {
                        if (e is CancellationException) throw e
                        chat.showError("Unable to attach this image.")
                    }
                }
        }
    LaunchedEffect(history, chat.sessionId) { bridge.render(chat.sessionId, history.messages) }
    LaunchedEffect(bridge) {
        bridge.onEvent = { event ->
            when (event.optString("type")) {
                "longPress" -> chat.longPressId = event.optString("id")
                "activity" -> chat.activityId = event.optString("id")
            }
        }
    }
    DisposableEffect(bridge) { onDispose { bridge.onEvent = {} } }
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

    LaunchedEffect(statusTop, composerHeight) { bridge.insets(statusTop + 48f, composerHeight) }
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
        enabled = fraction > 0.001f || chat.searchOpen,
    ) { events ->
        if (chat.searchOpen) {
            events.collect {}
            chat.closeSearch()
            return@PredictiveBackHandler
        }
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
                val approvals by chat.pendingApprovals.collectAsState()
                val runId = approvalRunId(history.messages)
                val currentApprovals =
                    if (runId == null) emptyList() else approvals.filter { it.runId == runId }
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
                        if (connection != ConnectionState.Reconnecting || chat.error != null)
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
                        scope.launch {
                            chat.send(text, attachments.map { it.payload() }).join()
                            if (chat.error == null) {
                                attachments = emptyList()
                                // Reading the reply beats an always-up keyboard.
                                keyboard?.hide()
                                focusManager.clearFocus()
                            }
                        }
                    },
                    onStop = { chat.stop() },
                    focusRequestKey = chat.composerGeneration,
                    initialDraft = chat.composerSeed,
                    editing = chat.editing != null,
                    onCancelEdit = chat::cancelEdit,
                    attachments = attachments,
                    onRemoveAttachment = { selected ->
                        attachments = attachments.filter { it.id != selected.id }
                    },
                    onAttach = {
                        picker.launch(
                            androidx.activity.result.PickVisualMediaRequest(
                                androidx.activity.result.contract.ActivityResultContracts
                                    .PickVisualMedia
                                    .ImageOnly
                            )
                        )
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
            if (!bridge.supported)
                Text(
                    "Update Android System WebView to enable the message bridge.",
                    modifier = Modifier.align(Alignment.Center).padding(24.dp),
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
            ?.let { turn -> ActivitySheet(turn) { chat.activityId = null } }
    }
    if (chat.conversationSettingsOpen)
        ConversationSettingsSheet(chat) { chat.closeConversationSettings() }
    if (chat.searchOpen)
        SearchOverlay(
            chat,
            onDismiss = chat::closeSearch,
            onSelect = { id ->
                chat.closeSearch()
                chat.select(id)
            },
        )
}
