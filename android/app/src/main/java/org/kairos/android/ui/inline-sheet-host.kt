package org.kairos.android.ui

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.unit.dp
import org.kairos.android.ui.theme.LocalThemeColors

/** Assistant windows cannot create Activity-type dialogs. Portal sheets into their own window. */
class InlineSheetHost {
    internal var sheet by mutableStateOf<InlineSheet?>(null)
    val isShowing: Boolean get() = sheet != null
    fun dismiss() {
        val current = sheet ?: return
        sheet = null
        current.dismiss()
    }
}

internal class InlineSheet(
    val owner: Any,
    val dismiss: () -> Unit,
    val content: @Composable ColumnScope.() -> Unit,
)

val LocalInlineSheetHost = staticCompositionLocalOf<InlineSheetHost?> { null }

@Composable
internal fun PresentInlineSheet(host: InlineSheetHost, onDismiss: () -> Unit, content: @Composable ColumnScope.() -> Unit) {
    val owner = remember { Any() }
    val latestDismiss by rememberUpdatedState(onDismiss)
    val latestContent by rememberUpdatedState(content)
    DisposableEffect(host, owner) {
        host.sheet = InlineSheet(owner, { latestDismiss() }) { latestContent() }
        onDispose { if (host.sheet?.owner === owner) host.sheet = null }
    }
}

@Composable
fun InlineSheetLayer(host: InlineSheetHost) {
    val sheet = host.sheet ?: return
    val colors = LocalThemeColors.current
    val density = LocalDensity.current
    var entered by remember(sheet.owner) { mutableStateOf(false) }
    LaunchedEffect(sheet.owner) { withFrameNanos {}; entered = true }
    val progress by animateFloatAsState(if (entered) 1f else 0f,
        animationSpec = spring(dampingRatio = 0.9f, stiffness = 400f), label = "attachment-entry")
    BoxWithConstraints(Modifier.fillMaxSize()) {
        Box(Modifier.fillMaxSize().background(colors.ink.copy(alpha = UiTokens.scrimAlpha * progress.coerceIn(0f, 1f)))
            .clickable { sheet.dismiss() })
        Column(
            Modifier.align(Alignment.BottomCenter).widthIn(max = 640.dp).fillMaxWidth()
                .navigationBarsPadding().imePadding()
                .heightIn(max = maxHeight * 0.8f)
                .graphicsLayer {
                    translationY = with(density) { 56.dp.toPx() } * (1f - progress)
                    alpha = progress.coerceIn(0f, 1f)
                }
                .clip(UiTokens.sheetShape).background(colors.p(50))
                .clickable(indication = null, interactionSource = remember { androidx.compose.foundation.interaction.MutableInteractionSource() }) {}
                .padding(16.dp),
        ) {
            Box(Modifier.fillMaxWidth().padding(top = 2.dp, bottom = 20.dp), contentAlignment = Alignment.Center) {
                Box(Modifier.size(40.dp, 4.dp).background(colors.p(300), RoundedCornerShape(2.dp)))
            }
            sheet.content(this)
        }
    }
}
