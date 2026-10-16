@file:OptIn(androidx.compose.foundation.ExperimentalFoundationApi::class)

package org.kairos.android.assistant

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.Orientation
import androidx.compose.foundation.gestures.draggable
import androidx.compose.foundation.gestures.rememberDraggableState
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.onPreInterceptKeyBeforeSoftKeyboard
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.ui.input.nestedscroll.NestedScrollConnection
import androidx.compose.ui.input.nestedscroll.NestedScrollSource
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Velocity
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import org.kairos.android.app.KairosApplication
import org.kairos.android.data.answerText
import org.kairos.android.data.id
import org.kairos.android.data.isLive
import org.kairos.android.data.modelName
import org.kairos.android.data.role
import org.kairos.android.data.status
import org.kairos.android.markdown.OverlayMarkdown
import org.kairos.android.ui.GhostIconButton
import org.kairos.android.ui.KIcon
import org.kairos.android.ui.McpApprovalCard
import org.kairos.android.ui.KairosMark
import org.kairos.android.ui.ModelLabel
import org.kairos.android.ui.NativeComposer
import org.kairos.android.ui.PrimaryButton
import org.kairos.android.ui.icons.KairosIcons
import org.kairos.android.ui.pressable
import org.kairos.android.ui.theme.KairosTheme
import org.kairos.android.ui.theme.LocalKairosColors

/** Shared native UI. Only the replies have a card; the composer floats over the scrim. */
@Composable
fun AssistantOverlay(
    app: KairosApplication,
    conversation: OverlayConversation,
    screenCapture: ScreenCaptureState,
    onDismiss: () -> Unit,
    onOpenApp: (String?) -> Unit,
    onPickImage: () -> Unit = {},
) {
    KairosTheme(app.theme.colors, app.theme.dark) {
        val colors = LocalKairosColors.current
        val context = LocalContext.current
        val view = LocalView.current
        val density = LocalDensity.current
        val keyboard = androidx.compose.ui.platform.LocalSoftwareKeyboardController.current
        val focusManager = androidx.compose.ui.platform.LocalFocusManager.current
        val generation = conversation.generation
        val imeVisible = WindowInsets.ime.getBottom(density) > 0
        val signedIn by app.container.tokens.signedIn.collectAsState()
        val systemDark = androidx.compose.foundation.isSystemInDarkTheme()
        SideEffect { app.theme.systemDark = systemDark }
        LaunchedEffect(generation) {
            withFrameNanos {}
            view.post { conversation.firstFrame(generation) }
        }
        val scroll = rememberScrollState()
        var follow by remember(generation) { mutableStateOf(true) }
        LaunchedEffect(scroll, generation) {
            snapshotFlow { scroll.isScrollInProgress }
                .collect { dragging ->
                    if (
                        !dragging &&
                            scroll.maxValue - scroll.value <= with(density) { 48.dp.roundToPx() }
                    )
                        follow = true
                }
        }
        val swipe = rememberSwipeToOpen(generation) { conversation.requestOpen(onOpenApp) }
        val userScroll =
            remember(generation, swipe) {
                object : NestedScrollConnection {
                    override fun onPreScroll(
                        available: Offset,
                        source: NestedScrollSource,
                    ): Offset {
                        if (source != NestedScrollSource.UserInput) return Offset.Zero
                        if (available.y != 0f) follow = false
                        // Pulling back down first undoes a pending swipe-up before the content
                        // scrolls.
                        return Offset(0f, swipe.retract(available.y))
                    }

                    override fun onPostScroll(
                        consumed: Offset,
                        available: Offset,
                        source: NestedScrollSource,
                    ): Offset {
                        // Dragging up past the end of the replies becomes the swipe-up gesture.
                        if (source != NestedScrollSource.UserInput || available.y >= 0f)
                            return Offset.Zero
                        swipe.dragBy(available.y)
                        return available
                    }

                    override suspend fun onPreFling(available: Velocity): Velocity {
                        if (!swipe.active) return Velocity.Zero
                        swipe.release(available.y)
                        return available
                    }
                }
            }
        val swipeDrag =
            Modifier.draggable(
                rememberDraggableState { delta -> swipe.dragBy(delta) },
                Orientation.Vertical,
                onDragStopped = { velocity -> swipe.release(velocity) },
            )
        LaunchedEffect(scroll.maxValue, generation, imeVisible) {
            if (follow) scroll.scrollTo(scroll.maxValue)
        }
        BoxWithConstraints(
            Modifier.fillMaxSize()
                .onPreInterceptKeyBeforeSoftKeyboard {
                    if (it.key == Key.Back || it.key == Key.Escape) {
                        if (it.type == KeyEventType.KeyUp) onDismiss()
                        true
                    } else false
                }
                .onPreviewKeyEvent {
                    if (it.key == Key.Escape && it.type == KeyEventType.KeyDown) {
                        onDismiss()
                        true
                    } else false
                }
        ) {
            val progress = swipe.progress
            Box(
                Modifier.fillMaxSize()
                    .background(
                        colors.p(950).copy(alpha = 0.20f + 0.4f * progress.coerceAtMost(1f))
                    )
                    .clickable(onClick = onDismiss)
            )
            SwipeHint(
                progress,
                Modifier.align(Alignment.TopCenter).statusBarsPadding().padding(top = 24.dp),
            )
            val maxCardHeight = maxHeight * 0.48f
            // Same working inset chain moves replies and composer together, with no painted
            // container.
            Column(
                Modifier.align(Alignment.BottomCenter)
                    .fillMaxWidth()
                    .imePadding()
                    .navigationBarsPadding()
                    .padding(horizontal = 12.dp, vertical = 8.dp)
                    .graphicsLayer {
                        translationY = -swipe.offset
                        alpha = swipe.alpha
                        // The card lifts off from its bottom edge as the handoff begins.
                        val scale = 1f - 0.06f * swipe.progress.coerceIn(0f, 1f)
                        scaleX = scale
                        scaleY = scale
                        transformOrigin = androidx.compose.ui.graphics.TransformOrigin(0.5f, 1f)
                    }
            ) {
                AnimatedVisibility(
                    visible = conversation.messages.isNotEmpty(),
                    modifier =
                        Modifier.weight(1f, fill = false)
                            .fillMaxWidth()
                            .heightIn(max = maxCardHeight)
                            .padding(bottom = 8.dp),
                    enter =
                        fadeIn(tween(180)) +
                            slideInVertically(tween(180)) { with(density) { 12.dp.roundToPx() } },
                    exit = fadeOut(tween(100)),
                    label = "reply-card",
                ) {
                    val shape = RoundedCornerShape(24.dp)
                    Column(
                        Modifier.fillMaxWidth()
                            .shadow(10.dp, shape)
                            .clip(shape)
                            .background(colors.surface)
                            .clickable(
                                interactionSource =
                                    remember {
                                        androidx.compose.foundation.interaction
                                            .MutableInteractionSource()
                                    },
                                indication = null,
                                onClick = {},
                            )
                    ) {
                        Column(swipeDrag) {
                            Box(
                                Modifier.fillMaxWidth().padding(top = 8.dp),
                                contentAlignment = Alignment.Center,
                            ) {
                                Box(
                                    Modifier.size(width = 40.dp, height = 4.dp)
                                        .background(colors.p(300), RoundedCornerShape(2.dp))
                                )
                            }
                            OverlayActions(
                                conversation,
                                screenCapture,
                                onOpenApp,
                                Modifier.padding(horizontal = 8.dp),
                            )
                        }
                        SelectionContainer(Modifier.weight(1f, fill = false)) {
                            Column(
                                Modifier.fillMaxWidth()
                                    .nestedScroll(userScroll)
                                    .verticalScroll(scroll)
                                    .padding(
                                        start = 16.dp,
                                        end = 16.dp,
                                        top = 4.dp,
                                        bottom = 16.dp,
                                    ),
                                verticalArrangement = Arrangement.spacedBy(16.dp),
                            ) {
                                conversation.messages.forEach { message ->
                                    key(message.id) {
                                        if (message.role == "user")
                                            Box(
                                                Modifier.fillMaxWidth(),
                                                contentAlignment = Alignment.CenterEnd,
                                            ) {
                                                Column(
                                                    Modifier.fillMaxWidth(0.85f),
                                                    horizontalAlignment = Alignment.End,
                                                    verticalArrangement = Arrangement.spacedBy(8.dp),
                                                ) {
                                                    val images =
                                                        remember(message) {
                                                            message.overlayImages()
                                                        }
                                                    images.forEach { attachment ->
                                                        ScreenThumbnail(
                                                            attachment,
                                                            Modifier.heightIn(max = 200.dp)
                                                                .aspectRatio(
                                                                    attachment.width.toFloat() /
                                                                        attachment.height
                                                                )
                                                                .clip(RoundedCornerShape(8.dp)),
                                                            crop = true,
                                                        )
                                                    }
                                                    if (message.answerText().isNotBlank())
                                                        Text(
                                                            message.answerText(),
                                                            color = colors.p(900),
                                                            fontSize = 15.sp,
                                                            lineHeight = 22.sp,
                                                            modifier =
                                                                Modifier.background(
                                                                        colors.p(100),
                                                                        RoundedCornerShape(12.dp),
                                                                    )
                                                                    .padding(
                                                                        horizontal = 16.dp,
                                                                        vertical = 10.dp,
                                                                    ),
                                                        )
                                                }
                                            }
                                        else
                                            Column(
                                                verticalArrangement = Arrangement.spacedBy(6.dp)
                                            ) {
                                                message.modelName?.let { ModelLabel(it) }
                                                OverlayMarkdown(
                                                    message.answerText(),
                                                    message.isLive,
                                                    app.theme.dark,
                                                ) { href ->
                                                    openBrowser(context, href)
                                                    onDismiss()
                                                }
                                                if (
                                                    message.isLive && message.answerText().isEmpty()
                                                )
                                                    Text(
                                                        "Thinking…",
                                                        color = colors.p(500),
                                                        fontSize = 12.sp,
                                                    )
                                                if (
                                                    message.status in
                                                        listOf("aborted", "error", "interrupted")
                                                )
                                                    Text(
                                                        when (message.status) {
                                                            "aborted" -> "Cancelled"
                                                            "error" -> "Failed"
                                                            else -> "Interrupted"
                                                        },
                                                        color = colors.p(600),
                                                        fontSize = 12.sp,
                                                    )
                                            }
                                    }
                                }
                            }
                        }
                    }
                }
                if (signedIn && conversation.messages.isEmpty()) {
                    OverlayActions(
                        conversation,
                        screenCapture,
                        onOpenApp,
                        swipeDrag.padding(bottom = 8.dp),
                        floating = true,
                    )
                }
                conversation.error?.let {
                    Text(
                        it,
                        Modifier.padding(8.dp)
                            .background(colors.p(100), RoundedCornerShape(16.dp))
                            .padding(8.dp),
                        color = colors.p(700),
                        fontSize = 12.sp,
                    )
                }
                if (!signedIn)
                    Column(
                        Modifier.fillMaxWidth()
                            .background(colors.surface, RoundedCornerShape(22.dp))
                            .padding(20.dp),
                        verticalArrangement = Arrangement.spacedBy(12.dp),
                    ) {
                        KairosMark()
                        Text("Sign in to Kairos to use the assistant.", color = colors.p(700))
                        PrimaryButton("Open Kairos") { onOpenApp(null) }
                    }
                else {
                    if (conversation.pendingApprovals.isNotEmpty())
                        McpApprovalCard(
                            conversation.pendingApprovals,
                            busy = conversation.streaming,
                            onDecide = { decision, decisionScope ->
                                conversation.decide(
                                    conversation.pendingApprovals.first(),
                                    decision,
                                    decisionScope,
                                )
                            },
                            modifier = Modifier.padding(bottom = 4.dp),
                        )
                    key(generation) {
                        NativeComposer(
                            conversation.streaming,
                            onSend = { text ->
                                // Free the IME right away so the reply card has room.
                                keyboard?.hide()
                                focusManager.clearFocus()
                                conversation.send(text, screenCapture.takeAttachment())
                            },
                            onStop = conversation::stop,
                            focusRequestKey = generation,
                            focusKey = generation,
                            modifier = swipeDrag,
                            screenCapture = screenCapture,
                            onPickImage = onPickImage,
                            floating = true,
                            onScreenSettingsOpened = onDismiss,
                            contentPadding =
                                PaddingValues(
                                    top = if (conversation.messages.isEmpty()) 4.dp else 0.dp
                                ),
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun OverlayActions(
    conversation: OverlayConversation,
    screenCapture: ScreenCaptureState,
    onOpenApp: (String?) -> Unit,
    modifier: Modifier = Modifier,
    floating: Boolean = false,
) {
    val colors = LocalKairosColors.current
    // Before the first message these sit straight on the scrim, so they get their own surface.
    val pill = RoundedCornerShape(16.dp)
    val lift =
        if (floating)
            Modifier.shadow(6.dp, pill).background(colors.surface.copy(alpha = 0.96f), pill)
        else Modifier
    Row(modifier.fillMaxWidth().height(40.dp), verticalAlignment = Alignment.CenterVertically) {
        ScreenshotControl(screenCapture, lift)
        Spacer(Modifier.weight(1f))
        Row(
            lift
                .height(32.dp)
                .pressable(pill) { conversation.requestOpen(onOpenApp) }
                .padding(start = 12.dp, end = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            Text(
                if (conversation.messages.isEmpty()) "Open Kairos" else "Open in Kairos",
                color = colors.p(800),
                fontWeight = FontWeight.Medium,
            )
            KIcon(KairosIcons.ArrowUpRight01, colors.p(600), size = 20.dp)
        }
    }
}

/** Screenshot attachment control where the brand mark used to be. */
@Composable
private fun ScreenshotControl(screenCapture: ScreenCaptureState, modifier: Modifier = Modifier) {
    val colors = LocalKairosColors.current
    when (val attached = screenCapture.attached) {
        null ->
            Row(
                modifier
                    .height(32.dp)
                    .pressable(RoundedCornerShape(16.dp)) { screenCapture.attach() }
                    .padding(start = 8.dp, end = 12.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                KIcon(
                    KairosIcons.SmartPhone01,
                    if (screenCapture.available) colors.p(900) else colors.p(500),
                )
                Text(
                    if (screenCapture.available) "Attach screen" else "Screen unavailable",
                    color = if (screenCapture.available) colors.p(900) else colors.p(500),
                    fontWeight = FontWeight.Medium,
                )
            }
        else ->
            Row(
                modifier
                    .height(32.dp)
                    .background(colors.p(100), RoundedCornerShape(16.dp))
                    .padding(start = 4.dp, end = 4.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(4.dp),
            ) {
                ScreenThumbnail(
                    attached,
                    Modifier.size(24.dp).clip(RoundedCornerShape(6.dp)),
                    crop = true,
                )
                GhostIconButton(
                    KairosIcons.Cancel01,
                    "Remove screenshot",
                    screenCapture::remove,
                    tint = colors.p(700),
                    size = 24.dp,
                )
            }
    }
}
