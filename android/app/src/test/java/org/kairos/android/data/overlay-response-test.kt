package org.kairos.android.data

import kotlinx.serialization.json.jsonObject
import org.junit.Assert.*
import org.junit.Test

class OverlayResponseTest {
    private fun message(id: String, role: String) =
        wireJson.parseToJsonElement("""{"id":"$id","role":"$role"}""").jsonObject

    @Test
    fun showsOnlyLatestAssistantResponse() {
        val messages = listOf(message("u1", "user"), message("a1", "assistant"),
            message("u2", "user"), message("a2", "assistant"))
        assertEquals("a2", currentOverlayResponse(messages)?.id)
    }

    @Test
    fun clearsPreviousResponseWhenNextRequestStarts() {
        val messages = listOf(message("u1", "user"), message("a1", "assistant"), message("u2", "user"))
        assertNull(currentOverlayResponse(messages))
    }

    @Test
    fun emptyConversationHasNoResponse() {
        assertNull(currentOverlayResponse(emptyList()))
    }
}
