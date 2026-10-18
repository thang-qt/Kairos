package org.kairos.android.ui

import androidx.compose.foundation.*
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsFocusedAsState
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.input.*
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import org.kairos.android.ui.icons.AppIcons
import org.kairos.android.ui.theme.LocalThemeColors

@Composable
fun TextField(
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
    val colors = LocalThemeColors.current
    val interaction = remember { MutableInteractionSource() }
    val focused by interaction.collectIsFocusedAsState()
    var revealed by remember { mutableStateOf(false) }
    val shape = UiTokens.controlShape
    Row(
        modifier
            .fillMaxWidth()
            .heightIn(min = if (search) 40.dp else UiTokens.controlHeight)
            .background(if (search) colors.p(100).copy(alpha = 0.6f) else colors.surface, shape)
            .border(1.dp, if (focused) colors.p(400) else colors.p(200), shape)
            .padding(horizontal = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        if (search) AppIcon(AppIcons.Search01, colors.p(400))
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
                if (revealed) AppIcons.ViewOffSlash else AppIcons.View,
                if (revealed) "Hide password" else "Show password",
                { revealed = !revealed },
            )
    }
}
