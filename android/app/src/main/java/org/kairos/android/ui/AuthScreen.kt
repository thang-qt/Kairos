package org.kairos.android.ui

import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import org.kairos.android.app.Screen
import org.kairos.android.chat.ChatViewModel
import org.kairos.android.data.*
import org.kairos.android.ui.theme.LocalKairosColors

@Composable
fun AuthScreen(chat: ChatViewModel) {
    val colors = LocalKairosColors.current
    val connect = chat.screen == Screen.Connect
    var url by rememberSaveable { mutableStateOf(chat.app.server.url) }
    var email by rememberSaveable { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    fun submit() {
        if (!chat.busy) {
            if (connect) chat.connect(url) else chat.signIn(email, password)
        }
    }
    BoxWithConstraints(
        Modifier.fillMaxSize()
            .background(colors.surface)
            .statusBarsPadding()
            .imePadding()
            .navigationBarsPadding()
    ) {
        val viewport = maxHeight
        Box(
            Modifier.fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .heightIn(min = viewport)
                .padding(24.dp)
        ) {
            Row(
                Modifier.align(Alignment.TopStart),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                KairosMark(size = 24.dp)
                Text(
                    "Kairos",
                    fontFamily = FontFamily.Serif,
                    fontSize = 18.sp,
                    fontWeight = FontWeight.Medium,
                    color = colors.p(950),
                )
            }
            val shape = RoundedCornerShape(32.dp)
            Column(
                Modifier.align(Alignment.Center)
                    .padding(vertical = 64.dp)
                    .widthIn(max = 416.dp)
                    .fillMaxWidth()
                    .shadow(
                        12.dp,
                        shape,
                        ambientColor = colors.ink.copy(alpha = 0.05f),
                        spotColor = colors.ink.copy(alpha = 0.05f),
                    )
                    .background(colors.p(50).copy(alpha = 0.8f), shape)
                    .border(1.dp, colors.p(200), shape)
                    .padding(28.dp)
            ) {
                Text(
                    if (connect) "Connect to Kairos" else "Welcome back",
                    fontFamily = FontFamily.Serif,
                    fontSize = 28.sp,
                    lineHeight = 34.sp,
                    fontWeight = FontWeight.Medium,
                    color = colors.p(950),
                )
                Spacer(Modifier.height(12.dp))
                if (connect) Text("Enter the address of your Kairos server.", color = colors.p(600))
                else
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        Text(
                            "Sign in to ${chat.app.server.host}",
                            Modifier.weight(1f),
                            color = colors.p(600),
                        )
                        Text(
                            "Change",
                            Modifier.pressable(onClick = chat::changeConnect),
                            color = colors.p(900),
                            textDecoration = TextDecoration.Underline,
                        )
                    }
                Spacer(Modifier.height(24.dp))
                Box(Modifier.fillMaxWidth().height(1.dp).background(colors.p(200)))
                Spacer(Modifier.height(24.dp))
                if (connect) {
                    FieldLabel("SERVER")
                    KairosField(
                        url,
                        { url = it },
                        "https://kairos.example.com",
                        keyboardType = KeyboardType.Uri,
                        onDone = ::submit,
                    )
                    val normalized = runCatching { normalizeServerUrl(url) }.getOrNull()
                    if (normalized != null && isUnencryptedRemote(normalized)) {
                        Spacer(Modifier.height(8.dp))
                        Text(
                            "Not encrypted. Use only on a network you trust.",
                            color = colors.p(600),
                            fontSize = 12.sp,
                        )
                    }
                } else {
                    FieldLabel("EMAIL")
                    KairosField(
                        email,
                        { email = it },
                        "you@example.com",
                        keyboardType = KeyboardType.Email,
                        onDone = ::submit,
                    )
                    Spacer(Modifier.height(16.dp))
                    FieldLabel("PASSWORD")
                    KairosField(
                        password,
                        { password = it },
                        "Password",
                        password = true,
                        keyboardType = KeyboardType.Password,
                        onDone = ::submit,
                    )
                }
                Spacer(Modifier.height(24.dp))
                chat.error?.let {
                    ErrorBox(it)
                    Spacer(Modifier.height(16.dp))
                }
                PrimaryButton(if (connect) "Continue" else "Sign in", chat.busy, onClick = ::submit)
                if (!connect) {
                    Spacer(Modifier.height(20.dp))
                    Text(
                        "New here? Create an account on the web.",
                        Modifier.align(Alignment.CenterHorizontally),
                        color = colors.p(500),
                        fontSize = 12.sp,
                    )
                }
            }
        }
    }
}

@Composable
private fun FieldLabel(label: String) {
    val colors = LocalKairosColors.current
    Text(
        label,
        Modifier.padding(bottom = 8.dp),
        color = colors.p(600),
        fontSize = 12.sp,
        fontWeight = FontWeight.Medium,
    )
}
