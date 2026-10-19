package org.kairos.android.ui

import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.*
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsFocusedAsState
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import org.kairos.android.ui.theme.LocalThemeColors

@Composable
fun ToggleSwitch(
    checked: Boolean,
    onChange: (Boolean) -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
) {
    val colors = LocalThemeColors.current
    val position by
        animateDpAsState(if (checked) 20.dp else 2.dp, tween(150), label = "switch-knob")
    Box(
        modifier
            .alpha(if (enabled) 1f else 0.5f)
            .size(44.dp, 26.dp)
            .clip(RoundedCornerShape(13.dp))
            .background(if (checked) colors.p(950) else colors.p(300))
            .toggleable(value = checked, enabled = enabled, role = Role.Switch, onValueChange = onChange),
    ) {
        Box(
            Modifier.offset(x = position)
                .size(22.dp)
                .background(colors.p(50), CircleShape)
                .align(Alignment.CenterStart)
        )
    }
}

/**
 * Web SettingCard: one toggle row with optional description, and optional content that appears
 * while the toggle is on.
 */
@Composable
fun ToggleCard(
    label: String,
    description: String? = null,
    checked: Boolean,
    enabled: Boolean = true,
    onChange: (Boolean) -> Unit,
    content: (@Composable ColumnScope.() -> Unit)? = null,
) {
    val colors = LocalThemeColors.current
    val shape = UiTokens.cardShape
    Column(
        Modifier.fillMaxWidth()
            .background(colors.p(50), shape)
            .border(1.dp, colors.p(200), shape)
            .padding(start = 12.dp, end = 12.dp, top = 10.dp, bottom = 12.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Row(
            Modifier.fillMaxWidth().pressable(enabled = enabled) { if (enabled) onChange(!checked) },
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Column(Modifier.weight(1f)) {
                Text(label, color = colors.p(800), maxLines = 1, overflow = TextOverflow.Ellipsis)
                description?.let {
                    Text(it, color = colors.p(500), fontSize = 12.sp, lineHeight = 16.sp)
                }
            }
            ToggleSwitch(checked, onChange, enabled = enabled)
        }
        if (checked && content != null) {
            Box(Modifier.fillMaxWidth().height(1.dp).background(colors.p(200)))
            content()
        }
    }
}

/** Right-aligned compact numeric input with a number keyboard and tabular figures. */
@Composable
fun NumberFieldRow(
    label: String,
    value: String,
    onChange: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    val colors = LocalThemeColors.current
    val interaction = remember { MutableInteractionSource() }
    val focused by interaction.collectIsFocusedAsState()
    Row(
        modifier.fillMaxWidth().heightIn(min = UiTokens.controlHeight),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text(label, Modifier.weight(1f), color = colors.p(800), maxLines = 1)
        BasicTextField(
            value,
            onChange,
            Modifier.width(104.dp)
                .height(32.dp)
                .background(colors.p(100).copy(alpha = 0.6f), RoundedCornerShape(8.dp))
                .border(1.dp, if (focused) colors.p(400) else colors.p(200), RoundedCornerShape(8.dp))
                .padding(horizontal = 8.dp),
            singleLine = true,
            textStyle =
                TextStyle(
                    color = colors.p(950),
                    fontSize = 14.sp,
                    fontFeatureSettings = "tnum",
                    textAlign = TextAlign.End,
                ),
            keyboardOptions =
                KeyboardOptions(
                    keyboardType = KeyboardType.Decimal,
                    imeAction = ImeAction.Done,
                    autoCorrectEnabled = false,
                ),
            cursorBrush = SolidColor(colors.p(950)),
            interactionSource = interaction,
        )
    }
}

/** Shared segmented selector with a raised surface for the selected option. */
@Composable
fun SegmentedRow(
    label: String,
    options: List<String>,
    selected: String,
    onSelect: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    val colors = LocalThemeColors.current
    Row(
        modifier.fillMaxWidth().heightIn(min = 32.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text(label, Modifier.weight(1f, fill = false), color = colors.p(800), maxLines = 1)
        Row(
            Modifier.weight(1f, fill = false)
                .horizontalScroll(rememberScrollState())
                .background(colors.p(100), RoundedCornerShape(8.dp))
                .selectableGroup()
                .padding(2.dp),
            horizontalArrangement = Arrangement.spacedBy(2.dp),
        ) {
            options.forEach { option ->
                val isSelected = option == selected
                Box(
                    Modifier.heightIn(min = 40.dp)
                        .clip(UiTokens.controlShape)
                        .background(if (isSelected) colors.surface else Color.Transparent)
                        .selectable(selected = isSelected, role = Role.Tab, onClick = { onSelect(option) })
                        .padding(horizontal = 10.dp, vertical = 10.dp)
                ) {
                    Text(
                        option,
                        color = if (isSelected) colors.p(950) else colors.p(600),
                        fontWeight = if (isSelected) FontWeight.Medium else FontWeight.Normal,
                        fontSize = 12.sp,
                    )
                }
            }
        }
    }
}
