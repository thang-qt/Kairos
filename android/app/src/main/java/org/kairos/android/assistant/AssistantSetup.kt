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
import androidx.compose.foundation.layout.*
import androidx.compose.runtime.*
import org.kairos.android.R
import org.kairos.android.app.MainActivity

fun isDefaultAssistant(context: Context): Boolean =
    if (Build.VERSION.SDK_INT >= 29) {
        val roles = context.getSystemService(RoleManager::class.java)
        roles?.isRoleAvailable(RoleManager.ROLE_ASSISTANT) == true &&
            roles.isRoleHeld(RoleManager.ROLE_ASSISTANT)
    } else
        VoiceInteractionService.isActiveService(
            context,
            ComponentName(context, KairosVoiceInteractionService::class.java),
        )

fun openAssistantSettings(context: Context) {
    // ASSISTANT is requestable=false in AOSP; never create a role-request prompt.
    for (action in
        listOf(
            Settings.ACTION_VOICE_INPUT_SETTINGS,
            Settings.ACTION_MANAGE_DEFAULT_APPS_SETTINGS,
        )) {
        try {
            context.startActivity(Intent(action).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            return
        } catch (_: ActivityNotFoundException) {}
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
    ActivityOptions.makeCustomAnimation(context, R.anim.kairos_open_enter, R.anim.kairos_hold)
        .toBundle()

fun mainAppIntent(context: Context, sessionId: String? = null): Intent =
    Intent(context, MainActivity::class.java)
        .addFlags(
            Intent.FLAG_ACTIVITY_NEW_TASK or
                Intent.FLAG_ACTIVITY_CLEAR_TOP or
                Intent.FLAG_ACTIVITY_SINGLE_TOP
        )
        .putExtra(MainActivity.SESSION_EXTRA, sessionId)
