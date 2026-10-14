@file:OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)

package org.kairos.android.ui

import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
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
    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
        modifier = modifier.border(1.dp, colors.p(200), shape),
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
fun SheetAction(icon: ImageVector, label: String, onClick: () -> Unit) {
    val colors = LocalKairosColors.current
    Row(
        Modifier.fillMaxWidth()
            .height(48.dp)
            .pressable(pressedColor = colors.p(100), onClick = onClick)
            .padding(horizontal = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        KIcon(icon, colors.p(900))
        Text(label, color = colors.p(900))
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
) {
    var delete by remember { mutableStateOf(false) }
    KairosSheet(onDismiss) {
        SheetAction(KairosIcons.Copy01, "Copy") {
            onCopy(message.copyText())
            onDismiss()
        }
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
    KairosSheet(onDismiss) {
        KairosField(query, { query = it }, "Search models", search = true)
        Column(
            Modifier.heightIn(max = 480.dp)
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
                                if (catalog.capabilities.canSelectModel) {
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
                            if (model.key == (chat.activeSession?.settings?.model ?: chat.model))
                                KIcon(KairosIcons.Tick02, colors.p(900))
                        }
                    }
                }
        }
    }
}

@Composable
fun SearchSheet(chat: ChatViewModel, onDismiss: () -> Unit, onSelect: (String) -> Unit) {
    val colors = LocalKairosColors.current
    var query by remember { mutableStateOf("") }
    var results by remember { mutableStateOf<List<SearchResult>>(emptyList()) }
    var error by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(query) {
        delay(200)
        try {
            results = chat.app.sessions.search(query)
            error = null
        } catch (e: Exception) {
            if (e is kotlinx.coroutines.CancellationException) throw e
            error = e.message
        }
    }
    KairosSheet(onDismiss, Modifier.fillMaxHeight()) {
        KairosField(query, { query = it }, "Search sessions", search = true)
        error?.let {
            Spacer(Modifier.height(12.dp))
            ErrorBox(it)
        }
        Column(
            Modifier.fillMaxHeight().verticalScroll(rememberScrollState()).padding(top = 16.dp)
        ) {
            results.forEach { result ->
                Column(
                    Modifier.fillMaxWidth()
                        .pressable { onSelect(result.friendlyId) }
                        .padding(vertical = 12.dp),
                    verticalArrangement = Arrangement.spacedBy(4.dp),
                ) {
                    Text(
                        result.displayTitle,
                        color = colors.p(900),
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                    Text(
                        result.snippet,
                        color = colors.p(500),
                        fontSize = 12.sp,
                        maxLines = 2,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
            }
        }
    }
}

@Composable
fun ActivitySheet(turn: JsonObject, onDismiss: () -> Unit) {
    val colors = LocalKairosColors.current
    val steps =
        (turn["steps"] as? JsonArray)
            ?.mapNotNull { it as? JsonObject }
            .orEmpty()
            .ifEmpty { listOf(turn) }
    KairosSheet(onDismiss) {
        Text("Activity", fontWeight = FontWeight.Medium, color = colors.p(900))
        Column(
            Modifier.heightIn(max = 520.dp)
                .verticalScroll(rememberScrollState())
                .padding(top = 12.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            steps.forEach { step ->
                if (step.role == "toolResult")
                    Text(
                        "${step.string("toolName") ?: "Tool"} · ${if ((step["isError"] as? JsonPrimitive)?.booleanOrNull == true) "Failed" else "Completed"}",
                        color = colors.p(600),
                        fontSize = 12.sp,
                    )
                step.parts().forEach { part ->
                    when (part.string("type")) {
                        "thinking" -> Text(part.string("thinking").orEmpty(), color = colors.p(700))
                        "toolCall" ->
                            Text(
                                "${part.string("name") ?: "Tool"} · ${part.string("status") ?: "Running"}",
                                color = colors.p(700),
                            )
                        "text" ->
                            if (part.string("phase") == "commentary")
                                Text(part.string("text").orEmpty(), color = colors.p(700))
                    }
                }
            }
        }
    }
}
