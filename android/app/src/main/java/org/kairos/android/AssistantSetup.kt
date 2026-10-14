package org.kairos.android

import android.app.role.RoleManager
import android.content.ActivityNotFoundException
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.os.Build
import android.provider.Settings
import android.service.voice.VoiceInteractionService
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.compose.foundation.layout.*
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import org.kairos.android.ui.icons.KairosIcons
import org.kairos.android.ui.theme.LocalKairosColors

fun isDefaultAssistant(context: Context): Boolean = if (Build.VERSION.SDK_INT >= 29) {
    val roles = context.getSystemService(RoleManager::class.java)
    roles?.isRoleAvailable(RoleManager.ROLE_ASSISTANT) == true && roles.isRoleHeld(RoleManager.ROLE_ASSISTANT)
} else VoiceInteractionService.isActiveService(context, ComponentName(context, KairosVoiceInteractionService::class.java))

fun openAssistantSettings(context: Context) {
    // ASSISTANT is requestable=false in AOSP; never create a role-request prompt.
    for (action in listOf(Settings.ACTION_VOICE_INPUT_SETTINGS, Settings.ACTION_MANAGE_DEFAULT_APPS_SETTINGS)) {
        try { context.startActivity(Intent(action).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)); return }
        catch (_: ActivityNotFoundException) { }
    }
    Toast.makeText(context, "Open Settings → Apps → Default apps → Digital assistant", Toast.LENGTH_LONG).show()
}

fun openBrowser(context: Context, href: String) {
    val uri = android.net.Uri.parse(href)
    if (uri.scheme !in listOf("https", "http")) return
    try { context.startActivity(Intent(Intent.ACTION_VIEW, uri).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
    catch (_: ActivityNotFoundException) { Toast.makeText(context, "No browser installed", Toast.LENGTH_SHORT).show() }
}

fun mainAppIntent(context: Context): Intent = Intent(context, MainActivity::class.java)
    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)

@Composable
fun AssistantSetupRows() {
    val context = LocalContext.current
    val colors = LocalKairosColors.current
    var held by remember { mutableStateOf(isDefaultAssistant(context)) }
    DisposableEffect(context) {
        val lifecycle = (context as? ComponentActivity)?.lifecycle
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_RESUME) held = isDefaultAssistant(context)
        }
        lifecycle?.addObserver(observer)
        onDispose { lifecycle?.removeObserver(observer) }
    }
    SidebarAction(KairosIcons.AiMagic, "Default assistant", trailing = {
        Text(if (held) "Kairos" else "Set up", color = colors.p(500))
    }) { openAssistantSettings(context) }
    SidebarAction(KairosIcons.BubbleChat, "Preview overlay", onClick = { context.startActivity(Intent(context, OverlayPreviewActivity::class.java)) })
}
