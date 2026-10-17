package org.kairos.android.assistant

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * The assistant overlay is service-backed and cannot hold an activity result itself, so the
 * photo picker runs in this transparent trampoline. The decoded, size-reduced attachment is
 * handed to the overlay through a process-lifetime holder; the overlay consumes it on its
 * next show (the system usually re-opens Kairos right away).
 */
object LibraryAttachment {
    @Volatile
    var pending: ScreenAttachment? = null
}

class PickerTrampolineActivity : ComponentActivity() {
    private val picker =
        registerForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri ->
            if (uri != null) {
                lifecycleScope.launch {
                    LibraryAttachment.pending =
                        withContext(Dispatchers.IO) {
                            runCatching {
                                ScreenAttachment.fromUri(applicationContext, uri)
                            }.getOrNull()
                        }
                    reopenAssistant()
                }
            } else finish()
        }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // Do not relaunch the picker when ActivityResultRegistry restores an in-flight
        // request after the process or activity was recreated.
        if (savedInstanceState == null) {
            picker.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly))
        }
    }

    /** Falls back to leaving the pending attachment for the next invocation. */
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
