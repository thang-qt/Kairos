package org.kairos.android.data

import kotlinx.serialization.json.JsonObject

/** The latest request owns composer activity, independently of the answer displayed above it. */
fun currentOverlayResponse(messages: List<JsonObject>): JsonObject? {
    val requestIndex = messages.indexOfLast { it.role == "user" }
    return messages.drop(requestIndex + 1).lastOrNull { it.role == "assistant" }
}

/** Keep the last visible answer until a later assistant turn has answer content to render. */
fun displayedOverlayResponse(messages: List<JsonObject>): JsonObject? =
    messages.lastOrNull { message ->
        if (message.role != "assistant") return@lastOrNull false
        val parts = message.parts()
        splitAssistantActivity(message).answerIndexes.any { index ->
            !parts.getOrNull(index)?.string("text").isNullOrBlank()
        }
    }

/** Only backend message parts/results supply the activity label; never invent execution state. */
fun overlayWorkingLabel(message: JsonObject?, labels: Map<String, String> = emptyMap()): String {
    if (message == null) return "Preparing response…"
    val parts = message.parts()
    val split = splitAssistantActivity(message)
    for (index in parts.indices.reversed()) {
        val part = parts[index]
        if (part.string("type") == "text" && !part.string("text").isNullOrBlank()) {
            return if (part.string("phase") == "commentary") "Thinking…" else "Writing response…"
        }
        if (part.string("type") == "toolCall") {
            val step = activitySteps(message, listOf(index), labels).firstOrNull() as? ActivityStep.Tool
            if (step?.running == true) return step.title
        }
        if (part.string("type") == "thinking" && !part.string("thinking").isNullOrBlank()) return "Thinking…"
    }
    return if (split.toolCount > 0) "Working…" else "Thinking…"
}
