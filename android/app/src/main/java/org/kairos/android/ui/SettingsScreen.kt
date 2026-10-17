package org.kairos.android.ui

import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.selection.selectable
import androidx.compose.ui.semantics.Role
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import org.kairos.android.BuildConfig
import org.kairos.android.assistant.isDefaultAssistant
import org.kairos.android.assistant.openAssistantSettings
import org.kairos.android.chat.ChatViewModel
import org.kairos.android.data.*
import org.kairos.android.ui.icons.KairosIcons
import org.kairos.android.ui.theme.*

@Composable
fun SettingsScreen(chat: ChatViewModel) {
    val colors = LocalKairosColors.current
    val context = LocalContext.current
    var confirmation by remember { mutableStateOf<String?>(null) }
    Column(
        Modifier.fillMaxSize()
            .background(colors.surface)
            .statusBarsPadding()
            .navigationBarsPadding()
    ) {
        Row(
            Modifier.fillMaxWidth().height(48.dp).padding(horizontal = 16.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            GhostIconButton(KairosIcons.ArrowLeft01, "Back", chat::back)
            Text(
                "Settings",
                fontSize = 16.sp,
                fontWeight = FontWeight.Medium,
                color = colors.p(950),
            )
        }
        Column(
            Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(24.dp),
        ) {
            chat.error?.let { ErrorBox(it) }
            SettingsSection("Account") {
                SettingsRow("Email", chat.app.tokens.email)
                SettingsRow("Sign out", divider = false, onClick = { confirmation = "logout" })
            }
            SettingsSection("Server") {
                SettingsRow("Host", chat.app.server.host)
                SettingsRow(
                    "Change server",
                    divider = false,
                    onClick = { confirmation = "server" },
                )
            }
            SettingsSection("Appearance") {
                Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    Text("Palette", color = colors.p(900))
                    Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        KairosPalettes.forEachIndexed { index, palette ->
                            val pair =
                                if (chat.app.preferences.dark) palette.dark else palette.light
                            val selected = chat.app.preferences.paletteIndex == index
                            Canvas(
                                Modifier.size(28.dp)
                                    .clip(CircleShape)
                                    .border(
                                        if (selected) 2.dp else 0.dp,
                                        if (selected) colors.p(950) else colors.surface,
                                        CircleShape,
                                    )
                                    .pressable(CircleShape) { chat.app.preferences.palette(index) }
                            ) {
                                drawRect(pair.p(500))
                                val path =
                                    Path().apply {
                                        moveTo(size.width, 0f)
                                        lineTo(size.width, size.height)
                                        lineTo(0f, size.height)
                                        close()
                                    }
                                drawPath(path, pair.p(950))
                            }
                        }
                    }
                }
                Row(
                    Modifier.fillMaxWidth().height(48.dp).padding(horizontal = 16.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text("Mode", Modifier.weight(1f), color = colors.p(900))
                    Row(
                        Modifier.height(32.dp)
                            .background(colors.p(100), RoundedCornerShape(8.dp))
                            .padding(2.dp)
                    ) {
                        ThemeMode.entries.forEach { mode ->
                            val selected = chat.app.preferences.mode == mode
                            Box(
                                Modifier.fillMaxHeight()
                                    .then(
                                        if (selected)
                                            Modifier.shadow(2.dp, RoundedCornerShape(8.dp))
                                                .background(
                                                    colors.surface,
                                                    RoundedCornerShape(8.dp),
                                                )
                                        else Modifier
                                    )
                                    .pressable { chat.app.preferences.mode(mode) }
                                    .padding(horizontal = 10.dp),
                                contentAlignment = Alignment.Center,
                            ) {
                                Text(mode.name, color = colors.p(900), fontSize = 12.sp)
                            }
                        }
                    }
                }
            }
            SettingsSection("Conversation") {
                RendererSetting(
                    "App rendering", chat.app.preferences.appRenderer,
                    chat.app.preferences::appRenderer,
                )
            }
            SettingsSection("Assistant") {
                var held by remember { mutableStateOf(isDefaultAssistant(context)) }
                val lifecycle = androidx.lifecycle.compose.LocalLifecycleOwner.current.lifecycle
                DisposableEffect(lifecycle) {
                    val observer =
                        androidx.lifecycle.LifecycleEventObserver { _, event ->
                            if (event == androidx.lifecycle.Lifecycle.Event.ON_RESUME)
                                held = isDefaultAssistant(context)
                        }
                    lifecycle.addObserver(observer)
                    onDispose { lifecycle.removeObserver(observer) }
                }
                SettingsRow(
                    "Default assistant",
                    if (held) "Kairos" else "Set up",
                    onClick = { openAssistantSettings(context) },
                )
                RendererSetting(
                    "Overlay rendering", chat.app.preferences.assistantRenderer,
                    chat.app.preferences::assistantRenderer,
                )
            }
            SettingsSection("About") {
                SettingsRow("Version", BuildConfig.VERSION_NAME, divider = false)
            }
        }
    }
    confirmation?.let { value ->
        ConfirmDialog(
            if (value == "server") "Change server and sign out?" else "Sign out of Kairos?",
            "Sign out",
            { confirmation = null },
        ) {
            confirmation = null
            chat.logout(value == "server")
        }
    }
}

@Composable
private fun SettingsSection(title: String, content: @Composable ColumnScope.() -> Unit) {
    val colors = LocalKairosColors.current
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(title, color = colors.p(500), fontSize = 12.sp)
        Column(
            Modifier.fillMaxWidth()
                .background(colors.surface, RoundedCornerShape(12.dp))
                .border(1.dp, colors.p(200), RoundedCornerShape(12.dp)),
            content = content,
        )
    }
}

@Composable
private fun SettingsRow(
    label: String,
    value: String = "",
    divider: Boolean = true,
    onClick: (() -> Unit)? = null,
) {
    val colors = LocalKairosColors.current
    Row(
        Modifier.fillMaxWidth()
            .height(48.dp)
            .then(if (onClick != null) Modifier.pressable(onClick = onClick) else Modifier)
            .padding(horizontal = 16.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Text(label, color = colors.p(900))
        Spacer(Modifier.weight(1f))
        Text(
            value,
            color = colors.p(600),
            maxLines = 1,
            overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis,
        )
        if (onClick != null) KIcon(KairosIcons.ArrowUpRight01, colors.p(500))
    }
    if (divider) Box(Modifier.fillMaxWidth().height(1.dp).background(colors.p(100)))
}

@Composable
private fun RendererSetting(title: String, value: AssistantRenderer, onChange: (AssistantRenderer) -> Unit) {
    val colors = LocalKairosColors.current
    Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Text(title, color = colors.p(900))
        Text(
            "Choose how messages are displayed.",
            color = colors.p(600),
            fontSize = 12.sp,
        )
        AssistantRenderer.entries.forEach { renderer ->
            val selected = value == renderer
            Row(
                Modifier.fillMaxWidth()
                    .background(if (selected) colors.p(100) else colors.surface, RoundedCornerShape(12.dp))
                    .selectable(
                        selected = selected,
                        role = Role.RadioButton,
                        onClick = { onChange(renderer) },
                    )
                    .padding(12.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                androidx.compose.material3.RadioButton(
                    selected = selected,
                    onClick = null,
                )
                Column(Modifier.weight(1f)) {
                    Text(renderer.label, color = colors.p(900), fontWeight = FontWeight.Medium)
                    Text(
                        if (renderer == AssistantRenderer.Native)
                            "Android text, markdown and activity"
                        else "Shared web transcript, code, tables and math",
                        color = colors.p(600),
                        fontSize = 12.sp,
                    )
                }
            }
        }
    }
}
