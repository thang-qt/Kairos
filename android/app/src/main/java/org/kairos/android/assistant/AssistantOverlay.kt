package org.kairos.android.assistant

import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.core.spring
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.Orientation
import androidx.compose.foundation.gestures.draggable
import androidx.compose.foundation.gestures.rememberDraggableState
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.input.key.*
import androidx.compose.ui.platform.*
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import org.kairos.android.app.KairosApplication
import org.kairos.android.data.*
import org.kairos.android.ui.*
import org.kairos.android.ui.theme.*

/** The first invocation is only a focused composer; answers occupy a top-anchored reply pane. */
@Composable
fun AssistantOverlay(
    app: KairosApplication,
    conversation: OverlayConversation,
    screenCapture: ScreenCaptureState,
    onDismiss: () -> Unit,
    onOpenApp: (String?) -> Unit,
    onPickImage: () -> Unit = {},
    onTakePhoto: () -> Unit = {},
) {
    KairosTheme(app.theme.colors, app.theme.dark) {
        val colors = LocalKairosColors.current
        val context = LocalContext.current
        val view = LocalView.current
        val density = LocalDensity.current
        val keyboard = LocalSoftwareKeyboardController.current
        val focusManager = LocalFocusManager.current
        val generation = conversation.generation
        val signedIn by app.container.tokens.signedIn.collectAsStateWithLifecycle()
        val imeVisible = WindowInsets.ime.getBottom(density) > 0
        val systemDark = androidx.compose.foundation.isSystemInDarkTheme()
        SideEffect { app.theme.systemDark = systemDark }
        LaunchedEffect(generation) {
            withFrameNanos {}
            view.post { conversation.firstFrame(generation) }
        }
        LaunchedEffect(generation, signedIn) { if (signedIn) app.container.mcpLabels.refresh() }
        var selectedActivityId by remember(generation) { mutableStateOf<String?>(null) }
        var composerHeight by remember(generation) { mutableStateOf(88.dp) }
        val sheetHost = remember(generation) { InlineSheetHost() }
        val swipe = rememberSwipeToOpen(generation) {
            keyboard?.hide()
            focusManager.clearFocus()
            conversation.requestOpen(onOpenApp)
        }
        val swipeDrag = Modifier.draggable(
            rememberDraggableState { delta -> swipe.dragBy(delta) },
            Orientation.Vertical,
            onDragStarted = { keyboard?.hide(); focusManager.clearFocus() },
            onDragStopped = { velocity -> swipe.release(velocity) },
        )
        val activityResponse = currentOverlayResponse(conversation.messages)?.takeIf { isAssistantStreaming(it) }
        val response = displayedOverlayResponse(conversation.messages)
        var measuredReplyHeight by remember(generation, response?.id) { mutableStateOf(160.dp) }
        val baseReplyHeight by animateDpAsState(
            if (response == null) 64.dp else measuredReplyHeight.coerceIn(96.dp, 420.dp),
            animationSpec = spring(dampingRatio = 0.95f, stiffness = 500f), label = "reply-height",
        )
        CompositionLocalProvider(LocalInlineSheetHost provides sheetHost) {
            BoxWithConstraints(
                Modifier.fillMaxSize()
                    .onPreInterceptKeyBeforeSoftKeyboard {
                        if (it.key == Key.Back || it.key == Key.Escape) {
                            if (it.type == KeyEventType.KeyUp) {
                                if (sheetHost.isShowing) sheetHost.dismiss()
                                else if (imeVisible) { keyboard?.hide(); focusManager.clearFocus() }
                                else onDismiss()
                            }
                            true
                        } else false
                    }
                    .onPreviewKeyEvent {
                        if (it.key == Key.Escape && it.type == KeyEventType.KeyDown) {
                            if (sheetHost.isShowing) sheetHost.dismiss() else onDismiss()
                            true
                        } else false
                    }
            ) {
                Box(Modifier.fillMaxSize().background(colors.p(950).copy(alpha = 0.25f))
                    .clickable(onClick = onDismiss))
                val progress = swipe.progress
                val maxReplyHeight = (600.dp - composerHeight - 12.dp).coerceAtLeast(80.dp)
                val replyHeight = baseReplyHeight + (maxReplyHeight - baseReplyHeight).coerceAtLeast(0.dp) * progress
                Column(
                    Modifier.align(Alignment.BottomCenter).widthIn(max = 640.dp).fillMaxWidth()
                        .imePadding().navigationBarsPadding().padding(horizontal = 16.dp, vertical = 12.dp)
                        .heightIn(max = maxHeight * 0.85f),
                    verticalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    if (!signedIn) {
                        Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(28.dp)).background(colors.surface).padding(20.dp),
                            verticalArrangement = Arrangement.spacedBy(12.dp)) {
                            Text("Sign in to use the assistant.", color = colors.p(800))
                            PrimaryButton("Open Kairos") { onOpenApp(null) }
                        }
                    } else {
                        if (response != null && response.answerText().isNotBlank()) {
                            val shape = RoundedCornerShape(28.dp - 4.dp * progress)
                            Column(
                                Modifier.weight(1f, fill = false).fillMaxWidth().height(replyHeight)
                                    .shadow(4.dp, shape).clip(shape).background(colors.surface)
                                    .clickable(indication = null, interactionSource = remember { androidx.compose.foundation.interaction.MutableInteractionSource() }) {},
                            ) {
                                OverlayDragHandle(swipeDrag, progress)
                                if (app.theme.assistantRenderer == AssistantRenderer.WebView && supportsOverlayWebView()) {
                                    OverlayTranscript(
                                        app = app, response = response, sessionId = conversation.sessionId,
                                        generation = generation, modifier = Modifier.weight(1f).fillMaxWidth(),
                                        onActivity = { selectedActivityId = it },
                                        onLink = { openBrowser(context, it); onDismiss() },
                                        onContentHeight = { measuredReplyHeight = it.dp + 24.dp },
                                    )
                                } else {
                                    NativeTranscript(
                                        messages = listOf(response), dark = app.theme.dark, api = app.container.api,
                                        identityVersion = app.container.identityVersion,
                                        identityVersionProvider = { app.container.identityVersion },
                                        followLatest = false, showModel = false, showActivity = false, modifier = Modifier.weight(1f).fillMaxWidth(),
                                        contentPadding = PaddingValues(start = 20.dp, end = 20.dp, bottom = 16.dp),
                                        onActivity = { selectedActivityId = it },
                                        onLink = { openBrowser(context, it); onDismiss() },
                                        onContentHeight = { with(density) { measuredReplyHeight = it.toDp() + 40.dp } },
                                    )
                                }
                            }
                        }
                        conversation.error?.let {
                            Text(it, Modifier.fillMaxWidth().background(colors.p(100), RoundedCornerShape(20.dp)).padding(12.dp), color = colors.p(800), fontSize = 12.sp)
                        }
                        if (conversation.pendingApprovals.isNotEmpty())
                            Box(Modifier.heightIn(max = 140.dp).verticalScroll(rememberScrollState())) {
                                McpApprovalCard(conversation.pendingApprovals, busy = conversation.streaming,
                                    onDecide = { decision, scope -> conversation.decide(conversation.pendingApprovals.first(), decision, scope) })
                            }
                        key(generation) {
                            NativeComposer(
                                streaming = conversation.streaming, assistantStyle = true,
                                workingLabel = overlayWorkingLabel(activityResponse, app.container.mcpLabels.labels),
                                onWorkingClick = activityResponse?.id?.let { id -> ({ selectedActivityId = id }) },
                                onSend = { text ->
                                    keyboard?.hide(); focusManager.clearFocus()
                                    conversation.send(text, screenCapture.takeAttachments())
                                },
                                onStop = conversation::stop, focusRequestKey = generation,
                                focusKey = generation, initialDraft = conversation.draft,
                                onDraftChange = { conversation.draft = it }, screenCapture = screenCapture,
                                onPickImage = onPickImage, onTakePhoto = onTakePhoto,
                                onScreenSettingsOpened = onDismiss,
                                onBodyHeight = { with(density) { composerHeight = it.toDp() } },
                                contentPadding = PaddingValues(horizontal = 4.dp),
                            )
                        }
                    }
                }
                selectedActivityId?.let { id ->
                    conversation.messages.firstOrNull { it.id == id }?.let { turn ->
                        ActivitySheet(turn, app.container.mcpLabels.labels) { selectedActivityId = null }
                    }
                }
                InlineSheetLayer(sheetHost)
            }
        }
    }
}

@Composable
private fun OverlayDragHandle(modifier: Modifier, progress: Float) {
    val colors = LocalKairosColors.current
    Box(modifier.fillMaxWidth().height(if (progress > 0f) 32.dp else 24.dp), contentAlignment = Alignment.Center) {
        if (progress > 0f) Text(if (progress >= 0.83f) "Release to open Kairos" else "Continue in Kairos", color = colors.p(600), fontSize = 12.sp)
        else Box(Modifier.size(36.dp, 4.dp).background(colors.p(400), RoundedCornerShape(2.dp)))
    }
}
