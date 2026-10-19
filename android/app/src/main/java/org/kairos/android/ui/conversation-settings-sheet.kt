package org.kairos.android.ui

import androidx.lifecycle.compose.collectAsStateWithLifecycle

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import org.kairos.android.chat.ChatViewModel
import org.kairos.android.data.ConversationSettings
import org.kairos.android.ui.theme.LocalThemeColors

private val efforts = listOf("none", "minimal", "low", "medium", "high", "xhigh", "max")

private fun effortLabel(value: String) =
    when (value) {
        "none" -> "None"
        "xhigh" -> "Extra high"
        else -> value.replaceFirstChar { it.uppercase() }
    }

private fun labelToEffort(label: String) =
    efforts.firstOrNull { effortLabel(it) == label } ?: "medium"

/**
 * Per-conversation generation settings — the phone port of the web's model settings panel:
 * system prompt, tool toggles, and the advanced sampling overrides.
 */
@Composable
fun ConversationSettingsSheet(chat: ChatViewModel, onDismiss: () -> Unit) {
    val colors = LocalThemeColors.current
    val session = chat.sessions.collectAsStateWithLifecycle().value.find {
        it.friendlyId == chat.conversationSettingsTarget
    }
    val catalog by chat.catalog.collectAsStateWithLifecycle()
    val initial =
        session?.settings
            ?: chat.newChatSettings
            ?: chat.model.takeIf { it.isNotBlank() }?.let(chat.app.models::defaults)
            ?: catalog.models.firstOrNull()?.let { chat.app.models.defaults(it.key) }
    if (initial == null) return
    var systemPrompt by remember(initial.systemPrompt) { mutableStateOf(initial.systemPrompt) }
    var webSearch by remember(initial.webSearch) { mutableStateOf(initial.webSearch) }
    var mathTools by remember(initial.mathTools) { mutableStateOf(initial.mathTools) }
    var advanced by remember(initial.advanced) { mutableStateOf(initial.advanced) }
    ModalSheet(onDismiss) {
        Text("Chat settings", color = colors.p(900), fontWeight = FontWeight.Medium)
        Column(
            Modifier.fillMaxWidth()
                .padding(top = 12.dp)
                .heightIn(max = 460.dp)
                .verticalScroll(rememberScrollState()),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            SettingsCard("Instructions") {
                MultilineField(
                    systemPrompt,
                    { systemPrompt = it },
                    "Custom instructions for assistant persona and behavior.",
                )
            }
            SettingsCard("Tools") {
                ToggleCard(
                    "Web search & fetch",
                    "Search the web and read page contents during chat.",
                    webSearch,
                    onChange = { webSearch = it },
                )
                ToggleCard(
                    "Math tools",
                    "Solve equations and unit conversions automatically.",
                    mathTools,
                    onChange = { mathTools = it },
                )
            }
            SettingsCard("Advanced") {
                Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    ToggleCard(
                        "Override reasoning effort",
                        "Off uses the provider default. Choose a level to override it.",
                        advanced.reasoning,
                        onChange = { advanced = advanced.copy(reasoning = it) },
                    ) {
                        SegmentedRow(
                            "Effort",
                            efforts.map(::effortLabel),
                            effortLabel(advanced.reasoningEffort),
                            onSelect = { selected ->
                                advanced = advanced.copy(reasoningEffort = labelToEffort(selected))
                            },
                        )
                    }
                    ToggleCard(
                        "Sampling",
                        "Adjust response creativity and diversity.",
                        advanced.sampling,
                        onChange = { advanced = advanced.copy(sampling = it) },
                    ) {
                        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            NumberFieldRow(
                                "Temperature",
                                advanced.temperature.toString(),
                                onChange = { advanced = advanced.copy(temperature = it.toDoubleOrNull() ?: 0.7) },
                            )
                            NumberFieldRow(
                                "Top P",
                                advanced.topP.toString(),
                                onChange = { advanced = advanced.copy(topP = it.toDoubleOrNull() ?: 1.0) },
                            )
                            NumberFieldRow(
                                "Top K",
                                advanced.topK.toString(),
                                onChange = { advanced = advanced.copy(topK = it.toDoubleOrNull() ?: 0.0) },
                            )
                        }
                    }
                    ToggleCard(
                        "Penalties",
                        "Reduce repetitive text generation.",
                        advanced.penalties,
                        onChange = { advanced = advanced.copy(penalties = it) },
                    ) {
                        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            NumberFieldRow(
                                "Frequency",
                                advanced.frequencyPenalty.toString(),
                                onChange = { advanced = advanced.copy(frequencyPenalty = it.toDoubleOrNull() ?: 0.0) },
                            )
                            NumberFieldRow(
                                "Presence",
                                advanced.presencePenalty.toString(),
                                onChange = { advanced = advanced.copy(presencePenalty = it.toDoubleOrNull() ?: 0.0) },
                            )
                        }
                    }
                    ToggleCard(
                        "Max output",
                        "Limit response length in tokens.",
                        advanced.maxTokens,
                        onChange = { advanced = advanced.copy(maxTokens = it) },
                    ) {
                        NumberFieldRow(
                            "Tokens",
                            advanced.maxTokensValue.toString(),
                            onChange = { advanced = advanced.copy(maxTokensValue = it.toDoubleOrNull() ?: 4096.0) },
                        )
                    }
                }
            }
            if (session == null)
                Text(
                    "These settings will be used when you send the first message.",
                    color = colors.p(500),
                    fontSize = 12.sp,
                )
            PrimaryButton(
                "Save settings",
                busy = chat.busy,
                enabled = true,
                onClick = {
                    chat.saveConversationSettings(
                        ConversationSettings(
                            model = initial.model,
                            systemPrompt = systemPrompt,
                            webSearch = webSearch,
                            mathTools = mathTools,
                            advanced = advanced,
                        )
                    )
                    onDismiss()
                },
            )
        }
    }
}

@Composable
private fun SettingsCard(title: String, content: @Composable ColumnScope.() -> Unit) {
    val colors = LocalThemeColors.current
    Column(
        Modifier.fillMaxWidth()
            .background(colors.p(100).copy(alpha = 0.5f), RoundedCornerShape(12.dp))
            .padding(10.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Text(title, color = colors.p(500), fontSize = 12.sp)
        Column(verticalArrangement = Arrangement.spacedBy(10.dp), content = content)
    }
}

@Composable
private fun MultilineField(value: String, onChange: (String) -> Unit, placeholder: String) {
    val colors = LocalThemeColors.current
    val shape = RoundedCornerShape(8.dp)
    BasicTextField(
        value,
        onChange,
        Modifier.fillMaxWidth()
            .heightIn(min = 96.dp)
            .background(colors.surface, shape)
            .border(1.dp, colors.p(200), shape)
            .padding(10.dp),
        textStyle =
            TextStyle(
                color = colors.p(950),
                fontSize = 14.sp,
                lineHeight = 20.sp,
            ),
        cursorBrush = SolidColor(colors.p(950)),
        keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences),
        decorationBox = { inner ->
            Box {
                if (value.isEmpty())
                    Text(
                        placeholder,
                        color = colors.p(500),
                        fontSize = 14.sp,
                        lineHeight = 20.sp,
                    )
                inner()
            }
        },
    )
}
