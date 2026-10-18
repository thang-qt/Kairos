package org.kairos.android.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import org.kairos.android.ui.theme.LocalThemeColors

@Composable
fun ContentDialog(
    title: String,
    onDismiss: () -> Unit,
    content: @Composable ColumnScope.() -> Unit,
) {
    val colors = LocalThemeColors.current
    Dialog(onDismissRequest = onDismiss) {
        Column(
            Modifier.fillMaxWidth()
                .background(colors.surface, UiTokens.dialogShape)
                .border(1.dp, colors.p(200), UiTokens.dialogShape)
                .padding(20.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            Text(title, color = colors.p(950), fontWeight = FontWeight.Medium, fontSize = 16.sp)
            content()
        }
    }
}

/** Shared action row for confirmation and edit dialogs. */
@Composable
fun DialogActions(action: String, onDismiss: () -> Unit, onConfirm: () -> Unit) {
    Row(
        Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.End),
    ) {
        ActionButton("Cancel", style = ButtonStyle.Ghost, onClick = onDismiss)
        ActionButton(action, onClick = onConfirm)
    }
}

@Composable
fun ConfirmDialog(
    title: String,
    action: String,
    onDismiss: () -> Unit,
    description: String? = null,
    onConfirm: () -> Unit,
) {
    val colors = LocalThemeColors.current
    ContentDialog(title, onDismiss) {
        if (description != null) {
            Text(description, color = colors.p(600), fontSize = 14.sp, lineHeight = 21.sp)
        }
        DialogActions(action, onDismiss, onConfirm)
    }
}
