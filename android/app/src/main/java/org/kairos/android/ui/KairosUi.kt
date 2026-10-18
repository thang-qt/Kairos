@file:OptIn(androidx.compose.foundation.ExperimentalFoundationApi::class)

package org.kairos.android.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.composed
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import org.kairos.android.ui.icons.KairosIcons
import org.kairos.android.ui.theme.LocalKairosColors

/** Hugeicons glyph at the web's 20dp / 1.5 stroke. */
@Composable
fun KIcon(icon: ImageVector, tint: Color, modifier: Modifier = Modifier, size: Dp = 20.dp) {
    Icon(icon, contentDescription = null, tint = tint, modifier = modifier.size(size))
}

/**
 * Web-style press feedback: a flat fill while pressed instead of a Material ripple,
 * matching the web's hover:bg-primary-200 on touch.
 */
fun Modifier.pressable(
    shape: Shape = RoundedCornerShape(8.dp),
    pressedColor: Color? = null,
    enabled: Boolean = true,
    role: Role = Role.Button,
    onLongClick: (() -> Unit)? = null,
    onClick: () -> Unit,
): Modifier = composed {
    val interaction = remember { MutableInteractionSource() }
    val pressed by interaction.collectIsPressedAsState()
    val fill = pressedColor ?: LocalKairosColors.current.p(200)
    this.background(if (pressed) fill else Color.Transparent, shape)
        .combinedClickable(interaction, indication = null, enabled = enabled, role = role, onLongClick = onLongClick, onClick = onClick)
}

/** The web's ghost `icon-sm` button: 32dp, 8dp corners (or round), primary-200 when pressed. */
@Composable
fun GhostIconButton(
    icon: ImageVector,
    label: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    tint: Color = LocalKairosColors.current.p(800),
    round: Boolean = false,
    size: Dp = 32.dp,
    selected: Boolean = false,
    enabled: Boolean = true,
    onLongClick: (() -> Unit)? = null,
) {
    val colors = LocalKairosColors.current
    val shape = if (round) CircleShape else KairosUiTokens.controlShape
    Box(
        modifier.size(size)
            .alpha(if (enabled) 1f else 0.5f)
            .background(if (selected) colors.p(200) else Color.Transparent, shape)
            .semantics { contentDescription = label }
            .pressable(shape, enabled = enabled, onLongClick = onLongClick, onClick = onClick),
        contentAlignment = Alignment.Center,
    ) { KIcon(icon, tint) }
}

/** The Kairos mark from src/components/icons/kairos-icon-big.tsx (84-unit viewBox). */
@Composable
fun KairosMark(modifier: Modifier = Modifier, size: Dp = 20.dp) {
    val colors = LocalKairosColors.current
    Canvas(modifier.size(size)) {
        val unit = this.size.width / 84f
        drawRoundRect(colors.p(950), Offset(8f * unit, 8f * unit), Size(50f * unit, 50f * unit), CornerRadius(11f * unit))
        drawCircle(colors.p(500), 24f * unit, Offset(58f * unit, 58f * unit))
    }
}

/** Centered placeholder for empty lists and states. */
@Composable
fun EmptyState(
    icon: ImageVector,
    title: String,
    hint: String,
    modifier: Modifier = Modifier,
) {
    val colors = LocalKairosColors.current
    Column(
        modifier.fillMaxSize().padding(32.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Box(
            Modifier.size(44.dp)
                .background(colors.p(100), RoundedCornerShape(12.dp)),
            contentAlignment = Alignment.Center,
        ) { KIcon(icon, colors.p(600)) }
        Spacer(Modifier.height(12.dp))
        Text(
            title,
            color = colors.p(800),
            fontWeight = FontWeight.Medium,
            textAlign = TextAlign.Center,
        )
        Spacer(Modifier.height(4.dp))
        Text(
            hint,
            color = colors.p(500),
            fontSize = 13.sp,
            lineHeight = 18.sp,
            textAlign = TextAlign.Center,
        )
    }
}

/** Centered busy indicator with a label. */
@Composable
fun LoadingState(label: String, modifier: Modifier = Modifier) {
    val colors = LocalKairosColors.current
    val transition = rememberInfiniteTransition(label = "loading")
    val angle by
        transition.animateFloat(
            0f,
            360f,
            infiniteRepeatable(tween(900, easing = LinearEasing)),
            label = "spinner",
        )
    Row(
        modifier.fillMaxSize().padding(24.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.CenterHorizontally),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        KIcon(KairosIcons.Loading03, colors.p(600), Modifier.rotate(angle))
        Text(label, color = colors.p(600), fontSize = 13.sp)
    }
}
