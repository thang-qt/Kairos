package org.kairos.android

import android.service.voice.VoiceInteractionService

class KairosVoiceInteractionService : VoiceInteractionService() {
    override fun onReady() {
        super.onReady()
        // Screenshots require the assist-data request to stay enabled; the session discards
        // the structure unread. Screenshots are offered, never auto-attached.
        setDisabledShowContext(0)
    }
}
