package org.kairos.android.data

import kotlinx.serialization.json.*
import org.junit.Assert.*
import org.junit.Test

class ReducerParityTest {
    @Test
    fun sameFixturesAsWebReducer() {
        val text =
            checkNotNull(javaClass.classLoader!!.getResource("conversation-events.json")).readText()
        val fixtures = wireJson.parseToJsonElement(text).jsonArray
        for (value in fixtures) {
            val fixture = value.jsonObject
            val before = fixture.getValue("messages").jsonArray.map { it.jsonObject }
            val original = wireJson.encodeToString(JsonArray.serializer(), JsonArray(before))
            val actual =
                if (fixture["event"] != null) {
                    applyConversationEvent(
                        before,
                        wireJson.decodeFromJsonElement<ConversationEvent>(fixture.getValue("event")),
                    )
                } else
                    applyConversationCommand(
                        before,
                        wireJson.decodeFromJsonElement<CommandAck>(fixture.getValue("command")),
                    )
            assertEquals(fixture.string("name"), fixture.getValue("expected"), JsonArray(actual))
            assertEquals(
                "Immutable input: " + fixture.string("name"),
                original,
                wireJson.encodeToString(JsonArray.serializer(), JsonArray(before)),
            )
        }
    }
}
