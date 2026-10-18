package org.kairos.android.assistant

import android.content.Intent
import android.speech.RecognitionService
import android.speech.SpeechRecognizer

/** AOSP requires recognitionService metadata. This prototype never listens to audio. */
class KairosRecognitionService : RecognitionService() {
    override fun onStartListening(recognizerIntent: Intent, listener: Callback) {
        listener.error(SpeechRecognizer.ERROR_RECOGNIZER_BUSY)
    }

    override fun onStopListening(listener: Callback) {
        listener.error(SpeechRecognizer.ERROR_NO_MATCH)
    }

    override fun onCancel(listener: Callback) {}
}
