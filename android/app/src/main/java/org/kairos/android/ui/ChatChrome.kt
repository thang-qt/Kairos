@file:OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)

package org.kairos.android.ui

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import org.kairos.android.chat.ChatViewModel
import org.kairos.android.data.SessionGroup
import org.kairos.android.data.SessionSummary
import org.kairos.android.data.groupSessions
import org.kairos.android.ui.icons.KairosIcons
import org.kairos.android.ui.theme.LocalKairosColors

/**
 * src/features/chat/components/chat-header.tsx at phone width (the title is hidden below `sm`),
 * over the app-shell fade: solid surface → 93% at 35% → 80% at 60% → clear at 80dp.
 */
@Composable
fun ChatHeader(chat: ChatViewModel, onOpenSidebar: () -> Unit) {
    val colors = LocalKairosColors.current
    val sessions by chat.sessions.collectAsState()
    val catalog by chat.catalog.collectAsState()
    val modelKey =
        sessions.find { it.friendlyId == chat.sessionId }?.settings?.model?.ifBlank { chat.model }
            ?: chat.model
    val modelLabel =
        catalog.models.find { it.key == modelKey || it.id == modelKey }?.displayName
            ?: modelKey.ifBlank { "Select model" }
    var models by remember { mutableStateOf(false) }
    var more by remember { mutableStateOf(false) }
    Column(Modifier.fillMaxWidth()) {
        Spacer(
            Modifier.fillMaxWidth()
                .windowInsetsTopHeight(WindowInsets.statusBars)
                .background(colors.surface)
        )
        Box(
            Modifier.fillMaxWidth()
                .height(80.dp)
                .background(
                    Brush.verticalGradient(
                        0f to colors.surface,
                        0.35f to colors.surface.copy(alpha = 0.93f),
                        0.6f to colors.surface.copy(alpha = 0.8f),
                        1f to colors.surface.copy(alpha = 0f),
                    )
                )
        ) {
            Row(
                Modifier.fillMaxWidth().height(48.dp).padding(horizontal = 16.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                GhostIconButton(
                    KairosIcons.SidebarLeft01,
                    "Open sidebar",
                    onOpenSidebar,
                    Modifier.padding(end = 12.dp),
                )
                // Conversation model picker.
                Row(
                    Modifier.pressable(RoundedCornerShape(8.dp), pressedColor = colors.p(100)) {
                            models = true
                        }
                        .padding(horizontal = 6.dp, vertical = 4.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                ) {
                    Text(
                        modelLabel,
                        color = colors.p(700),
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.widthIn(max = 220.dp),
                    )
                    KIcon(KairosIcons.ArrowDown01, colors.p(500), size = 20.dp)
                }
                Spacer(Modifier.weight(1f))
                GhostIconButton(
                    KairosIcons.MoreVertical,
                    "Conversation actions",
                    { if (chat.activeSession != null) more = true },
                    tint = colors.p(700),
                )
            }
        }
    }
    if (models) ModelsSheet(chat, { models = false })
    if (more)
        chat.activeSession?.let {
            SessionActionsSheet(it, chat, { more = false }, allowFork = true)
        }
}

/** src/features/chat/components/chat-sidebar.tsx, full width for the swipe drawer. */
@Composable
fun Sidebar(
    chat: ChatViewModel,
    modifier: Modifier,
    onSelect: (SessionSummary) -> Unit,
    onNew: () -> Unit,
    onClose: () -> Unit,
) {
    val colors = LocalKairosColors.current
    val sessions by chat.sessions.collectAsState()
    var search by remember { mutableStateOf(false) }
    var actions by remember { mutableStateOf<SessionSummary?>(null) }
    var logout by remember { mutableStateOf(false) }
    Column(modifier.background(colors.p(100)).statusBarsPadding()) {
        Row(
            Modifier.fillMaxWidth().height(48.dp).padding(horizontal = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Row(
                Modifier.height(32.dp)
                    .pressable(onClick = onNew)
                    .padding(start = 6.dp, end = 12.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                KairosMark()
                Text("Kairos", fontWeight = FontWeight.Medium, color = colors.p(900))
            }
            Spacer(Modifier.weight(1f))
            GhostIconButton(
                KairosIcons.SidebarLeft01,
                "Close sidebar",
                onClose,
                tint = colors.p(900),
            )
        }
        Column(
            Modifier.padding(start = 8.dp, end = 8.dp, bottom = 16.dp),
            verticalArrangement = Arrangement.spacedBy(1.dp),
        ) {
            SidebarAction(KairosIcons.PencilEdit02, "New Session", onClick = onNew)
            SidebarAction(KairosIcons.Search01, "Search sessions", onClick = { search = true })
        }
        Column(
            Modifier.weight(1f)
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 8.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            groupSessions(sessions).forEach { group ->
                key(group.label) {
                    SessionSection(group) { session ->
                        key(session.friendlyId) {
                            SessionItem(
                                session.displayTitle,
                                session.friendlyId == chat.sessionId,
                                { actions = session },
                            ) {
                                onSelect(session)
                            }
                        }
                    }
                }
            }
            Spacer(Modifier.height(8.dp))
        }
        Row(
            Modifier.fillMaxWidth()
                .background(colors.p(100))
                .drawBehind {
                    drawLine(colors.p(200), Offset.Zero, Offset(size.width, 0f), 1.dp.toPx())
                }
                .navigationBarsPadding()
                .padding(horizontal = 8.dp, vertical = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            SidebarAction(KairosIcons.Settings01, "Settings", Modifier.weight(1f)) {
                chat.settings()
            }
            GhostIconButton(
                KairosIcons.Logout01,
                "Sign out",
                { logout = true },
                tint = colors.p(700),
            )
        }
    }
    if (search)
        SearchSheet(chat, { search = false }) { id ->
            chat.select(id)
            search = false
            onClose()
        }
    actions?.let { session -> SessionActionsSheet(session, chat, { actions = null }) }
    if (logout)
        ConfirmDialog("Sign out of Kairos?", "Sign out", { logout = false }) {
            logout = false
            chat.logout()
        }
}

/** The web's ghost `sm` button with an icon: 32dp, pl-1.5, gap-2, medium text. */
@Composable
fun SidebarAction(
    icon: ImageVector,
    label: String,
    modifier: Modifier = Modifier,
    trailing: (@Composable () -> Unit)? = null,
    onClick: () -> Unit,
) {
    val colors = LocalKairosColors.current
    Row(
        modifier
            .fillMaxWidth()
            .height(32.dp)
            .pressable(onClick = onClick)
            .padding(start = 6.dp, end = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        KIcon(icon, colors.p(900))
        Text(
            label,
            Modifier.weight(1f),
            color = colors.p(900),
            fontWeight = FontWeight.Medium,
            maxLines = 1,
            overflow = TextOverflow.Clip,
        )
        trailing?.invoke()
    }
}

@Composable
private fun SessionSection(group: SessionGroup, item: @Composable (SessionSummary) -> Unit) {
    val colors = LocalKairosColors.current
    var open by remember { mutableStateOf(true) }
    val rotation by animateFloatAsState(if (open) 90f else 0f, tween(150), label = "section-arrow")
    Column(Modifier.fillMaxWidth()) {
        Row(
            Modifier.fillMaxWidth()
                .height(32.dp)
                .pressable { open = !open }
                .padding(horizontal = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                group.label,
                Modifier.weight(1f),
                color = colors.p(700),
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            KIcon(KairosIcons.ArrowRight01, colors.p(500), Modifier.rotate(rotation), size = 20.dp)
        }
        AnimatedVisibility(
            open,
            enter = expandVertically(tween(150)) + fadeIn(tween(150)),
            exit = shrinkVertically(tween(150)) + fadeOut(tween(150)),
        ) {
            Column(Modifier.padding(top = 4.dp), verticalArrangement = Arrangement.spacedBy(1.dp)) {
                group.sessions.forEach { item(it) }
            }
        }
    }
}

/** src/features/chat/components/sidebar/session-item.tsx */
@Composable
private fun SessionItem(
    title: String,
    active: Boolean,
    onLongPress: () -> Unit,
    onClick: () -> Unit,
) {
    val colors = LocalKairosColors.current
    val shape = RoundedCornerShape(8.dp)
    Box(
        Modifier.fillMaxWidth()
            .height(32.dp)
            .background(if (active) colors.p(200) else Color.Transparent, shape)
            .pressable(shape, onLongClick = onLongPress, onClick = onClick)
            .padding(start = 6.dp, end = 2.dp),
        contentAlignment = Alignment.CenterStart,
    ) {
        androidx.compose.animation.Crossfade(
            title,
            animationSpec = tween(150),
            label = "session-title",
        ) { value ->
            Text(
                value,
                color = colors.p(950),
                fontWeight = FontWeight(450),
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
    }
}

/** Mono model label shared by the overlay reply card (message-item.tsx). */
@Composable
fun ModelLabel(model: String) {
    val colors = LocalKairosColors.current
    Text(
        model,
        fontFamily = FontFamily.Monospace,
        fontWeight = FontWeight.Medium,
        fontSize = 14.sp,
        color = colors.p(900),
    )
}
