package org.kairos.android.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.serialization.json.Json
import org.kairos.android.data.McpApproval
import org.kairos.android.ui.icons.AppIcons
import org.kairos.android.ui.theme.LocalThemeColors

private val pretty = Json { prettyPrint = true }

/**
 * Takes the composer's place while a remote tool call waits for the user — the same pattern as
 * the web's approval dock. Allow once approves only this call; Always grants the tool for the
 * chat; Deny rejects it.
 */
@Composable
fun McpApprovalCard(
    approvals: List<McpApproval>,
    busy: Boolean,
    onDecide: (decision: String, scope: String?) -> Unit,
    modifier: Modifier = Modifier,
) {
    val colors = LocalThemeColors.current
    val approval = approvals.firstOrNull() ?: return
    var now by remember { mutableLongStateOf(System.currentTimeMillis()) }
    LaunchedEffect(Unit) {
        while (true) {
            now = System.currentTimeMillis()
            kotlinx.coroutines.delay(1000)
        }
    }
    val remaining = ((approval.expiresAt - now) / 1000).coerceAtLeast(0)
    val waiting = approval.state == "pending"
    Column(
        modifier
            .fillMaxWidth()
            .background(colors.surface, UiTokens.dialogShape)
            .border(1.dp, colors.p(200), UiTokens.dialogShape)
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Box(
                Modifier.size(36.dp)
                    .background(colors.p(100), RoundedCornerShape(12.dp)),
                contentAlignment = Alignment.Center,
            ) { AppIcon(AppIcons.PlugSocket, colors.p(700)) }
            Column(Modifier.weight(1f)) {
                Text(
                    "Allow ${approval.toolName} on ${approval.serverName}?",
                    color = colors.p(900),
                    fontWeight = FontWeight.Medium,
                )
                Text(
                    when {
                        !waiting -> "The call is running on ${approval.serverName}."
                        approvals.size > 1 ->
                            "${if (remaining > 0) "Expires in ${remaining}s" else "Waiting for your decision"} · 1 of ${approvals.size}"
                        remaining > 0 -> "Expires in ${remaining}s"
                        else -> "Waiting for your decision"
                    },
                    color = colors.p(500),
                    fontSize = 12.sp,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }
        approval.arguments?.let { arguments ->
            Text(
                pretty.encodeToString(
                    kotlinx.serialization.json.JsonElement.serializer(),
                    arguments,
                ).trim(),
                Modifier.fillMaxWidth()
                    .background(colors.p(100).copy(alpha = 0.6f), RoundedCornerShape(12.dp))
                    .padding(10.dp),
                fontFamily = FontFamily.Monospace,
                fontSize = 12.sp,
                lineHeight = 16.sp,
                color = colors.p(800),
                maxLines = 4,
                overflow = TextOverflow.Ellipsis,
            )
        }
        Text(
            "This call may change data on ${approval.serverName}, and stopping it later may not undo its effects.",
            color = colors.p(500),
            fontSize = 12.sp,
            lineHeight = 16.sp,
        )
        if (waiting) {
            Row(
                Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                ActionButton(
                    "Deny",
                    modifier = Modifier.weight(1f),
                    style = ButtonStyle.Ghost,
                    enabled = !busy,
                ) { onDecide("denied", null) }
                ActionButton(
                    "Always",
                    modifier = Modifier.weight(1f),
                    style = ButtonStyle.Secondary,
                    enabled = !busy,
                ) { onDecide("approved", "tool") }
                PrimaryButton(
                    "Allow once",
                    busy = busy,
                    modifier = Modifier.weight(1f),
                ) { onDecide("approved", null) }
            }
        }
    }
}
