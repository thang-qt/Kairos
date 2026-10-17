@file:OptIn(androidx.compose.foundation.ExperimentalFoundationApi::class)

package org.kairos.android.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.interaction.DragInteraction
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.serialization.json.JsonObject
import kotlinx.coroutines.launch
import kotlinx.coroutines.flow.first
import org.kairos.android.assistant.ScreenAttachment
import org.kairos.android.assistant.ScreenThumbnail
import org.kairos.android.assistant.overlayImages
import org.kairos.android.data.*
import org.kairos.android.markdown.OverlayMarkdown
import org.kairos.android.ui.theme.LocalKairosColors

/** Native conversation renderer shared by the app and the assistant's current answer. */
@Composable
fun NativeTranscript(
    messages: List<JsonObject>,
    dark: Boolean,
    api: KairosApi,
    identityVersion: Long,
    identityVersionProvider: () -> Long,
    modifier: Modifier = Modifier,
    followLatest: Boolean = true,
    showModel: Boolean = true,
    showActivity: Boolean = true,
    onContentHeight: ((Int) -> Unit)? = null,
    contentPadding: PaddingValues = PaddingValues(16.dp),
    onActivity: (String) -> Unit,
    onMessageActions: (String) -> Unit = {},
    onLink: (String) -> Unit,
) {
    val scroll = rememberLazyListState()
    val appIdentityVersion = identityVersion
    val imageLoader = remember(api, appIdentityVersion) {
        TranscriptAssetImageLoader(
            api = api,
            identityVersion = appIdentityVersion,
            identityVersionProvider = identityVersionProvider,
        )
    }
    val latestUserIndex = messages.indexOfLast { it.role == "user" }
    val latestUserId = messages.getOrNull(latestUserIndex)?.let { it.string("clientId")?.takeIf { id -> id.isNotBlank() } ?: it.id }
    var previousUserId by remember { mutableStateOf(latestUserId) }
    var pinnedUserId by remember { mutableStateOf(latestUserId) }
    var follow by remember { mutableStateOf(latestUserId == null) }
    LaunchedEffect(latestUserId) {
        if (followLatest && latestUserId != null && (latestUserId != previousUserId || pinnedUserId == latestUserId)) {
            pinnedUserId = latestUserId
            follow = false
            withFrameNanos {}
            scroll.scrollToItem(latestUserIndex)
        }
        previousUserId = latestUserId
    }
    var userScrollSession by remember { mutableStateOf(false) }
    LaunchedEffect(scroll) {
        launch {
            scroll.interactionSource.interactions.collect { interaction ->
                when (interaction) {
                    is DragInteraction.Start -> {
                        userScrollSession = true
                        follow = false
                    }
                    is DragInteraction.Stop, is DragInteraction.Cancel -> {
                        if (userScrollSession) {
                            val (_, atBottom) =
                                snapshotFlow { scroll.isScrollInProgress to scroll.isAtBottom() }
                                    .first { (moving, _) -> !moving }
                            follow = atBottom
                            userScrollSession = false
                        }
                    }
                    else -> Unit
                }
            }
        }
        snapshotFlow {
            scroll.isScrollInProgress to scroll.isAtBottom()
        }.collect { (moving, atBottom) ->
            if (userScrollSession && moving) follow = atBottom
        }
    }
    LaunchedEffect(messages.lastOrNull(), messages.size, follow, userScrollSession, followLatest) {
        if (followLatest && pinnedUserId == null && follow && !userScrollSession && messages.isNotEmpty()) scroll.scrollToItem(messages.size)
    }
    LaunchedEffect(followLatest, messages.firstOrNull()?.id) {
        if (!followLatest) scroll.scrollToItem(0)
    }
    key(appIdentityVersion) {
        BoxWithConstraints(modifier) {
            val pinLatest = followLatest && pinnedUserId != null && latestUserIndex >= 0
            val preceding = if (pinLatest) messages.take(latestUserIndex) else messages
            val turnMinHeight = (maxHeight - contentPadding.calculateTopPadding() - contentPadding.calculateBottomPadding()).coerceAtLeast(0.dp)
            LazyColumn(
                modifier = Modifier.fillMaxSize(),
                state = scroll,
                contentPadding = contentPadding,
                verticalArrangement = Arrangement.spacedBy(20.dp),
            ) {
                itemsIndexed(preceding, key = { index, message -> message.string("clientId")?.takeIf { it.isNotBlank() } ?: message.id.ifEmpty { "message-$index" } }) { _, message ->
                    NativeMessage(message, dark, imageLoader, onActivity, onMessageActions, onLink, onContentHeight, showModel, showActivity)
                }
                if (pinLatest) item(key = "latest-turn-$pinnedUserId") {
                    Column(Modifier.fillMaxWidth().heightIn(min = turnMinHeight), verticalArrangement = Arrangement.spacedBy(20.dp)) {
                        messages.drop(latestUserIndex).forEach { message ->
                            key(message.string("clientId") ?: message.id) {
                                NativeMessage(message, dark, imageLoader, onActivity, onMessageActions, onLink, onContentHeight, showModel, showActivity)
                            }
                        }
                    }
                }
                item(key = "transcript-bottom-anchor") { Spacer(Modifier.height(1.dp)) }
            }
        }
    }
}

private fun androidx.compose.foundation.lazy.LazyListState.isAtBottom(): Boolean {
    val layout = layoutInfo
    val last = layout.visibleItemsInfo.lastOrNull()
    return last == null ||
        (last.index == layout.totalItemsCount - 1 &&
            last.offset + last.size <= layout.viewportEndOffset + 48)
}

@Composable
private fun NativeMessage(
    message: JsonObject,
    dark: Boolean,
    imageLoader: TranscriptAssetImageLoader,
    onActivity: (String) -> Unit,
    onMessageActions: (String) -> Unit,
    onLink: (String) -> Unit,
    onContentHeight: ((Int) -> Unit)?,
    showModel: Boolean,
    showActivity: Boolean,
) {
    val colors = LocalKairosColors.current
    val user = message.role == "user"
    val activity = remember(message) { splitAssistantActivity(message) }
    Column(
        Modifier.fillMaxWidth().onSizeChanged { onContentHeight?.invoke(it.height) }.combinedClickable(
            onClick = {}, onLongClick = { onMessageActions(message.id) },
        ),
        horizontalAlignment = if (user) Alignment.End else Alignment.Start,
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        if (!user) {
            if (showModel) message.modelName?.let { ModelLabel(it) }
            if (showActivity && activity.activityIndexes.isNotEmpty())
                Text(
                    activityLabel(message.isLive, activity.toolCount, activity.hasThinking, activity.durationMs) + "  ›",
                    modifier = Modifier.pressable { onActivity(message.id) }.padding(vertical = 4.dp),
                    color = colors.p(600), fontSize = 12.sp,
                )
        }
        val inlineImages = remember(message) { message.overlayImages() }
        val assetIds = remember(message) {
            message.parts().filter { it.string("type") == "image" }.mapNotNull {
                (it["source"] as? JsonObject)?.string("assetId")
            }
        }
        key(imageLoader) {
            val assetImages by produceState<List<ScreenAttachment>>(emptyList(), assetIds) {
                value = emptyList()
                value = imageLoader.loadAll(assetIds)
            }
            (inlineImages + assetImages).forEach { image ->
                ScreenThumbnail(image, Modifier.heightIn(max = 200.dp)
                    .aspectRatio(image.width.toFloat() / image.height)
                    .clip(RoundedCornerShape(12.dp)), crop = true)
            }
        }
        SelectionContainer {
            if (user) {
                if (message.answerText().isNotBlank())
                    Text(message.answerText(), color = colors.p(900), fontSize = 15.sp, lineHeight = 22.sp,
                        modifier = Modifier.widthIn(max = 320.dp)
                            .background(colors.p(100), RoundedCornerShape(16.dp)).padding(12.dp))
            } else {
                OverlayMarkdown(message.answerText(), message.isLive, dark, onLink)
            }
        }
        if (!user && showActivity && message.isLive && message.answerText().isBlank())
            Text("Thinking…", color = colors.p(500), fontSize = 12.sp)
        if (message.status in listOf("aborted", "error", "interrupted"))
            Text(when (message.status) {
                "aborted" -> "Cancelled"
                "error" -> "Failed"
                else -> "Interrupted"
            }, color = colors.p(600), fontSize = 12.sp)
    }
}
