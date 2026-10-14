package org.kairos.android

import kotlinx.coroutines.delay

/** Same whitespace-token simulation for the transcript and the native assistant. */
object MockStreaming {
    suspend fun reply(attachedScreen: Boolean = false, onToken: (index: Int, text: String) -> Unit) {
        val acknowledgement = if (attachedScreen) "I can see the screenshot you attached… This is a mock acknowledgement; no vision model was called.\n\n" else ""
        Regex("\\S+\\s*|\\s+").findAll(acknowledgement + Fixtures.reply).forEachIndexed { index, match ->
            delay(30)
            onToken(index, match.value)
        }
    }
}
