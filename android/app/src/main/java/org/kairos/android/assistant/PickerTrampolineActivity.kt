package org.kairos.android.assistant

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts

/**
 * Persist only a short-lived photo-picker URI until the service-backed assistant
 * consumes it. Never write selected photo bytes or a bearer token to disk.
 */
object LibraryAttachment {
    private const val STORE = "kairos.pending-picker"
    private const val URI_KEY = "uri"

    fun hold(context: Context, uri: Uri) {
        clear(context)
        runCatching {
            context.contentResolver.takePersistableUriPermission(
                uri,
                Intent.FLAG_GRANT_READ_URI_PERMISSION,
            )
        }
        check(
            context.getSharedPreferences(STORE, Context.MODE_PRIVATE)
                .edit().putString(URI_KEY, uri.toString()).commit()
        ) {
            "Unable to save pending photo selection."
        }
    }

    fun peek(context: Context): Uri? =
        context.getSharedPreferences(STORE, Context.MODE_PRIVATE)
            .getString(URI_KEY, null)
            ?.let(Uri::parse)

    fun clear(context: Context) {
        val prefs = context.getSharedPreferences(STORE, Context.MODE_PRIVATE)
        val uri = prefs.getString(URI_KEY, null)?.let(Uri::parse)
        prefs.edit().clear().apply()
        if (uri != null) {
            runCatching {
                context.contentResolver.releasePersistableUriPermission(
                    uri,
                    Intent.FLAG_GRANT_READ_URI_PERMISSION,
                )
            }
        }
    }
}

class PickerTrampolineActivity : ComponentActivity() {
    private val picker =
        registerForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri ->
            if (uri == null) {
                finish()
                return@registerForActivityResult
            }
            try {
                LibraryAttachment.hold(applicationContext, uri)
                reopenAssistant()
            } catch (_: Exception) {
                Toast.makeText(this, "Unable to keep selected image.", Toast.LENGTH_SHORT).show()
                finish()
            }
        }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (savedInstanceState == null) {
            picker.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly))
        }
    }

    /** The picked URI remains available if the system does not reopen the assistant. */
    private fun reopenAssistant() {
        try {
            startActivity(
                Intent("android.intent.action.VOICE_COMMAND")
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            )
        } catch (_: Exception) {}
        finish()
    }
}
