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
    fun latestRequestHasNoActivityUntilItsAssistantTurnArrives() {
        val messages = listOf(message("u1", "user"), message("a1", "assistant"), message("u2", "user"))
        assertNull(currentOverlayResponse(messages))
    }

    @Test
    fun emptyConversationHasNoResponse() {
        assertNull(currentOverlayResponse(emptyList()))
    }
    private fun answer(id: String, text: String) =
        wireJson.parseToJsonElement("""{
            "id":"$id","role":"assistant","status":"completed",
            "content":[{"type":"text","phase":"final_answer","text":"$text"}]
        }""").jsonObject

    @Test
    fun keepsPreviousAnswerWhileTypingAndAfterSendingFollowUp() {
        val previous = answer("a1", "Previous answer")
        val messages = listOf(message("u1", "user"), previous)
        assertEquals(previous, displayedOverlayResponse(messages))
        assertEquals(previous, displayedOverlayResponse(messages + message("u2", "user")))
    }

    @Test
    fun keepsPreviousAnswerWhileNewTurnThinksSearchesOrNarrates() {
        val previous = answer("a1", "Previous answer")
        val current = wireJson.parseToJsonElement("""{
            "id":"a2","role":"assistant","status":"running",
            "content":[
                {"type":"thinking","thinking":"Let me check"},
                {"type":"text","phase":"commentary","text":"I will search for that"},
                {"type":"toolCall","id":"search","name":"web_search","status":"running","arguments":{"query":"New question"}}
            ]
        }""").jsonObject
        val messages = listOf(message("u1", "user"), previous, message("u2", "user"), current)
        assertEquals(previous, displayedOverlayResponse(messages))
        assertEquals(current, currentOverlayResponse(messages))
        assertEquals("Searching “New question”", overlayWorkingLabel(currentOverlayResponse(messages)))
    }

    @Test
    fun replacesPreviousAnswerWhenNewAnswerStartsStreaming() {
        val previous = answer("a1", "Previous answer")
        val current = wireJson.parseToJsonElement("""{
            "id":"a2","role":"assistant","status":"running",
            "content":[{"type":"text","phase":"final_answer","text":"New answer starts"}]
        }""").jsonObject
        val messages = listOf(message("u1", "user"), previous, message("u2", "user"), current)
        assertEquals(current, displayedOverlayResponse(messages))
        assertEquals("Writing response…", overlayWorkingLabel(currentOverlayResponse(messages)))
    }

    @Test
    fun answerSelectionMatchesRendererHoldRuleForUnphasedNarration() {
        val previous = answer("a1", "Previous answer")
        val current = wireJson.parseToJsonElement("""{
            "id":"a2","role":"assistant","status":"running",
            "content":[
                {"type":"toolCall","id":"search","name":"web_search"},
                {"type":"text","text":"Let me check one more source."}
            ]
        }""").jsonObject
        assertEquals(previous, displayedOverlayResponse(listOf(previous, message("u2", "user"), current)))
    }

    @Test
    fun failedOrStoppedTurnWithoutAnswerDoesNotRemovePreviousAnswer() {
        val previous = answer("a1", "Previous answer")
        for (status in listOf("error", "aborted", "interrupted")) {
            val current = wireJson.parseToJsonElement("""{
                "id":"a2","role":"assistant","status":"$status","content":[]
            }""").jsonObject
            assertEquals(previous, displayedOverlayResponse(listOf(previous, message("u2", "user"), current)))
        }
    }

    @Test
    fun firstRequestWithoutAnswerAndClearedConversationHaveNoReplyPane() {
        assertNull(displayedOverlayResponse(listOf(message("u1", "user"), message("a1", "assistant"))))
        assertNull(displayedOverlayResponse(emptyList()))
    }

}
