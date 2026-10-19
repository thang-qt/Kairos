package org.kairos.android.assistant

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts

/** Short-lived, identity-bound picker journal. Only the owning result can consume it. */
object LibraryAttachment {
    private const val STORE = "kairos.pending-picker"

    private fun prefs(context: Context) = context.getSharedPreferences(STORE, Context.MODE_PRIVATE)
    private fun identity(context: Context): String? {
        val app = (context.applicationContext as org.kairos.android.app.ChatApplication).container
        return attachmentIdentity(app.server.url, app.tokens.token)
    }

    internal fun pending(context: Context): AttachmentHandoff? {
        val values = prefs(context)
        val id = values.getString("requestId", null)
        if (id == null) { clear(context); return null }
        val ticket = AttachmentHandoff(
            id, values.getString("identity", "").orEmpty(), values.getLong("createdAt", 0),
            values.getString("sessionId", null), values.getString("uri", null),
            values.getBoolean("returned", false),
        )
        if (!ticket.isValid(identity(context), System.currentTimeMillis())) {
            clear(context, id)
            return null
        }
        return ticket
    }

    fun begin(context: Context, sessionId: String?): String {
        val currentIdentity = checkNotNull(identity(context)) { "Sign in before attaching an image." }
        clear(context)
        val id = java.util.UUID.randomUUID().toString()
        check(prefs(context).edit()
            .putString("requestId", id).putString("identity", currentIdentity)
            .putLong("createdAt", System.currentTimeMillis()).putString("sessionId", sessionId)
            .commit()) { "Unable to start image selection." }
        return id
    }

    fun hold(context: Context, uri: Uri, requestId: String) = hold(context, listOf(uri), requestId)

    fun selectedUris(context: Context): List<Uri> {
        val values = prefs(context)
        val encoded = values.getString("uris", null)
        return if (encoded != null) {
            val array = org.json.JSONArray(encoded)
            (0 until array.length()).map { Uri.parse(array.getString(it)) }
        } else listOfNotNull(values.getString("uri", null)?.let(Uri::parse))
    }

    fun hold(context: Context, uris: List<Uri>, requestId: String) {
        check(pending(context)?.requestId == requestId) { "Image selection expired." }
        val selected = uris.distinct()
        selected.forEach { uri ->
            runCatching {
                context.contentResolver.takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }
        }
        if (!prefs(context).edit().putString("uri", selected.firstOrNull()?.toString())
                .putString("uris", org.json.JSONArray(selected.map { it.toString() }).toString())
                .putBoolean("returned", true).commit()) {
            selected.forEach { release(context, it) }
            error("Unable to save pending photo selection.")
        }
    }

    fun cancel(context: Context, requestId: String) {
        if (pending(context)?.requestId == requestId)
            prefs(context).edit().putBoolean("returned", true).apply()
    }

    fun peek(context: Context): Uri? = pending(context)?.uri?.let(Uri::parse)

    fun clear(context: Context, expectedRequestId: String? = null) {
        val values = prefs(context)
        if (expectedRequestId != null && values.getString("requestId", null) != expectedRequestId) return
        val uris = selectedUris(context)
        values.edit().clear().apply()
        uris.forEach { release(context, it) }
    }

    private fun release(context: Context, uri: Uri) {
        CameraAttachment.remove(context, uri)
        runCatching {
            context.contentResolver.releasePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
    }
}

class PickerTrampolineActivity : ComponentActivity() {
    private var cameraUri: Uri? = null
    private val requestId: String
        get() = intent.getStringExtra("requestId").orEmpty()
    private val camera = registerForActivityResult(ActivityResultContracts.TakePicture()) { success ->
        val uri = cameraUri
        if (success && uri != null) {
            try {
                LibraryAttachment.hold(applicationContext, uri, requestId)
                reopenAssistant()
            } catch (_: Exception) {
                CameraAttachment.remove(this, uri)
                Toast.makeText(this, "Unable to attach photo.", Toast.LENGTH_SHORT).show()
                finish()
            }
        } else {
            CameraAttachment.remove(this, uri)
            LibraryAttachment.cancel(this, requestId)
            reopenAssistant()
        }
    }
    private val picker =
        registerForActivityResult(ActivityResultContracts.PickMultipleVisualMedia()) { uris ->
            if (uris.isEmpty()) {
                LibraryAttachment.cancel(this, requestId)
                reopenAssistant()
                return@registerForActivityResult
            }
            try {
                LibraryAttachment.hold(applicationContext, uris, requestId)
                reopenAssistant()
            } catch (_: Exception) {
                Toast.makeText(this, "Unable to keep selected image.", Toast.LENGTH_SHORT).show()
                finish()
            }
        }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        cameraUri = savedInstanceState?.getString("cameraUri")?.let(Uri::parse)
        if (LibraryAttachment.pending(this)?.requestId != requestId) {
            CameraAttachment.remove(this, cameraUri)
            finish()
            return
        }
        if (savedInstanceState == null) {
            try {
                if (intent.getBooleanExtra("camera", false)) {
                    cameraUri = CameraAttachment.create(this)
                    camera.launch(checkNotNull(cameraUri))
                } else {
                    picker.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly))
                }
            } catch (_: Exception) {
                CameraAttachment.remove(this, cameraUri)
                Toast.makeText(this, "Unable to open attachment source.", Toast.LENGTH_SHORT).show()
                LibraryAttachment.cancel(this, requestId)
                reopenAssistant()
            }
        }
    }

    override fun onSaveInstanceState(outState: Bundle) {
        cameraUri?.let { outState.putString("cameraUri", it.toString()) }
        super.onSaveInstanceState(outState)
    }

    /** The picked URI remains available if the system does not reopen the assistant. */
    private fun reopenAssistant() {
        if (LibraryAttachment.pending(this)?.requestId != requestId) { finish(); return }
        if (!KairosVoiceInteractionService.resumePicker()) {
            Toast.makeText(this, "Open the Kairos assistant to continue.", Toast.LENGTH_SHORT).show()
        }
        finish()
    }
}
