package org.kairos.android.data

import kotlinx.serialization.KSerializer
import kotlinx.serialization.Serializable
import kotlinx.serialization.encoding.Decoder
import kotlinx.serialization.encoding.Encoder
import kotlinx.serialization.json.*

val wireJson = Json {
    ignoreUnknownKeys = true
    encodeDefaults = true
    explicitNulls = false
}

@Serializable data class User(val id: String = "", val email: String = "")

@Serializable data class TokenResponse(val token: String, val expiresAt: Long, val user: User)

@Serializable data class MeResponse(val user: User? = null)

@Serializable data class AuthRequest(val email: String, val password: String)

@Serializable data class Health(val ok: Boolean = false)

@Serializable
data class AuthCapabilities(val enabled: Boolean = false, val signupEnabled: Boolean = false)

@Serializable data class Capabilities(val auth: AuthCapabilities = AuthCapabilities())

@Serializable data class CapabilitiesResponse(val capabilities: Capabilities = Capabilities())

@Serializable
data class AdvancedSettings(
    val reasoning: Boolean = false,
    val reasoningEffort: String = "medium",
    val sampling: Boolean = false,
    val temperature: Double = 0.7,
    val topP: Double = 1.0,
    val topK: Double = 0.0,
    val penalties: Boolean = false,
    val frequencyPenalty: Double = 0.0,
    val presencePenalty: Double = 0.0,
    val maxTokens: Boolean = false,
    val maxTokensValue: Double = 4096.0,
)

@Serializable
data class ConversationSettings(
    val model: String = "",
    val systemPrompt: String = "",
    val webSearch: Boolean = true,
    val mathTools: Boolean = true,
    val advanced: AdvancedSettings = AdvancedSettings(),
)

@Serializable
data class SessionSummary(
    val key: String = "",
    val friendlyId: String = "",
    val revision: Long = 0,
    val title: String = "",
    val derivedTitle: String = "",
    val label: String = "",
    val isPinned: Boolean = false,
    val updatedAt: Long = 0,
    val lastMessage: JsonObject? = null,
    val totalTokens: Long = 0,
    val contextTokens: Long = 0,
    val settings: ConversationSettings = ConversationSettings(),
) {
    val displayTitle
        get() =
            label.trim().ifBlank {
                title.trim().ifBlank { derivedTitle.trim().ifBlank { "New chat" } }
            }
}

@Serializable data class SessionsResponse(val sessions: List<SessionSummary> = emptyList(), val nextCursor: String? = null)

@Serializable
data class SearchResult(
    val key: String = "",
    val friendlyId: String = "",
    val title: String = "",
    val derivedTitle: String = "",
    val label: String = "",
    val updatedAt: Long = 0,
    val messageId: String = "",
    val snippet: String = "",
) {
    val displayTitle
        get() =
            label.trim().ifBlank {
                title.trim().ifBlank { derivedTitle.trim().ifBlank { "New chat" } }
            }
}

@Serializable data class SearchResponse(val sessions: List<SearchResult> = emptyList())

@Serializable
data class History(
    val sessionKey: String = "",
    val sessionId: String? = null,
    val revision: Long = -1,
    val cursor: Long = 0,
    val activeRunIds: List<String> = emptyList(),
    val messages: List<JsonObject> = emptyList(),
)

@Serializable(with = TurnPatchSerializer::class)
data class TurnPatch(val op: String, val path: List<String>, val value: JsonElement? = null)

// JSON null is a value; an absent value is the web reducer's undefined/failure sentinel.
object TurnPatchSerializer : KSerializer<TurnPatch> {
    override val descriptor = JsonObject.serializer().descriptor

    override fun deserialize(decoder: Decoder): TurnPatch {
        val fields = (decoder as JsonDecoder).decodeJsonElement().jsonObject
        return TurnPatch(
            fields.getValue("op").jsonPrimitive.content,
            fields.getValue("path").jsonArray.map { it.jsonPrimitive.content },
            fields["value"],
        )
    }

    override fun serialize(encoder: Encoder, value: TurnPatch) {
        (encoder as JsonEncoder).encodeJsonElement(
            buildJsonObject {
                put("op", value.op)
                put("path", JsonArray(value.path.map(::JsonPrimitive)))
                value.value?.let { put("value", it) }
            }
        )
    }
}

@Serializable
data class ConversationEvent(
    val state: String = "",
    val revision: Long? = null,
    val cursor: Long? = null,
    val runId: String? = null,
    val sessionKey: String? = null,
    val friendlyId: String? = null,
    val turnId: String? = null,
    val message: JsonObject? = null,
    val turnPatch: List<TurnPatch> = emptyList(),
    val snapshot: History? = null,
    val activeRunIds: List<String>? = null,
    val session: SessionSummary? = null,
    val error: String? = null,
)

@Serializable
data class CommandAck(
    val sessionKey: String = "",
    val key: String = "",
    val friendlyId: String = "",
    val revision: Long? = null,
    val runId: String? = null,
    val userTurnId: String? = null,
    val assistantTurnId: String? = null,
    val clientId: String? = null,
    val userTurn: JsonObject? = null,
    val removedTurnIds: List<String> = emptyList(),
    val invalidatedRunIds: List<String> = emptyList(),
)

@Serializable data class AttachmentPayload(val mimeType: String, val content: String)

/**
 * Throwaway requests post the full displayed history and stream the answer without ever
 * creating a session. Field names must match the Go struct exactly.
 */
@Serializable
data class EphemeralRequest(
    val history: List<JsonObject>,
    val message: String,
    val model: String,
    val clientId: String,
    val clientTime: String,
    val clientTimeZone: String,
    val systemPrompt: String = "",
    val webSearch: Boolean = true,
    val mathTools: Boolean = true,
    val advanced: JsonObject? = null,
    val attachments: List<AttachmentPayload> = emptyList(),
)

@Serializable
data class SendRequest(
    val message: String,
    val model: String,
    val clientId: String,
    val idempotencyKey: String = clientId,
    val clientTime: String,
    val clientTimeZone: String,
    val expectedRevision: Long? = null,
    val attachments: List<AttachmentPayload> = emptyList(),
    val settings: ConversationSettings? = null,
    val systemPrompt: String = "",
    val webSearch: Boolean = true,
    val mathTools: Boolean = true,
    val advanced: JsonObject? = null,
)

@Serializable data class SettingsRequest(val settings: ConversationSettings)

@Serializable data class RenameRequest(val label: String)

@Serializable data class PinRequest(val isPinned: Boolean)

@Serializable data class CloneRequest(val messageId: String)

@Serializable data class StopRequest(val runId: String)

@Serializable data class RetryRequest(val idempotencyKey: String, val expectedRevision: Long)

@Serializable
data class Model(
    val id: String,
    val modelRef: String = "",
    val name: String = "",
    val providerRef: String = "",
    val providerLabel: String = "",
    val contextWindow: Long = 0,
) {
    val key
        get() = modelRef.ifBlank { id }

    val displayName
        get() = name.trim().ifBlank { id }
}

@Serializable data class UserPreferences(val defaultModelId: String = "")

@Serializable
data class ModelCapabilities(
    val canSelectModel: Boolean = true,
    val defaultModelLocked: Boolean = false,
)

@Serializable
data class ModelsResponse(
    val models: List<Model> = emptyList(),
    val preferences: UserPreferences = UserPreferences(),
    val capabilities: ModelCapabilities = ModelCapabilities(),
)

@Serializable data class PreferencesRequest(val defaultModelId: String)

@Serializable
data class PreferencesResponse(val preferences: UserPreferences = UserPreferences())

@Serializable
data class ChatSettingsResponse(val settings: ChatSettingsPreferences = ChatSettingsPreferences())

@Serializable
data class ChatSettingsPreferences(
    val defaultSettings: ConversationSettings = ConversationSettings(),
    val modelOverrides: Map<String, ConversationSettings> = emptyMap(),
)

fun JsonObject.string(key: String): String? = (this[key] as? JsonPrimitive)?.contentOrNull

val JsonObject.id
    get() = string("id").orEmpty()
val JsonObject.role
    get() = string("role").orEmpty()
val JsonObject.status
    get() = string("status").orEmpty()
val JsonObject.runId
    get() = string("runId").orEmpty()
val JsonObject.clientId
    get() = string("clientId").orEmpty()
val JsonObject.canRetry
    get() = (this["canRetry"] as? JsonPrimitive)?.booleanOrNull == true
val JsonObject.isLive
    get() = role == "assistant" && status in listOf("queued", "preparing", "running")
val JsonObject.modelName
    get() = string("modelName") ?: string("model")

fun JsonObject.parts(): List<JsonObject> =
    (this["content"] as? JsonArray)?.mapNotNull { it as? JsonObject }.orEmpty()

fun JsonObject.copyText(): String =
    parts()
        .filter { it.string("type") == "text" }
        .joinToString("") { it.string("text").orEmpty() }
        .trim()

fun JsonObject.answerText(): String =
    parts()
        .filter { it.string("type") == "text" && it.string("phase") != "commentary" }
        .joinToString("") { it.string("text").orEmpty() }
        .trim()

fun activeRunId(history: History): String? =
    history.messages.lastOrNull { it.isLive }?.runId?.takeIf { it.isNotBlank() }
        ?: history.activeRunIds.firstOrNull()
