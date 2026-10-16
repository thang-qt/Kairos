package org.kairos.android.data

import java.time.Instant
import java.time.ZoneId
import kotlinx.serialization.json.*
import org.junit.Assert.*
import org.junit.Test

class ProtocolTest {
    private fun objectFrom(text: String) = wireJson.parseToJsonElement(text).jsonObject

    private fun resource(name: String) =
        checkNotNull(javaClass.classLoader!!.getResource(name)).readText()

    @Test
    fun decodeGoStructSamplesWithoutDroppingRawTurnFields() {
        val samples = objectFrom(resource("go-dtos.json"))
        val token = wireJson.decodeFromJsonElement<TokenResponse>(samples.getValue("token"))
        assertEquals(1900000000L, token.expiresAt)
        assertEquals("demo@example.com", token.user.email)
        assertTrue(
            wireJson
                .decodeFromJsonElement<CapabilitiesResponse>(samples.getValue("capabilities"))
                .capabilities
                .auth
                .enabled
        )
        val history = wireJson.decodeFromJsonElement<History>(samples.getValue("history"))
        assertEquals(12L, history.cursor)
        assertEquals(listOf("run"), history.activeRunIds)
        assertEquals(
            true,
            history.messages[1]["extra"]!!.jsonObject["untouched"]!!.jsonPrimitive.boolean,
        )
        val session = wireJson.decodeFromJsonElement<SessionSummary>(samples.getValue("session"))
        assertTrue(session.isPinned)
        assertEquals("provider/model", session.settings.model)
        val models = wireJson.decodeFromJsonElement<ModelsResponse>(samples.getValue("models"))
        assertEquals("provider/model", models.preferences.defaultModelId)
        assertEquals(128000L, models.models[0].contextWindow)
        val ack = wireJson.decodeFromJsonElement<CommandAck>(samples.getValue("ack"))
        assertEquals("client", ack.userTurn!!.clientId)
        assertEquals(
            history.messages,
            wireJson
                .decodeFromString<History>(wireJson.encodeToString(History.serializer(), history))
                .messages,
        )
    }

    @Test
    fun strictRequestFieldsMatchCreateAndSendGoStructs() {
        val request =
            SendRequest(
                "Hello",
                "model",
                "client",
                clientTime = "2026-10-14T00:00:00Z",
                clientTimeZone = "UTC",
            )
        val existing = wireJson.encodeToJsonElement(request).jsonObject
        assertFalse(existing.containsKey("settings"))
        assertFalse(existing.containsKey("expectedRevision"))
        assertEquals("client", existing.string("idempotencyKey"))
        val created =
            wireJson
                .encodeToJsonElement(request.copy(settings = ConversationSettings(model = "model")))
                .jsonObject
        assertTrue(created.containsKey("settings"))
        assertEquals(
            0.7,
            created["settings"]!!
                .jsonObject["advanced"]!!
                .jsonObject["temperature"]!!
                .jsonPrimitive
                .double,
            0.0,
        )
    }

    @Test
    fun pagedSessionListCarriesCursor() {
        val payload =
            objectFrom(
                """{"sessions":[{"friendlyId":"s1","revision":3,"updatedAt":5}],"nextCursor":"abc"}"""
            )
        val response = wireJson.decodeFromJsonElement<SessionsResponse>(payload)
        assertEquals("abc", response.nextCursor)
        assertEquals("s1", response.sessions.single().friendlyId)
        // Legacy unpaged payloads and omitted cursors stay compatible.
        assertEquals(null, wireJson.decodeFromString<SessionsResponse>("{\"sessions\":[]}").nextCursor)
    }

    @Test
    fun sseFramingHandlesChunkBoundariesCommentsCRLFBomAndMultilineData() {
        val frames = mutableListOf<SseFrame>()
        val parser = SseParser(frames::add)
        val raw =
            "\uFEFF: connected\r\n\r\nid: 12\r\nretry: 2500\r\ndata: {\r\ndata: \"state\":\"heartbeat\"}\r\n\r\ndata: second\r\rdata: third\n\n"
        raw.forEach { parser.feed(it.toString()) }
        assertEquals(3, frames.size)
        assertEquals("{\n\"state\":\"heartbeat\"}", frames[0].data)
        assertEquals("12", frames[0].id)
        assertEquals(2500L, frames[0].retryMillis)
        assertEquals("second", frames[1].data)
        assertEquals("third", frames[2].data)
        parser.feed("data: unfinished")
        assertEquals(3, frames.size) // Incomplete frames must wait for a reconnect snapshot.
    }

    @Test
    fun revisionsCursorsSnapshotsAndUnknownPatchTargetsFollowWebOrder() {
        val turn =
            objectFrom(
                """{"id":"a","role":"assistant","revision":2,"status":"running","runId":"run","content":[{"type":"text","text":"Hi"}]}"""
            )
        val before =
            History(
                "key",
                revision = 2,
                cursor = 8,
                messages = listOf(turn),
                activeRunIds = listOf("run"),
            )
        assertFalse(
            handleConversationEvent(before, ConversationEvent(state = "heartbeat")).accepted
        )
        assertFalse(
            handleConversationEvent(
                    before,
                    ConversationEvent(revision = 1, cursor = 9, message = turn),
                )
                .accepted
        )
        assertFalse(
            handleConversationEvent(
                    before,
                    ConversationEvent(revision = 2, cursor = 8, message = turn),
                )
                .accepted
        )
        assertFalse(
            handleConversationEvent(before, ConversationEvent(snapshot = before.copy(cursor = 7)))
                .accepted
        )
        val snapshot = before.copy(cursor = 10, messages = emptyList(), activeRunIds = emptyList())
        assertEquals(
            snapshot,
            handleConversationEvent(before, ConversationEvent(snapshot = snapshot)).history,
        )
        val higher =
            handleConversationEvent(before, ConversationEvent(state = "reconcile", revision = 3))
        assertTrue(higher.refetch)
        assertTrue(higher.history.messages.isEmpty())
        val missing =
            handleConversationEvent(
                before,
                ConversationEvent(
                    state = "delta",
                    revision = 2,
                    cursor = 9,
                    turnId = "missing",
                    turnPatch = listOf(TurnPatch("set", listOf("status"), JsonPrimitive("running"))),
                ),
            )
        assertTrue(missing.refetch)
        assertEquals(8L, missing.history.cursor)
        assertEquals("run", activeRunId(before))
        assertEquals(
            "fallback",
            activeRunId(before.copy(messages = emptyList(), activeRunIds = listOf("fallback"))),
        )
        assertNull(
            activeRunId(
                before.copy(
                    messages =
                        listOf(
                            JsonObject(
                                turn.toMutableMap().apply {
                                    put("status", JsonPrimitive("aborted"))
                                }
                            )
                        ),
                    activeRunIds = emptyList(),
                )
            )
        )
        assertEquals(before, acceptConversationCommand(before, CommandAck(revision = 1)))
    }

    @Test
    fun historyAndSseFramesProduceOneCanonicalUserAndTerminalAssistant() {
        val optimistic =
            objectFrom(
                """{"id":"local","role":"user","clientId":"client","content":[{"type":"text","text":"Hello"}]}"""
            )
        var history = History("key", revision = 1, cursor = 1, messages = listOf(optimistic))
        val events =
            listOf(
                """{"state":"user","revision":1,"cursor":2,"sessionKey":"key","message":{"id":"u","clientId":"client","role":"user","content":[{"type":"text","text":"Hello"}]}}""",
                """{"state":"delta","revision":1,"cursor":3,"sessionKey":"key","runId":"run","message":{"id":"a","role":"assistant","status":"running","content":[{"type":"text","text":"A"}],"steps":[]}}""",
                """{"state":"delta","revision":1,"cursor":4,"sessionKey":"key","turnId":"a","runId":"run","turnPatch":[{"op":"append","path":["content","0","text"],"value":"nswer"}]}""",
                """{"state":"delta","revision":1,"cursor":4,"sessionKey":"key","turnId":"a","runId":"run","turnPatch":[{"op":"append","path":["content","0","text"],"value":"nswer"}]}""",
                """{"state":"error","revision":1,"cursor":5,"sessionKey":"key","runId":"run","message":{"id":"a","role":"assistant","status":"interrupted","canRetry":true,"content":[{"type":"text","text":"Answer"}],"steps":[]}}""",
            )
        val parser = SseParser { frame ->
            history =
                handleConversationEvent(history, wireJson.decodeFromString(frame.data)).history
        }
        val wire =
            events
                .mapIndexed { index, event -> "id: ${index + 2}\ndata: $event\n\n" }
                .joinToString("")
        wire.chunked(7).forEach(parser::feed)
        assertEquals(2, history.messages.size)
        assertEquals("u", history.messages[0].id)
        assertEquals("Answer", history.messages[1].copyText())
        assertEquals("interrupted", history.messages[1].status)
        assertTrue(history.messages[1].canRetry)
        assertEquals(JsonNull, history.messages[1]["__streamRunId"])
    }

    @Test
    fun nativeProtocolPreservesRawJsonAndStreamingUpsertContainsOnlyItsTurn() {
        val user =
            objectFrom(
                """{"id":"u","role":"user","extra":true,"content":[{"type":"image","source":{"type":"base64","media_type":"image/png","data":"aW1hZ2U="}}]}"""
            )
        val assistant =
            objectFrom(
                """{"id":"a","role":"assistant","content":[{"type":"text","text":"Reply"}]}"""
            )
        val init =
            org.kairos.android.transcript.TranscriptInit(
                theme = org.kairos.android.transcript.TranscriptTheme("mist", "dark"),
                insets = org.kairos.android.transcript.TranscriptInsets(48f, 120f),
                messages = listOf(user, assistant),
                sessionId = null,
            )
        val json = org.kairos.android.transcript.transcriptJson.encodeToJsonElement(init).jsonObject
        assertEquals(JsonNull, json["sessionId"])
        assertEquals(user, json["messages"]!!.jsonArray[0])
        val upsert =
            org.kairos.android.transcript.transcriptJson
                .encodeToJsonElement(
                    org.kairos.android.transcript.TranscriptUpsert(message = assistant)
                )
                .jsonObject
        assertEquals(assistant, upsert["message"])
        assertFalse(upsert.toString().contains("aW1hZ2U="))
    }

    @Test
    fun groupingUsesPinnedFirstLocalMidnightAndExactRollingBoundaries() {
        val now = Instant.parse("2026-10-14T15:00:00Z").toEpochMilli()
        val today = Instant.parse("2026-10-14T00:00:00Z").toEpochMilli()
        val day = 86400000L
        val sessions =
            listOf(
                SessionSummary(friendlyId = "pin", isPinned = true),
                SessionSummary(friendlyId = "today", updatedAt = today),
                SessionSummary(friendlyId = "yesterday", updatedAt = today - day),
                SessionSummary(friendlyId = "7", updatedAt = today - 7 * day),
                SessionSummary(friendlyId = "30", updatedAt = today - 30 * day),
                SessionSummary(friendlyId = "older", updatedAt = today - 30 * day - 1),
            )
        assertEquals(
            listOf("Pinned", "Today", "Yesterday", "Previous 7 days", "Previous 30 days", "Older"),
            groupSessions(sessions, now, ZoneId.of("UTC")).map { it.label },
        )
        assertTrue(groupSessions(emptyList(), now).isEmpty())
    }

    @Test
    fun urlNormalizationAndEncryptionNote() {
        assertEquals("https://kairos.example.com", normalizeServerUrl(" kairos.example.com/// "))
        assertEquals("http://192.168.1.7:8080", normalizeServerUrl("http://192.168.1.7:8080/"))
        listOf(
                "http://localhost",
                "http://127.0.0.1",
                "http://10.0.0.2",
                "http://172.16.0.1",
                "http://192.168.1.7",
                "http://[::1]",
                "http://[fd00::1]",
            )
            .forEach { assertFalse(it, isUnencryptedRemote(it)) }
        assertTrue(isUnencryptedRemote("http://example.com"))
        assertTrue(isUnencryptedRemote("http://172.32.0.1"))
        assertFalse(isUnencryptedRemote("https://example.com"))
        listOf(
                "",
                "ftp://example.com",
                "https://user:password@example.com",
                "https://example.com?token=secret",
                "https://example.com#fragment",
            )
            .forEach { assertTrue(it, runCatching { normalizeServerUrl(it) }.isFailure) }
    }
}
