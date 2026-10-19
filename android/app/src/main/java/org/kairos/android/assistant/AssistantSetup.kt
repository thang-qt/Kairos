package org.kairos.android.assistant

import android.app.ActivityOptions
import android.app.role.RoleManager
import android.content.ActivityNotFoundException
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.service.voice.VoiceInteractionService
import android.widget.Toast
import org.kairos.android.R
import org.kairos.android.app.MainActivity

/** Read the system-owned assistant choice; setup always opens its management screen. */
fun isDefaultAssistant(context: Context): Boolean {
    if (Build.VERSION.SDK_INT < 29)
        return VoiceInteractionService.isActiveService(
            context,
            ComponentName(context, KairosVoiceInteractionService::class.java),
        )
    val roles = context.getSystemService(RoleManager::class.java) ?: return false
    return roles.isRoleAvailable(RoleManager.ROLE_ASSISTANT) &&
        roles.isRoleHeld(RoleManager.ROLE_ASSISTANT)
}

/** Open assistant management directly; requesting an already-held role can silently do nothing. */
fun openAssistantSettings(context: Context) {
    for (action in
        listOf(
            Settings.ACTION_VOICE_INPUT_SETTINGS,
            Settings.ACTION_MANAGE_DEFAULT_APPS_SETTINGS,
        )) {
        try {
            context.startActivity(Intent(action).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            return
        } catch (_: ActivityNotFoundException) {
            // Try the next public settings route.
        } catch (_: SecurityException) {
            // Some OEMs restrict the narrower settings activity.
        }
    }
    Toast.makeText(
            context,
            "Open Settings → Apps → Default apps → Digital assistant",
            Toast.LENGTH_LONG,
        )
        .show()
}

fun openBrowser(context: Context, href: String) {
    val uri = android.net.Uri.parse(href)
    if (uri.scheme !in listOf("https", "http")) return
    try {
        context.startActivity(
            Intent(Intent.ACTION_VIEW, uri).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        )
    } catch (_: ActivityNotFoundException) {
        Toast.makeText(context, "No browser installed", Toast.LENGTH_SHORT).show()
    }
}

/** Slide-up entry shared by every overlay → app handoff. */
fun openAppOptions(context: Context): Bundle =
    ActivityOptions.makeCustomAnimation(context, R.anim.app_open_enter, R.anim.hold_position)
        .toBundle()

fun mainAppIntent(context: Context, sessionId: String? = null): Intent =
    Intent(context, MainActivity::class.java)
        .addFlags(
            Intent.FLAG_ACTIVITY_NEW_TASK or
                Intent.FLAG_ACTIVITY_CLEAR_TOP or
                Intent.FLAG_ACTIVITY_SINGLE_TOP
        )
        .putExtra(MainActivity.SESSION_EXTRA, sessionId)
