package org.kairos.android.ui

import androidx.compose.animation.core.*
import androidx.compose.foundation.*
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsFocusedAsState
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.*
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import org.kairos.android.ui.icons.KairosIcons
import org.kairos.android.ui.theme.LocalKairosColors

@Composable
fun KairosField(
    value: String,
    onChange: (String) -> Unit,
    placeholder: String = "",
    modifier: Modifier = Modifier,
    keyboardType: KeyboardType = KeyboardType.Text,
    password: Boolean = false,
    search: Boolean = false,
    onDone: () -> Unit = {},
    focusRequester: FocusRequester? = null,
) {
    val colors = LocalKairosColors.current
    val interaction = remember { MutableInteractionSource() }
    val focused by interaction.collectIsFocusedAsState()
    var revealed by remember { mutableStateOf(false) }
    val shape = RoundedCornerShape(8.dp)
    Row(
        modifier
            .fillMaxWidth()
            .height(if (search) 32.dp else 40.dp)
            .background(if (search) colors.p(100).copy(alpha = 0.6f) else colors.surface, shape)
            .border(1.dp, if (focused) colors.p(400) else colors.p(200), shape)
            .padding(horizontal = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        if (search) KIcon(KairosIcons.Search01, colors.p(400))
        BasicTextField(
            value,
            onChange,
            Modifier.weight(1f).then(focusRequester?.let { Modifier.focusRequester(it) } ?: Modifier),
            singleLine = true,
            textStyle = TextStyle(color = colors.p(950), fontSize = if (search) 14.sp else 15.sp),
            cursorBrush = SolidColor(colors.p(950)),
            interactionSource = interaction,
            visualTransformation =
                if (password && !revealed) PasswordVisualTransformation()
                else VisualTransformation.None,
            keyboardOptions =
                KeyboardOptions(
                    keyboardType = keyboardType,
                    imeAction = ImeAction.Done,
                    autoCorrectEnabled = false,
                ),
            keyboardActions = KeyboardActions(onDone = { onDone() }),
            decorationBox = { inner ->
                Box(contentAlignment = Alignment.CenterStart) {
                    if (value.isEmpty())
                        Text(
                            placeholder,
                            color = colors.p(500),
                            fontSize = if (search) 14.sp else 15.sp,
                            maxLines = 1,
                        )
                    inner()
                }
            },
        )
        if (password)
            GhostIconButton(
                if (revealed) KairosIcons.ViewOffSlash else KairosIcons.View,
                if (revealed) "Hide password" else "Show password",
                { revealed = !revealed },
            )
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
    val colors = LocalKairosColors.current
    Box(
        modifier
            .fillMaxWidth()
            .height(40.dp)
            .background(
                if (enabled) colors.p(950) else colors.p(950).copy(alpha = 0.4f),
                RoundedCornerShape(8.dp),
            )
            .pressable(pressedColor = colors.p(900), enabled = enabled) {
                if (!busy) onClick()
            },
        contentAlignment = Alignment.Center,
    ) {
        if (busy) {
            val transition = rememberInfiniteTransition(label = "busy")
            val angle by
                transition.animateFloat(
                    0f,
                    360f,
                    infiniteRepeatable(tween(900, easing = LinearEasing)),
                    label = "spinner",
                )
            KIcon(KairosIcons.Loading03, colors.p(50), Modifier.rotate(angle))
        } else Text(label, color = colors.p(50), fontWeight = FontWeight.Medium)
    }
}

@Composable
fun ErrorBox(message: String) {
    val colors = LocalKairosColors.current
    Row(
        Modifier.fillMaxWidth()
            .background(colors.p(100), RoundedCornerShape(12.dp))
            .border(1.dp, colors.p(300), RoundedCornerShape(12.dp))
            .padding(12.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        KIcon(KairosIcons.AlertCircle, colors.p(800))
        Text(message, color = colors.p(900))
    }
}

@Composable
fun KairosDialog(
    title: String,
    onDismiss: () -> Unit,
    content: @Composable ColumnScope.() -> Unit,
) {
    val colors = LocalKairosColors.current
    Dialog(onDismissRequest = onDismiss) {
        Column(
            Modifier.fillMaxWidth()
                .background(colors.p(50), RoundedCornerShape(16.dp))
                .border(1.dp, colors.p(200), RoundedCornerShape(16.dp))
                .padding(24.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            Text(title, color = colors.p(950), fontWeight = FontWeight.Medium, fontSize = 16.sp)
            content()
        }
    }
}

@Composable
fun ConfirmDialog(title: String, action: String, onDismiss: () -> Unit, onConfirm: () -> Unit) {
    val colors = LocalKairosColors.current
    KairosDialog(title, onDismiss) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Text(
                "Cancel",
                Modifier.weight(1f).pressable(onClick = onDismiss).padding(10.dp),
                color = colors.p(900),
            )
            PrimaryButton(action, modifier = Modifier.weight(1f), onClick = onConfirm)
        }
    }
}

/** Compact pill switch drawn from the palette, animating the knob between edges. */
@Composable
fun KSwitch(
    checked: Boolean,
    onChange: (Boolean) -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
) {
    val colors = LocalKairosColors.current
    val position by
        animateDpAsState(if (checked) 20.dp else 2.dp, tween(150), label = "switch-knob")
    Box(
        modifier
            .size(44.dp, 26.dp)
            .clip(RoundedCornerShape(13.dp))
            .background(if (checked) colors.p(950) else colors.p(300))
            .pressable(RoundedCornerShape(13.dp), enabled = enabled) {
                if (enabled) onChange(!checked)
            },
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
    val colors = LocalKairosColors.current
    val shape = RoundedCornerShape(12.dp)
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
            KSwitch(checked, onChange, enabled = enabled)
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
    val colors = LocalKairosColors.current
    val interaction = remember { MutableInteractionSource() }
    val focused by interaction.collectIsFocusedAsState()
    Row(
        modifier.fillMaxWidth().height(40.dp),
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
                    fontSize = 13.sp,
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

/** Horizontally scrolling segmented pills; selected renders inverted like the theme mode row. */
@Composable
fun SegmentedRow(
    label: String,
    options: List<String>,
    selected: String,
    onSelect: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    val colors = LocalKairosColors.current
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
                .padding(2.dp),
            horizontalArrangement = Arrangement.spacedBy(2.dp),
        ) {
            options.forEach { option ->
                val isSelected = option == selected
                Box(
                    Modifier.background(if (isSelected) colors.p(950) else Color.Transparent, RoundedCornerShape(8.dp))
                        .pressable(RoundedCornerShape(8.dp), pressedColor = colors.p(200)) {
                            onSelect(option)
                        }
                        .padding(horizontal = 10.dp, vertical = 5.dp)
                ) {
                    Text(
                        option,
                        color = if (isSelected) colors.p(50) else colors.p(800),
                        fontSize = 12.sp,
                    )
                }
            }
        }
    }
}
