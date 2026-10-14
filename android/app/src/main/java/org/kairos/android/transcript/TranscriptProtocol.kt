package org.kairos.android.transcript

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import org.kairos.android.data.wireJson

val transcriptJson = Json(wireJson) { explicitNulls = true }

@Serializable data class TranscriptTheme(val palette: String, val mode: String)

@Serializable data class TranscriptInsets(val top: Float, val bottom: Float)

@Serializable
data class TranscriptInit(
    val type: String = "init",
    val theme: TranscriptTheme,
    val insets: TranscriptInsets,
    val messages: List<JsonObject>,
    val sessionId: String?,
)

@Serializable data class TranscriptUpsert(val type: String = "upsert", val message: JsonObject)

@Serializable data class TranscriptRemove(val type: String = "remove", val id: String)
