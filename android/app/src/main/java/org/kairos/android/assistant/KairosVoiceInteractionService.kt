package org.kairos.android.assistant

import android.service.voice.VoiceInteractionService
import java.lang.ref.WeakReference

class KairosVoiceInteractionService : VoiceInteractionService() {
    companion object {
        private var active: WeakReference<KairosVoiceInteractionService>? = null

        /** Return to our own session; VOICE_COMMAND may resolve to an unrelated role chooser. */
        fun resumePicker(): Boolean {
            val service = active?.get() ?: return false
            return try {
                // No new assist data: the user selected an image, not a screenshot of the picker.
                service.showSession(null, 0)
                true
            } catch (_: IllegalStateException) {
                false
            } catch (_: SecurityException) {
                false
            }
        }
    }

    override fun onReady() {
        super.onReady()
        active = WeakReference(this)
        setDisabledShowContext(0)
    }

    override fun onShutdown() {
        if (active?.get() === this) active = null
        super.onShutdown()
    }

    override fun onDestroy() {
        if (active?.get() === this) active = null
        super.onDestroy()
    }
}
