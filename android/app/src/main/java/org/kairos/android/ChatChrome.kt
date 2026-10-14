@file:OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)

package org.kairos.android

import android.widget.Toast
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import org.kairos.android.ui.GhostIconButton
import org.kairos.android.ui.KIcon
import org.kairos.android.ui.KairosMark
import org.kairos.android.ui.icons.KairosIcons
import org.kairos.android.ui.pressable
import org.kairos.android.ui.theme.KairosPalettes
import org.kairos.android.ui.theme.LocalKairosColors

private fun prototypeToast(context: android.content.Context) = Toast.makeText(context, "prototype", Toast.LENGTH_SHORT).show()

/**
 * src/features/chat/components/chat-header.tsx at phone width (the title is hidden below `sm`),
 * over the app-shell fade: solid surface → 93% at 35% → 80% at 60% → clear at 80dp.
 */
@Composable
fun ChatHeader(chat: PrototypeChat, onOpenSidebar: () -> Unit, onToggleDebug: () -> Unit) {
    val colors = LocalKairosColors.current
    val context = LocalContext.current
    Column(Modifier.fillMaxWidth()) {
        Spacer(Modifier.fillMaxWidth().windowInsetsTopHeight(WindowInsets.statusBars).background(colors.surface))
        Box(
            Modifier.fillMaxWidth().height(80.dp).background(Brush.verticalGradient(
                0f to colors.surface,
                0.35f to colors.surface.copy(alpha = 0.93f),
                0.6f to colors.surface.copy(alpha = 0.8f),
                1f to colors.surface.copy(alpha = 0f),
            )),
        ) {
            Row(Modifier.fillMaxWidth().height(48.dp).padding(horizontal = 16.dp), verticalAlignment = Alignment.CenterVertically) {
                GhostIconButton(KairosIcons.SidebarLeft01, "Open sidebar", onOpenSidebar, Modifier.padding(end = 12.dp))
                // Ghost model picker; long-press toggles the perf overlay.
                Row(
                    Modifier.pressable(RoundedCornerShape(6.dp), pressedColor = colors.p(100), onLongClick = onToggleDebug) { prototypeToast(context) }
                        .padding(horizontal = 6.dp, vertical = 4.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                ) {
                    Text("mock / v1", color = colors.p(700), maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.widthIn(max = 220.dp))
                    KIcon(KairosIcons.ArrowDown01, colors.p(500), size = 16.dp)
                }
                Spacer(Modifier.weight(1f))
                GhostIconButton(KairosIcons.MoreVertical, "Toggle panel", { prototypeToast(context) }, tint = colors.p(700))
            }
        }
    }
}

private data class SessionGroup(val label: String, val sessions: List<Session>)

private val sessionGroups = Fixtures.sessions.let { all ->
    listOf(
        SessionGroup("Pinned", all.take(1)),
        SessionGroup("Today", all.subList(1, 4)),
        SessionGroup("Yesterday", all.subList(4, 8)),
        SessionGroup("Previous 7 days", all.subList(8, 14)),
        SessionGroup("Previous 30 days", all.subList(14, all.size)),
    )
}

/** src/features/chat/components/chat-sidebar.tsx, full width for the swipe drawer. */
@Composable
fun Sidebar(chat: PrototypeChat, modifier: Modifier, onSelect: (Session) -> Unit, onNew: () -> Unit, onClose: () -> Unit) {
    val colors = LocalKairosColors.current
    val context = LocalContext.current
    Column(modifier.background(colors.p(100)).statusBarsPadding()) {
        Row(Modifier.fillMaxWidth().height(48.dp).padding(horizontal = 8.dp), verticalAlignment = Alignment.CenterVertically) {
            Row(
                Modifier.height(32.dp).pressable(onClick = onNew).padding(start = 6.dp, end = 12.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                KairosMark()
                Text("Kairos", fontWeight = FontWeight.Medium, color = colors.p(900))
            }
            Spacer(Modifier.weight(1f))
            GhostIconButton(KairosIcons.SidebarLeft01, "Close sidebar", onClose, tint = colors.p(900))
        }
        Column(Modifier.padding(start = 8.dp, end = 8.dp, bottom = 16.dp), verticalArrangement = Arrangement.spacedBy(1.dp)) {
            SidebarAction(KairosIcons.PencilEdit02, "New Session", onClick = onNew)
            SidebarAction(KairosIcons.Search01, "Search sessions", onClick = { prototypeToast(context) })
            AssistantSetupRows()
        }
        Column(
            Modifier.weight(1f).fillMaxWidth().verticalScroll(rememberScrollState()).padding(horizontal = 8.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            sessionGroups.forEach { group ->
                key(group.label) {
                    SessionSection(group) { session ->
                        key(session.id) { SessionItem(session.title, session.title == chat.title) { onSelect(session) } }
                    }
                }
            }
            Spacer(Modifier.height(8.dp))
        }
        Row(
            Modifier.fillMaxWidth().background(colors.p(100))
                .drawBehind { drawLine(colors.p(200), Offset.Zero, Offset(size.width, 0f), 1.dp.toPx()) }
                .navigationBarsPadding().padding(horizontal = 8.dp, vertical = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            SidebarAction(KairosIcons.Settings01, "Settings", Modifier.weight(1f)) { prototypeToast(context) }
            // Prototype theme controls in place of the web's log-out button.
            GhostIconButton(KairosIcons.PaintBoard, "Palette: ${KairosPalettes[chat.paletteIndex].name}", chat::cyclePalette, tint = colors.p(700))
            GhostIconButton(if (chat.dark) KairosIcons.Sun01 else KairosIcons.Moon01, if (chat.dark) "Light mode" else "Dark mode", chat::toggleMode, tint = colors.p(700))
        }
    }
}

/** The web's ghost `sm` button with an icon: 32dp, pl-1.5, gap-2, medium text. */
@Composable
fun SidebarAction(icon: ImageVector, label: String, modifier: Modifier = Modifier, trailing: (@Composable () -> Unit)? = null, onClick: () -> Unit) {
    val colors = LocalKairosColors.current
    Row(
        modifier.fillMaxWidth().height(32.dp).pressable(onClick = onClick).padding(start = 6.dp, end = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        KIcon(icon, colors.p(900))
        Text(label, Modifier.weight(1f), color = colors.p(900), fontWeight = FontWeight.Medium, maxLines = 1, overflow = TextOverflow.Clip)
        trailing?.invoke()
    }
}

@Composable
private fun SessionSection(group: SessionGroup, item: @Composable (Session) -> Unit) {
    val colors = LocalKairosColors.current
    var open by remember { mutableStateOf(true) }
    val rotation by animateFloatAsState(if (open) 90f else 0f, tween(150), label = "section-arrow")
    Column(Modifier.fillMaxWidth()) {
        Row(
            Modifier.fillMaxWidth().height(32.dp).pressable { open = !open }.padding(horizontal = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(group.label, Modifier.weight(1f), color = colors.p(700), maxLines = 1, overflow = TextOverflow.Ellipsis)
            KIcon(KairosIcons.ArrowRight01, colors.p(500), Modifier.rotate(rotation), size = 12.dp)
        }
        AnimatedVisibility(open, enter = expandVertically(tween(150)) + fadeIn(tween(150)), exit = shrinkVertically(tween(150)) + fadeOut(tween(150))) {
            Column(Modifier.padding(top = 4.dp), verticalArrangement = Arrangement.spacedBy(1.dp)) {
                group.sessions.forEach { item(it) }
            }
        }
    }
}

/** src/features/chat/components/sidebar/session-item.tsx */
@Composable
private fun SessionItem(title: String, active: Boolean, onClick: () -> Unit) {
    val colors = LocalKairosColors.current
    val shape = RoundedCornerShape(8.dp)
    Box(
        Modifier.fillMaxWidth().height(32.dp).background(if (active) colors.p(200) else Color.Transparent, shape)
            .pressable(shape, onClick = onClick).padding(start = 6.dp, end = 2.dp),
        contentAlignment = Alignment.CenterStart,
    ) {
        Text(title, color = colors.p(950), fontWeight = FontWeight(450), maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}

/** src/features/chat/components/message-actions-sheet.tsx */
@Composable
fun MessageActionsSheet(message: ChatMessage?, onDismiss: () -> Unit, onCopy: (String) -> Unit) {
    val colors = LocalKairosColors.current
    val context = LocalContext.current
    val shape = RoundedCornerShape(topStart = 16.dp, topEnd = 16.dp)
    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
        modifier = Modifier.border(1.dp, colors.p(200), shape),
        shape = shape,
        containerColor = colors.p(50),
        contentColor = colors.p(900),
        tonalElevation = 0.dp,
        scrimColor = colors.p(950).copy(alpha = 0.2f),
        dragHandle = { Box(Modifier.padding(top = 12.dp, bottom = 12.dp).size(width = 40.dp, height = 4.dp).background(colors.p(300), RoundedCornerShape(2.dp))) },
    ) {
        Column(Modifier.fillMaxWidth().padding(start = 16.dp, end = 16.dp, bottom = 16.dp).navigationBarsPadding()) {
            fun later() { prototypeToast(context); onDismiss() }
            SheetAction(KairosIcons.Copy01, "Copy") { message?.let { onCopy(it.text) }; onDismiss() }
            if (message?.role == "user") SheetAction(KairosIcons.PencilEdit02, "Edit", ::later)
            SheetAction(KairosIcons.CopyLink, "Fork", ::later)
            SheetAction(KairosIcons.Delete01, "Delete", ::later)
        }
    }
}

@Composable
private fun SheetAction(icon: ImageVector, label: String, onClick: () -> Unit) {
    val colors = LocalKairosColors.current
    Row(
        Modifier.fillMaxWidth().height(48.dp).pressable(pressedColor = colors.p(100), onClick = onClick).padding(horizontal = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        KIcon(icon, colors.p(900))
        Text(label, color = colors.p(900))
    }
}

/** Mono model label shared by the overlay reply card (message-item.tsx). */
@Composable
fun ModelLabel(model: String) {
    val colors = LocalKairosColors.current
    Text(model, fontFamily = FontFamily.Monospace, fontWeight = FontWeight.Medium, fontSize = 14.sp, color = colors.p(900))
}
