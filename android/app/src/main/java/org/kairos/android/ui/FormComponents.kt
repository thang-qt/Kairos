package org.kairos.android.ui

import androidx.compose.animation.core.*
import androidx.compose.foundation.*
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsFocusedAsState
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.*
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
            Modifier.weight(1f),
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
    onClick: () -> Unit,
) {
    val colors = LocalKairosColors.current
    Box(
        modifier
            .fillMaxWidth()
            .height(40.dp)
            .background(colors.p(950), RoundedCornerShape(8.dp))
            .pressable(pressedColor = colors.p(900), onClick = { if (!busy) onClick() }),
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
