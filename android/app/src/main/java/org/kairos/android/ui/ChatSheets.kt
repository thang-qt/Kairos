@file:OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)

package org.kairos.android.ui

import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.composed
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.delay
import kotlinx.serialization.json.*
import org.kairos.android.chat.ChatViewModel
import org.kairos.android.data.*
import org.kairos.android.ui.icons.KairosIcons
import org.kairos.android.ui.theme.LocalKairosColors

@Composable
fun KairosSheet(
    onDismiss: () -> Unit,
    modifier: Modifier = Modifier,
    content: @Composable ColumnScope.() -> Unit,
) {
    val colors = LocalKairosColors.current
    val shape = RoundedCornerShape(topStart = 16.dp, topEnd = 16.dp)
    // No outline: a full-width border reads as a stray line across the screen. The scrim and
    // the surface step provide the separation instead.
    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
        shape = shape,
        containerColor = colors.p(50),
        contentColor = colors.p(900),
        tonalElevation = 0.dp,
        scrimColor = colors.p(950).copy(alpha = 0.2f),
        dragHandle = {
            Box(
                Modifier.padding(vertical = 12.dp)
                    .size(40.dp, 4.dp)
                    .background(colors.p(300), RoundedCornerShape(2.dp))
            )
        },
    ) {
        Column(
            Modifier.fillMaxWidth()
                .padding(start = 16.dp, end = 16.dp, bottom = 16.dp)
                .navigationBarsPadding(),
            content = content,
        )
    }
}

@Composable
fun SheetAction(
    icon: ImageVector,
    label: String,
    enabled: Boolean = true,
    onClick: () -> Unit,
) {
    val colors = LocalKairosColors.current
    Row(
        Modifier.fillMaxWidth()
            .height(48.dp)
            .pressable(pressedColor = colors.p(100), enabled = enabled, onClick = onClick)
            .padding(horizontal = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        KIcon(icon, if (enabled) colors.p(900) else colors.p(400))
        Text(label, color = if (enabled) colors.p(900) else colors.p(400))
    }
}

/** Chooses between the system screenshot and the photo library where both exist. */
@Composable
fun AttachmentChoiceSheet(
    screenCaptureAvailable: Boolean,
    onScreen: () -> Unit,
    onLibrary: () -> Unit,
    onDismiss: () -> Unit,
) {
    KairosSheet(onDismiss) {
        Text("Attach", fontWeight = FontWeight.Medium)
        Spacer(Modifier.height(8.dp))
        SheetAction(KairosIcons.SmartPhone01, "Attach current screen", enabled = screenCaptureAvailable, onClick = onScreen)
        SheetAction(KairosIcons.PlusSign, "Choose image from library", onClick = onLibrary)
        if (!screenCaptureAvailable)
            Text(
                "Turn on 'Use screenshot' in the digital assistant settings to attach the current screen.",
                color = LocalKairosColors.current.p(500),
                fontSize = 12.sp,
                lineHeight = 16.sp,
            )
    }
}

@Composable
fun SessionActionsSheet(
    session: SessionSummary,
    chat: ChatViewModel,
    onDismiss: () -> Unit,
    allowFork: Boolean = false,
) {
    var rename by remember { mutableStateOf(false) }
    var delete by remember { mutableStateOf(false) }
    var title by remember(session.friendlyId) { mutableStateOf(session.displayTitle) }
    KairosSheet(onDismiss) {
        SheetAction(KairosIcons.Pen01, "Rename") { rename = true }
        SheetAction(KairosIcons.Pin, if (session.isPinned) "Unpin" else "Pin") {
            chat.pin(session)
            onDismiss()
        }
        SheetAction(KairosIcons.Settings02, "Chat settings") {
            chat.openConversationSettings()
            onDismiss()
        }
        if (allowFork)
            SheetAction(KairosIcons.CopyLink, "Fork") {
                chat.fork()
                onDismiss()
            }
        SheetAction(KairosIcons.Delete01, "Delete") { delete = true }
    }
    if (rename)
        KairosDialog("Rename conversation", { rename = false }) {
            KairosField(title, { title = it })
            Row(
                horizontalArrangement = Arrangement.spacedBy(12.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text("Cancel", Modifier.weight(1f).pressable { rename = false }.padding(10.dp))
                PrimaryButton("Save", modifier = Modifier.weight(1f)) {
                    chat.rename(session, title)
                    onDismiss()
                }
            }
        }
    if (delete)
        ConfirmDialog("Delete this conversation?", "Delete", { delete = false }) {
            chat.deleteSession(session)
            onDismiss()
        }
}

@Composable
fun MessageActionsSheet(
    message: JsonObject,
    chat: ChatViewModel,
    onDismiss: () -> Unit,
    onCopy: (String) -> Unit,
    ephemeral: Boolean = false,
) {
    var delete by remember { mutableStateOf(false) }
    KairosSheet(onDismiss) {
        SheetAction(KairosIcons.Copy01, "Copy") {
            onCopy(message.copyText())
            onDismiss()
        }
        // Throwaway turns are memory-only: copy stays, mutations are meaningless.
        if (ephemeral) return@KairosSheet
        if (message.role == "user")
            SheetAction(KairosIcons.PencilEdit02, "Edit") {
                chat.edit(message)
                onDismiss()
            }
        SheetAction(KairosIcons.CopyLink, "Fork") {
            chat.fork(message)
            onDismiss()
        }
        SheetAction(KairosIcons.Delete01, "Delete") { delete = true }
        if (
            message.role == "assistant" &&
                message.canRetry &&
                message.status in listOf("error", "interrupted")
        )
            SheetAction(KairosIcons.Refresh, "Retry") {
                chat.retry(message)
                onDismiss()
            }
    }
    if (delete)
        ConfirmDialog(
            "Delete this message and everything after it?",
            "Delete",
            { delete = false },
        ) {
            chat.deleteMessage(message)
            onDismiss()
        }
}

@Composable
fun ModelsSheet(chat: ChatViewModel, onDismiss: () -> Unit) {
    val colors = LocalKairosColors.current
    val catalog by chat.catalog.collectAsState()
    var query by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    val activeModel = chat.activeSession?.settings?.model?.ifBlank { chat.model } ?: chat.model
    KairosSheet(onDismiss) {
        Text(
            "Model",
            color = colors.p(900),
            fontWeight = FontWeight.Medium,
        )
        Spacer(Modifier.height(12.dp))
        KairosField(query, { query = it }, "Search models", search = true)
        Column(
            Modifier.heightIn(max = 420.dp)
                .verticalScroll(rememberScrollState())
                .padding(top = 16.dp)
        ) {
            if (!catalog.capabilities.canSelectModel)
                Text(
                    "Model selection is managed by your server.",
                    color = colors.p(500),
                    fontSize = 12.sp,
                )
            catalog.models
                .filter {
                    query.isBlank() ||
                        (it.displayName + it.providerLabel).contains(query, ignoreCase = true)
                }
                .groupBy { it.providerLabel.ifBlank { it.providerRef.ifBlank { "Models" } } }
                .forEach { (provider, models) ->
                    Text(
                        provider,
                        Modifier.padding(vertical = 8.dp),
                        color = colors.p(500),
                        fontSize = 12.sp,
                    )
                    models.forEach { model ->
                        Row(
                            Modifier.fillMaxWidth().height(48.dp).pressable {
                                if (catalog.capabilities.canSelectModel && !busy) {
                                    busy = true
                                    chat.chooseModel(model.key)
                                    onDismiss()
                                }
                            },
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Column(Modifier.weight(1f)) {
                                Text(
                                    model.displayName,
                                    color = colors.p(900),
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis,
                                )
                                val context =
                                    if (model.contextWindow > 0)
                                        "${model.contextWindow / 1000}K context"
                                    else "Context not specified"
                                Text(
                                    context,
                                    color = colors.p(500),
                                    fontSize = 12.sp,
                                    style = TextStyle(fontFeatureSettings = "tnum"),
                                )
                            }
                            if (model.key == activeModel) KIcon(KairosIcons.Tick02, colors.p(900))
                            if (
                                catalog.capabilities.canSelectModel &&
                                    model.key == activeModel &&
                                    model.key != catalog.preferences.defaultModelId &&
                                    !catalog.capabilities.defaultModelLocked
                            )
                                Text(
                                    "Set default",
                                    Modifier
                                        .pressable(pressedColor = colors.p(200)) {
                                            if (!busy) {
                                                busy = true
                                                chat.setDefaultModel(model.key)
                                                onDismiss()
                                            }
                                        }
                                        .padding(horizontal = 10.dp, vertical = 6.dp),
                                    color = colors.p(700),
                                    fontSize = 12.sp,
                                )
                        }
                    }
                }
        }
    }
}

@Composable
fun ActivitySheet(turn: JsonObject, onDismiss: () -> Unit) {
    val colors = LocalKairosColors.current
    val split = remember(turn) { splitAssistantActivity(turn) }
    val streaming = split.let { isAssistantStreaming(turn) }
    val indexes = visibleActivityIndexes(turn, split.activityIndexes, streaming)
    val steps = remember(indexes, turn) { activitySteps(turn, indexes) }
    var now by remember { mutableLongStateOf(System.currentTimeMillis()) }
    LaunchedEffect(streaming) {
        while (streaming) {
            now = System.currentTimeMillis()
            kotlinx.coroutines.delay(1000)
        }
    }
    KairosSheet(onDismiss) {
        Row(
            Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Text("Activity", fontWeight = FontWeight.Medium, color = colors.p(900))
            Spacer(Modifier.weight(1f))
            Text(
                if (streaming)
                    formatElapsed(split.durationMs + (now - (turn.timestampLong() ?: now)).coerceAtLeast(0))
                else if (split.durationMs > 0) formatActivityDuration(split.durationMs)
                else "",
                color = colors.p(500),
                fontSize = 12.sp,
                style = TextStyle(fontFeatureSettings = "tnum"),
            )
        }
        Column(
            Modifier.heightIn(max = 440.dp)
                .verticalScroll(rememberScrollState())
                .padding(top = 14.dp),
            verticalArrangement = Arrangement.spacedBy(0.dp),
        ) {
            if (steps.isEmpty())
                Text(
                    "This response has no thinking or tool activity to show.",
                    color = colors.p(500),
                    fontSize = 13.sp,
                    lineHeight = 18.sp,
                    modifier = Modifier.padding(vertical = 24.dp),
                )
            steps.forEachIndexed { order, step ->
                ActivityRow(step, order < steps.lastIndex)
            }
        }
    }
}

private fun JsonObject.timestampLong(): Long? = normalizeMessageTimestamp(this["timestamp"])

private fun formatElapsed(elapsedMs: Long): String = formatActivityDuration(elapsedMs.coerceAtLeast(0))

@Composable
private fun ActivityRow(step: ActivityStep, hasConnector: Boolean) {
    val colors = LocalKairosColors.current
    Row(Modifier.fillMaxWidth().height(IntrinsicSize.Min)) {
        Column(Modifier.width(24.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            Box(Modifier.height(24.dp), contentAlignment = Alignment.Center) {
                when (step) {
                    is ActivityStep.Thinking -> KIcon(KairosIcons.AiMagic, colors.p(500), size = 20.dp)
                    is ActivityStep.Narration ->
                        Box(Modifier.size(6.dp).background(colors.p(300), CircleShape))
                    is ActivityStep.Tool ->
                        KIcon(
                            when {
                                step.failed -> KairosIcons.AlertCircle
                                step.web -> KairosIcons.Search01
                                else -> KairosIcons.Settings02
                            },
                            if (step.running) colors.p(800) else colors.p(500),
                            size = 20.dp,
                        )
                }
            }
            if (hasConnector)
                Box(Modifier.width(1.dp).fillMaxHeight().background(colors.p(200)))
        }
        Column(Modifier.weight(1f).padding(start = 10.dp, bottom = 18.dp)) {
            when (step) {
                is ActivityStep.Thinking -> ThinkingStep(step)
                is ActivityStep.Narration ->
                    Text(step.text, color = colors.p(700), fontSize = 13.sp, lineHeight = 19.sp)
                is ActivityStep.Tool -> {
                    Text(
                        step.title,
                        color = colors.p(800),
                        fontSize = 14.sp,
                        lineHeight = 20.sp,
                        maxLines = 2,
                        overflow = TextOverflow.Ellipsis,
                        modifier =
                            if (step.running)
                                Modifier.pulsing()
                            else Modifier,
                    )
                    if (step.meta.isNotEmpty())
                        Text(
                            step.meta,
                            color = colors.p(500),
                            fontSize = 12.sp,
                            lineHeight = 16.sp,
                            maxLines = 2,
                            overflow = TextOverflow.Ellipsis,
                            style = TextStyle(fontFeatureSettings = "tnum"),
                        )
                    if (step.web && step.sources.isNotEmpty()) {
                        Spacer(Modifier.height(4.dp))
                        step.sources.take(3).forEach { source ->
                            Text(
                                source.title,
                                color = colors.p(500),
                                fontSize = 12.sp,
                                lineHeight = 16.sp,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                                modifier =
                                    Modifier.pressable(onClick = { openBrowserQuietly(source.url) })
                                        .padding(vertical = 1.dp),
                            )
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun ThinkingStep(step: ActivityStep.Thinking) {
    val colors = LocalKairosColors.current
    var open by remember { mutableStateOf(step.streaming) }
    Row(
        Modifier.pressable(pressedColor = colors.p(200)) { open = !open }.padding(vertical = 1.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        Text(
            if (step.streaming) "Thinking…" else "Thought",
            color = colors.p(800),
            fontSize = 14.sp,
            modifier = if (step.streaming) Modifier.pulsing() else Modifier,
        )
        KIcon(
            KairosIcons.ArrowDown01,
            colors.p(500),
            Modifier.rotate(if (open) 180f else 0f),
            size = 20.dp,
        )
    }
    if (open)
        Text(
            step.content,
            Modifier.padding(top = 2.dp),
            color = colors.p(600),
            fontSize = 13.sp,
            lineHeight = 19.sp,
        )
    else
        Text(
            step.content
                .replace(Regex("[`*_#>\\[\\]]"), "")
                .replace(Regex("\\s+"), " ")
                .trim(),
            Modifier.padding(top = 2.dp),
            color = colors.p(500),
            fontSize = 13.sp,
            lineHeight = 19.sp,
            maxLines = 2,
            overflow = TextOverflow.Ellipsis,
        )
}

private fun Modifier.pulsing(): Modifier = composed {
    val transition = rememberInfiniteTransition(label = "pulse")
    val alpha by
        transition.animateFloat(
            0.45f,
            1f,
            infiniteRepeatable(tween(900, easing = LinearEasing), RepeatMode.Reverse),
            label = "pulse-alpha",
        )
    graphicsLayer { this.alpha = alpha }
}

private fun openBrowserQuietly(url: String) {
    // Overlays open links through their own browser hook; the sheet keeps links inert here.
}
