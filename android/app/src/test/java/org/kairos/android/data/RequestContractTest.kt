package org.kairos.android.data

import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.encodeToJsonElement
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Cross-client contract: Android and the web must produce equivalent backend behavior.
 * The web resolves the settings draft client-side and sends it as `settings`, with no
 * top-level generation overrides for Android paths; Android omits every generation field
 * it does not genuinely override. These tests assert the exact serialized JSON key sets —
 * not Kotlin object values — because field presence is the semantics.
 */
class RequestContractTest {
    @Test
    fun persistedSendOmitsAllGenerationFields() {
        val request =
            SendRequest(
                message = "Hello",
                clientId = "client-1",
                clientTime = "2026-10-17T00:00:00Z",
                clientTimeZone = "Europe/Berlin",
                expectedRevision = 7,
                settings = null,
            )
        val encoded = wireJson.encodeToJsonElement(request).jsonObject
        assertEquals(
            setOf(
                "message",
                "clientId",
                "idempotencyKey",
                "clientTime",
                "clientTimeZone",
                "expectedRevision",
                "attachments",
            ),
            encoded.keys,
        )
    }

    @Test
    fun creationCarriesTheSettingsDraft() {
        val request =
            SendRequest(
                message = "Hello",
                clientId = "client-1",
                clientTime = "now",
                clientTimeZone = "UTC",
                settings = ConversationSettings(model = "user:prov:sonnet"),
            )
        val settings = wireJson.encodeToJsonElement(request).jsonObject["settings"]!!.jsonObject
        assertEquals("user:prov:sonnet", settings["model"]!!.jsonPrimitive.content)
        // Defaults are serialized explicitly; the backend normalizes them anyway.
        assertTrue(settings["webSearch"]!!.jsonPrimitive.boolean)
        assertTrue(settings["mathTools"]!!.jsonPrimitive.boolean)
    }

    @Test
    fun explicitUserChoicesArePreservedRatherThanZeroed() {
        // A user who deliberately disables web search in the draft must keep that choice.
        val draft =
            ConversationSettings(model = "m", webSearch = false, mathTools = false, systemPrompt = "")
        val encoded = wireJson.encodeToJsonElement(draft).jsonObject
        assertFalse(encoded["webSearch"]!!.jsonPrimitive.boolean)
        assertFalse(encoded["mathTools"]!!.jsonPrimitive.boolean)
        assertEquals("", encoded["systemPrompt"]!!.jsonPrimitive.content)
    }

    @Test
    fun ephemeralSendsTheResolvedDraftInsteadOfOverrides() {
        val request =
            EphemeralRequest(
                history = listOf(JsonObject(emptyMap())),
                message = "Hi",
                clientId = "c",
                clientTime = "now",
                clientTimeZone = "UTC",
                settings = ConversationSettings(model = "user:prov:opus"),
            )
        val encoded = wireJson.encodeToJsonElement(request).jsonObject
        assertEquals(
            setOf(
                "history",
                "message",
                "clientId",
                "clientTime",
                "clientTimeZone",
                "settings",
                "attachments",
            ),
            encoded.keys,
        )
        val settings = encoded["settings"]!!.jsonObject
        assertEquals("user:prov:opus", settings["model"]!!.jsonPrimitive.content)
        assertFalse(encoded.containsKey("webSearch"))
        assertFalse(encoded.containsKey("systemPrompt"))
        assertFalse(encoded.containsKey("advanced"))
    }

    @Test
    fun commandAcksCarryEffectiveConfiguration() {
        val ack =
            wireJson.decodeFromString<CommandAck>(
                """
                {
                  "sessionKey": "sk",
                  "friendlyId": "conv",
                  "revision": 3,
                  "runId": "run-1",
                  "userTurnId": "t1",
                  "assistantTurnId": "t2",
                  "clientId": "client-1",
                  "effectiveConfiguration": {
                    "model": "user:prov:sonnet",
                    "systemPrompt": "Be concise",
                    "webSearch": true,
                    "mathTools": false,
                    "advanced": {"reasoning": {"effort": "medium"}}
                  }
                }
                """
                    .trimIndent(),
            )
        val effective = ack.effectiveConfiguration!!
        assertEquals("user:prov:sonnet", effective.model)
        assertEquals("Be concise", effective.systemPrompt)
        assertTrue(effective.webSearch)
        assertFalse(effective.mathTools)
        assertEquals("medium", effective.advanced?.get("reasoning")?.jsonObject?.get("effort")?.jsonPrimitive?.content)
    }
}
