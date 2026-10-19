package org.kairos.android.ui

import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import org.kairos.android.ui.icons.AppIcons
import org.kairos.android.ui.theme.LocalThemeColors

enum class ButtonStyle { Primary, Secondary, Ghost }

/** Shared label, shape, touch target and feedback for all text actions. */
@Composable
fun ActionButton(
    label: String,
    modifier: Modifier = Modifier,
    style: ButtonStyle = ButtonStyle.Primary,
    busy: Boolean = false,
    enabled: Boolean = true,
    onClick: () -> Unit,
) {
    val colors = LocalThemeColors.current
    val primary = style == ButtonStyle.Primary
    val background = when (style) {
        ButtonStyle.Primary -> colors.p(950)
        ButtonStyle.Secondary -> colors.p(100)
        ButtonStyle.Ghost -> Color.Transparent
    }
    Box(
        modifier
            .heightIn(min = UiTokens.controlHeight)
            .alpha(if (enabled) 1f else 0.5f)
            .clip(UiTokens.controlShape)
            .background(background)
            .pressable(
                shape = UiTokens.controlShape,
                pressedColor = if (primary) colors.p(900) else colors.p(200),
                enabled = enabled && !busy,
                onClick = onClick,
            )
            .padding(horizontal = 16.dp, vertical = 10.dp),
        contentAlignment = Alignment.Center,
    ) {
        if (busy) {
            val transition = rememberInfiniteTransition(label = "busy")
            val angle by transition.animateFloat(
                0f, 360f,
                infiniteRepeatable(tween(900, easing = LinearEasing)),
                label = "spinner",
            )
            AppIcon(AppIcons.Loading03, if (primary) colors.p(50) else colors.p(900), Modifier.rotate(angle))
        } else {
            Text(label, color = if (primary) colors.p(50) else colors.p(900), fontSize = 14.sp, fontWeight = FontWeight.Medium)
        }
    }
}

@Composable
fun PrimaryButton(
    label: String,
    busy: Boolean = false,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    onClick: () -> Unit,
) {
    ActionButton(label, modifier.fillMaxWidth(), busy = busy, enabled = enabled, onClick = onClick)
}
