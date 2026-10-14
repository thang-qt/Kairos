package org.kairos.android.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.disabled
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import org.kairos.android.assistant.ScreenAttachment
import org.kairos.android.assistant.ScreenCaptureState
import org.kairos.android.assistant.ScreenThumbnail
import org.kairos.android.assistant.openAssistantSettings
import org.kairos.android.ui.icons.KairosIcons
import org.kairos.android.ui.theme.LocalKairosColors

private const val SCREEN_HINT =
    "Turn on 'Use text from screen' and 'Use screenshot' in Digital assistant settings"

/** src/features/chat/components/chat-composer.tsx with prompt-kit/prompt-input.tsx. */
@Composable
fun NativeComposer(
    streaming: Boolean,
    enabled: Boolean = true,
    onSend: (String) -> Unit,
    onStop: () -> Unit,
    modifier: Modifier = Modifier,
    focusRequestKey: Int? = null,
    initialDraft: String = "",
    editing: Boolean = false,
    onCancelEdit: () -> Unit = {},
    attachments: List<ScreenAttachment> = emptyList(),
    onRemoveAttachment: (ScreenAttachment) -> Unit = {},
    onAttach: () -> Unit = {},
    onBodyHeight: (Int) -> Unit = {},
    screenCapture: ScreenCaptureState? = null,
    floating: Boolean = false,
    onScreenSettingsOpened: () -> Unit = {},
    contentPadding: PaddingValues = PaddingValues(start = 20.dp, end = 20.dp, bottom = 12.dp),
) {
    val colors = LocalKairosColors.current
    val context = LocalContext.current
    val focusRequester = remember { FocusRequester() }
    val keyboard = LocalSoftwareKeyboardController.current
    var draft by remember(focusRequestKey) { mutableStateOf(initialDraft) }
    LaunchedEffect(focusRequestKey) {
        if (focusRequestKey != null) {
            withFrameNanos {}
            focusRequester.requestFocus()
            keyboard?.show()
        }
    }
    fun submit() {
        if (
            enabled &&
                (draft.isNotBlank() ||
                    (!editing && (screenCapture?.attached != null || attachments.isNotEmpty())))
        ) {
            onSend(draft.trim())
            draft = ""
        }
    }
    Column(modifier.onSizeChanged { onBodyHeight(it.height) }.padding(contentPadding)) {
        if (editing)
            Row(
                Modifier.fillMaxWidth().padding(bottom = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    "Editing message",
                    Modifier.weight(1f),
                    color = colors.p(600),
                    fontSize = 12.sp,
                )
                Text(
                    "Cancel",
                    Modifier.pressable(onClick = onCancelEdit).padding(6.dp),
                    color = colors.p(900),
                )
            }
        if (screenCapture?.showSettingsHint == true) {
            Row(
                Modifier.padding(bottom = 8.dp)
                    .shadow(if (floating) 6.dp else 0.dp, RoundedCornerShape(8.dp))
                    .background(colors.p(50), RoundedCornerShape(8.dp))
                    .border(1.dp, colors.p(200), RoundedCornerShape(8.dp))
                    .semantics { contentDescription = "$SCREEN_HINT. Open settings" }
                    .pressable(pressedColor = colors.p(100)) {
                        openAssistantSettings(context)
                        onScreenSettingsOpened()
                    }
                    .padding(horizontal = 10.dp, vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Text(
                    SCREEN_HINT,
                    Modifier.weight(1f, fill = false),
                    color = colors.p(800),
                    fontSize = 12.sp,
                    lineHeight = 16.sp,
                )
                KIcon(KairosIcons.ArrowUpRight01, colors.p(600), size = 20.dp)
            }
        }
        val shape = RoundedCornerShape(22.dp)
        Column(
            Modifier.fillMaxWidth()
                // shadow-[0px_12px_32px_0px_rgba(0,0,0,0.05)]; the overlay needs more lift over
                // other apps.
                .shadow(
                    if (floating) 16.dp else 12.dp,
                    shape,
                    ambientColor = colors.ink.copy(alpha = 0.05f),
                    spotColor = colors.ink.copy(alpha = if (floating) 0.2f else 0.08f),
                )
                .background(colors.surface.copy(alpha = if (floating) 0.96f else 0.86f), shape)
                .border(1.dp, colors.ink.copy(alpha = 0.1f), shape)
        ) {
            if (attachments.isNotEmpty())
                Row(
                    Modifier.padding(start = 16.dp, end = 16.dp, top = 12.dp)
                        .horizontalScroll(androidx.compose.foundation.rememberScrollState()),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    attachments.forEach { attachment ->
                        ScreenAttachmentChip(attachment, { onRemoveAttachment(attachment) })
                    }
                }
            screenCapture?.attached?.let { attachment ->
                ScreenAttachmentChip(
                    attachment,
                    screenCapture::remove,
                    Modifier.padding(start = 16.dp, end = 16.dp, top = 12.dp),
                )
            }
            Row(
                Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 9.dp),
                verticalAlignment = Alignment.Bottom,
                horizontalArrangement = Arrangement.spacedBy(4.dp),
            ) {
                if (screenCapture == null) {
                    GhostIconButton(
                        KairosIcons.PlusSign,
                        "Attach image",
                        { if (!editing) onAttach() },
                        tint = colors.p(900),
                        round = true,
                    )
                } else {
                    // Unavailable looks disabled, but a tap still explains the system toggle.
                    GhostIconButton(
                        KairosIcons.SmartPhone01,
                        "Attach screen",
                        screenCapture::attach,
                        Modifier.alpha(if (screenCapture.available) 1f else 0.5f).semantics {
                            if (!screenCapture.available) disabled()
                        },
                        tint = colors.p(900),
                        round = true,
                    )
                }
                BasicTextField(
                    value = draft,
                    onValueChange = { draft = it },
                    maxLines = 8,
                    textStyle =
                        TextStyle(
                            color = colors.p(950),
                            fontSize = 15.sp,
                            lineHeight = 22.sp,
                            letterSpacing = (-0.15).sp,
                            fontFamily = FontFamily.SansSerif,
                        ),
                    cursorBrush = SolidColor(colors.p(950)),
                    modifier =
                        Modifier.weight(1f)
                            .heightIn(min = 32.dp)
                            .padding(start = 8.dp, end = 4.dp, top = 5.dp, bottom = 5.dp)
                            .focusRequester(focusRequester),
                    decorationBox = { inner ->
                        if (draft.isEmpty())
                            Text(
                                "Type a message…",
                                color = colors.p(500),
                                fontSize = 15.sp,
                                lineHeight = 22.sp,
                                maxLines = 1,
                            )
                        inner()
                    },
                )
                if (streaming) {
                    // Button variant="outline" size="sm", rounded-full.
                    Box(
                        Modifier.height(32.dp)
                            .clip(CircleShape)
                            .border(1.dp, colors.p(900).copy(alpha = 0.1f), CircleShape)
                            .semantics { contentDescription = "Stop response" }
                            .pressable(CircleShape, pressedColor = colors.p(50), onClick = onStop)
                            .padding(horizontal = 12.dp),
                        contentAlignment = Alignment.Center,
                    ) {
                        Text("Stop", color = colors.p(900), fontWeight = FontWeight.Medium)
                    }
                } else {
                    Box(
                        Modifier.size(32.dp)
                            .background(colors.p(950), CircleShape)
                            .semantics { contentDescription = "Send message" }
                            .pressable(
                                CircleShape,
                                pressedColor = colors.p(900),
                                role = Role.Button,
                                onClick = ::submit,
                            ),
                        contentAlignment = Alignment.Center,
                    ) {
                        KIcon(KairosIcons.ArrowUp02, colors.p(50))
                    }
                }
            }
        }
    }
}

/** composer/attachment-preview.tsx: thumbnail, name and meta, round remove button. */
@Composable
private fun ScreenAttachmentChip(
    attachment: ScreenAttachment,
    onRemove: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val colors = LocalKairosColors.current
    Row(
        modifier
            .widthIn(max = 220.dp)
            .background(colors.p(50), RoundedCornerShape(8.dp))
            .border(1.dp, colors.p(200), RoundedCornerShape(8.dp))
            .padding(4.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        ScreenThumbnail(
            attachment,
            Modifier.size(36.dp).clip(RoundedCornerShape(4.dp)),
            crop = true,
        )
        Column(Modifier.weight(1f, fill = false)) {
            Text(
                attachment.name,
                color = colors.p(900),
                fontSize = 12.sp,
                lineHeight = 16.sp,
                fontWeight = FontWeight.Medium,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Text(
                "${if (attachment.mimeType == "image/png") "PNG" else "JPG"} • ${attachment.width}×${attachment.height}",
                color = colors.p(500),
                fontSize = 11.sp,
                lineHeight = 14.sp,
                style = TextStyle(fontFeatureSettings = "tnum"),
            )
        }
        GhostIconButton(
            KairosIcons.Cancel01,
            "Remove attachment",
            onRemove,
            tint = colors.p(800),
            round = true,
            size = 32.dp,
        )
    }
}
