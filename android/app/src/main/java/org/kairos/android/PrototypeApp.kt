@file:OptIn(androidx.compose.foundation.ExperimentalFoundationApi::class, androidx.compose.material3.ExperimentalMaterial3Api::class)

package org.kairos.android

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
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import org.kairos.android.ui.theme.LocalKairosColors
import kotlin.math.abs
import kotlin.math.roundToInt

enum class DrawerPosition { Closed, Open }

@Composable
fun PrototypeApp(chat: PrototypeChat, bridge: TranscriptBridge, perf: Performance, onCopy: (String) -> Unit) {
    val colors = LocalKairosColors.current
    val context = LocalContext.current
    val view = LocalView.current
    val density = LocalDensity.current
    val layoutDirection = LocalLayoutDirection.current
    val scope = rememberCoroutineScope()
    val drawer = remember { AnchoredDraggableState(DrawerPosition.Closed) }
    val decay = rememberSplineBasedDecay<Float>()
    var animationJob by remember { mutableStateOf<Job?>(null) }
    var width by remember { mutableFloatStateOf(1f) }
    var debug by remember { mutableStateOf(false) }
    var webTouch by remember { mutableStateOf(false) }
    var verticalGesture by remember { mutableStateOf(false) }
    var edgeGesture by remember { mutableStateOf(false) }
    var composerBodyHeight by remember { mutableFloatStateOf(72f) }
    val bottomInset = maxOf(WindowInsets.ime.getBottom(density), WindowInsets.navigationBars.getBottom(density)) / density.density
    val composerHeight = composerBodyHeight + bottomInset
    val statusTop = WindowInsets.statusBars.getTop(density) / density.density
    val leftEdge = maxOf(WindowInsets.systemGestures.getLeft(density, layoutDirection), with(density) { 24.dp.roundToPx() }).toFloat()
    val rightEdge = maxOf(WindowInsets.systemGestures.getRight(density, layoutDirection), with(density) { 24.dp.roundToPx() }).toFloat()
    val offset = drawer.offset.takeIf { !it.isNaN() } ?: 0f
    val fraction = (offset / width).coerceIn(0f, 1f)

    LaunchedEffect(statusTop, composerHeight) { chat.updateInsets(statusTop + 48f, composerHeight) }
    LaunchedEffect(drawer) {
        var last = DrawerPosition.Closed
        snapshotFlow { drawer.settledValue }.collect { position ->
            if (position != last) view.performHapticFeedback(HapticFeedbackConstants.CLOCK_TICK)
            last = position
        }
    }
    fun settle(velocity: Float) {
        animationJob?.cancel()
        animationJob = scope.launch {
            val target = if (abs(velocity) > with(density) { 125.dp.toPx() }) {
                if (velocity > 0) DrawerPosition.Open else DrawerPosition.Closed
            } else if (drawer.requireOffset() > width / 2) DrawerPosition.Open else DrawerPosition.Closed
            drawer.animateToWithDecay(target, velocity, decayAnimationSpec = decay)
        }
    }
    fun close() { animationJob?.cancel(); animationJob = scope.launch { drawer.animateTo(DrawerPosition.Closed) } }
    fun open() { animationJob?.cancel(); animationJob = scope.launch { drawer.animateTo(DrawerPosition.Open) } }

    PredictiveBackHandler(enabled = fraction > 0.001f) { events ->
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
            drawer.updateAnchors(DraggableAnchors { DrawerPosition.Closed at 0f; DrawerPosition.Open at widthPx })
        }
        Sidebar(
            chat = chat,
            modifier = Modifier.fillMaxSize().offset { IntOffset((-widthPx * 0.12f * (1 - fraction)).roundToInt(), 0) }
                .pointerInput(leftEdge, rightEdge) {
                    awaitEachGesture {
                        val down = awaitFirstDown(requireUnconsumed = false, pass = PointerEventPass.Initial)
                        verticalGesture = false
                        edgeGesture = down.position.x < leftEdge || size.width - down.position.x < rightEdge
                        var directionKnown = false
                        do {
                            val event = awaitPointerEvent(PointerEventPass.Initial)
                            val pointer = event.changes.firstOrNull { it.id == down.id } ?: break
                            val delta = pointer.position - down.position
                            if (!directionKnown && delta.getDistance() > viewConfiguration.touchSlop) {
                                directionKnown = true
                                verticalGesture = abs(delta.y) >= abs(delta.x) / 1.25f
                            }
                        } while (event.changes.any { it.pressed })
                        verticalGesture = false
                        edgeGesture = false
                    }
                }

                .anchoredDraggable(state = drawer, orientation = Orientation.Horizontal, enabled = !verticalGesture && !edgeGesture, flingBehavior = AnchoredDraggableDefaults.flingBehavior(drawer)),
            onSelect = { session -> chat.select(session); close() },
            onNew = { chat.select(null); close() },
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
                        val down = awaitFirstDown(requireUnconsumed = false, pass = PointerEventPass.Initial)
                        verticalGesture = false
                        edgeGesture = down.position.x < leftEdge || size.width - down.position.x < rightEdge
                        var directionKnown = false
                        do {
                            val event = awaitPointerEvent(PointerEventPass.Initial)
                            val pointer = event.changes.firstOrNull { it.id == down.id } ?: break
                            val delta = pointer.position - down.position
                            if (!directionKnown && delta.getDistance() > viewConfiguration.touchSlop) {
                                directionKnown = true
                                verticalGesture = abs(delta.y) >= abs(delta.x) / 1.25f
                            }
                        } while (event.changes.any { it.pressed })
                        verticalGesture = false
                        edgeGesture = false
                    }
                }
                .anchoredDraggable(
                    state = drawer, orientation = Orientation.Horizontal,
                    enabled = !webTouch && !verticalGesture && !edgeGesture,
                    flingBehavior = AnchoredDraggableDefaults.flingBehavior(drawer),
                ),
        ) {
            AndroidView(
                factory = { ctx ->
                    (bridge.webView.parent as? ViewGroup)?.removeView(bridge.webView)
                    TranscriptTouchHost(ctx, bridge).apply {
                        onDrag = { delta ->
                            animationJob?.cancel(); animationJob = null
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
            ChatHeader(chat, onOpenSidebar = ::open, onToggleDebug = { debug = !debug })
            // A sibling layer covers the entire bottom inset; padding cannot clip its paint.
            Box(Modifier.align(Alignment.BottomCenter).fillMaxWidth()
                .height((composerBodyHeight * 4f / 3f + bottomInset).dp)
                .background(Brush.verticalGradient(
                    0f to colors.surface.copy(alpha = 0f),
                    0.5f to colors.surface,
                    1f to colors.surface,
                    endY = with(density) { (composerBodyHeight * 4f / 3f).dp.toPx() },
                )))
            NativeComposer(
                streaming = chat.streaming,
                onSend = chat::send,
                onStop = chat::stop,
                modifier = Modifier.align(Alignment.BottomCenter).fillMaxWidth().imePadding().navigationBarsPadding(),
                onBodyHeight = { height -> composerBodyHeight = height / density.density },
            )
            if (fraction > 0.001f) Box(Modifier.fillMaxSize().background(colors.ink.copy(alpha = fraction * 0.16f)).clickable(onClick = ::close))
            if (debug) {
                Column(Modifier.align(Alignment.TopEnd).statusBarsPadding().padding(top = 76.dp, end = 8.dp)
                    .background(colors.p(100).copy(alpha = 0.96f), RoundedCornerShape(12.dp)).padding(12.dp)) {
                    Text("KairosPerf · frame proxy", fontWeight = FontWeight.Medium, fontSize = 12.sp)
                    perf.numbers.forEach { (label, value) ->
                        Text("$label: $value", fontFamily = FontFamily.Monospace, fontSize = 10.sp)
                    }
                    Text(if (chat.atBottom) "Following bottom" else "Reading history", fontSize = 11.sp)
                }
            }
            if (!bridge.supported) Text("Update Android System WebView to enable the message bridge.", modifier = Modifier.align(Alignment.Center).padding(24.dp))
        }
    }
    val selectedId = chat.longPressId
    if (selectedId != null) {
        MessageActionsSheet(
            message = chat.messages.find { it.id == selectedId },
            onDismiss = { chat.longPressId = null },
            onCopy = onCopy,
        )
    }
}

