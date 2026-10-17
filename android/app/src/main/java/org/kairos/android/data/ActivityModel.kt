package org.kairos.android.data

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.longOrNull

/** Ports of the web's activity classification utilities (message-item-utils, tool-step-item). */

fun isAssistantStreaming(message: JsonObject): Boolean =
    message.status in listOf("queued", "preparing", "running") ||
        (message["__streamRunId"] != null && message["__streamRunId"] !is JsonNull)

/** Web normalizeMessageTimestamp: seconds, milliseconds, or ISO text. */
fun normalizeMessageTimestamp(value: Any?): Long? =
    when (value) {
        is Number ->
            if (value.toLong() < 1_000_000_000_000L) (value.toLong() * 1000) else value.toLong()
        is JsonPrimitive -> {
            val raw = if (value.isString) null else value.longOrNull
            when {
                raw != null -> if (raw < 1_000_000_000_000L) raw * 1000 else raw
                value.isString ->
                    runCatching { java.time.Instant.parse(value.content).toEpochMilli() }
                        .getOrNull()
                else -> null
            }
        }
        else -> null
    }

private fun JsonObject.record(key: String): JsonObject? =
    (this[key] as? JsonObject)?.takeIf { it.isNotEmpty() }

private fun JsonObject.text(key: String): String? = string(key)?.trim()?.ifEmpty { null }

data class ActivitySplit(
    val activityIndexes: List<Int>,
    val answerIndexes: Set<Int>,
    val toolCount: Int,
    val hasThinking: Boolean,
    val durationMs: Long,
)

/** Port of splitAssistantActivity with the web's answer-hold rule while streaming. */
fun splitAssistantActivity(
    message: JsonObject,
    streaming: Boolean = isAssistantStreaming(message),
): ActivitySplit {
    val parts = message.parts()
    val toolCount = parts.count { it.string("type") == "toolCall" }
    val finalTextIndex = parts.indexOfLast { it.string("type") == "text" }
    val lastToolIndex = if (toolCount > 0) parts.indexOfLast { it.string("type") == "toolCall" } else -1
    val answerStart =
        if (toolCount == 0) 0
        else if (finalTextIndex > lastToolIndex) finalTextIndex else parts.size
    val answerIndexes = mutableSetOf<Int>()
    val unphasedAnswer = mutableSetOf<Int>()
    val activityIndexes = mutableListOf<Int>()
    var thinkingCount = 0
    parts.forEachIndexed { index, part ->
        when (part.string("type")) {
            "thinking" -> {
                if (part.text("thinking") == null) return@forEachIndexed
                thinkingCount += 1
                activityIndexes.add(index)
            }
            "toolCall" -> activityIndexes.add(index)
            "text" -> {
                if (part.text("text") == null) return@forEachIndexed
                when {
                    part.string("phase") == "final_answer" -> answerIndexes.add(index)
                    part.string("phase") == "commentary" -> activityIndexes.add(index)
                    index >= answerStart -> unphasedAnswer.add(index)
                    else -> activityIndexes.add(index)
                }
            }
        }
    }
    if (
        unphasedAnswer.isNotEmpty() &&
            activityIndexes.isNotEmpty() &&
            streaming &&
            !looksLikeAnswer(parts, unphasedAnswer)
    ) {
        activityIndexes.addAll(unphasedAnswer)
        activityIndexes.sort()
    } else {
        answerIndexes.addAll(unphasedAnswer)
    }
    return ActivitySplit(
        activityIndexes = activityIndexes,
        answerIndexes = answerIndexes,
        toolCount = toolCount,
        hasThinking = thinkingCount > 0,
        durationMs = workingDurationMs(message),
    )
}

private const val ANSWER_HOLD_MAX_CHARS = 160

private fun looksLikeAnswer(parts: List<JsonObject>, answerIndexes: Set<Int>): Boolean {
    val text =
        answerIndexes.mapNotNull { parts.getOrNull(it) }.joinToString("") { it.text("text").orEmpty() }
    return text.trim().length > ANSWER_HOLD_MAX_CHARS || text.contains('\n')
}

/** Wall-clock duration from turn start to completion or the last recorded step. */
fun workingDurationMs(message: JsonObject): Long {
    val steps = message["steps"] as? JsonArray
    val startedAt = normalizeMessageTimestamp(message["timestamp"])
    var endedAt = normalizeMessageTimestamp(message["completedAt"])
    steps?.forEach { step ->
        (step as? JsonObject)?.let { record ->
            normalizeMessageTimestamp(record["timestamp"])?.let { ts ->
                val current = endedAt
                if (current == null || ts > current) endedAt = ts
            }
        }
    }
    val completed = endedAt
    if (startedAt != null && completed != null && completed > startedAt) return completed - startedAt
    val fallback =
        steps
            ?.mapNotNull { it as? JsonObject }
            ?.filter { it.role == "toolResult" }
            ?.sumOf { step ->
                val duration = step.record("details")?.get("durationMs") as? JsonPrimitive
                duration?.longOrNull ?: 0L
            } ?: 0L
    return fallback
}

fun formatActivityDuration(durationMs: Long): String =
    when {
        durationMs < 1000 -> "${maxOf(1, durationMs)}ms"
        durationMs < 60_000 -> "${"%.1f".format(durationMs / 1000.0)}s"
        else -> {
            val total = durationMs / 1000
            "${total / 60}m ${total % 60}s"
        }
    }

fun activityLabel(
    streaming: Boolean,
    toolCount: Int,
    hasThinking: Boolean,
    durationMs: Long,
): String =
    when {
        streaming -> if (toolCount > 0) "Working…" else "Thinking…"
        toolCount > 0 && durationMs > 0 -> "Worked for ${formatActivityDuration(durationMs)}"
        toolCount > 0 -> "Used $toolCount ${if (toolCount == 1) "tool" else "tools"}"
        hasThinking && durationMs > 0 ->
            if (durationMs < 5000) "Thought briefly" else "Thought for ${formatActivityDuration(durationMs)}"
        hasThinking -> "Thought"
        else -> "Activity"
    }

/** While a turn streams, web steps wait for their results so they appear once, complete. */
fun visibleActivityIndexes(
    message: JsonObject,
    activityIndexes: List<Int>,
    streaming: Boolean,
): List<Int> {
    if (!streaming) return activityIndexes
    val parts = message.parts()
    return activityIndexes.filter { index ->
        val part = parts.getOrNull(index) ?: return@filter true
        if (part.string("type") != "toolCall") return@filter true
        !(part.string("name") == "web_search" || part.string("name") == "web_fetch") ||
            part.string("status") !in listOf(null, "running")
    }
}

/** One rendered step in the activity timeline. */
sealed interface ActivityStep {
    data class Thinking(val content: String, val streaming: Boolean) : ActivityStep

    data class Narration(val text: String) : ActivityStep

    data class Tool(
        val title: String,
        val meta: String,
        val running: Boolean,
        val failed: Boolean,
        val web: Boolean,
        val sources: List<WebSource> = emptyList(),
        val details: String = "",
    ) : ActivityStep
}

data class WebSource(val title: String, val url: String, val content: String?)

/** Builds the display steps for a turn's activity indexes. */
fun activitySteps(message: JsonObject, indexes: List<Int>, mcpLabels: Map<String, String> = emptyMap()): List<ActivityStep> {
    val parts = message.parts()
    val steps = (message["steps"] as? JsonArray)?.mapNotNull { it as? JsonObject }.orEmpty()
    return indexes.mapNotNull { index ->
        val part = parts.getOrNull(index) ?: return@mapNotNull null
        when (part.string("type")) {
            "thinking" ->
                part.text("thinking")?.let { ActivityStep.Thinking(it, isAssistantStreaming(message)) }
            "text" -> part.text("text")?.let { ActivityStep.Narration(it) }
            "toolCall" -> toolStep(part, message, steps, mcpLabels)
            else -> null
        }
    }
}

private fun resultFor(callId: String?, steps: List<JsonObject>): JsonObject? =
    if (callId.isNullOrBlank()) null
    else steps.lastOrNull { it.role == "toolResult" && it.string("toolCallId") == callId }

private fun resultText(result: JsonObject?): String =
    result?.parts()?.filter { it.string("type") == "text" }?.joinToString("") { it.text("text").orEmpty() }
        ?.trim().orEmpty()

private fun webEvents(message: JsonObject, callId: String?): List<JsonObject> {
    val details = message.record("details") ?: return emptyList()
    val events = (details["webTools"] as? JsonArray)?.mapNotNull { it as? JsonObject }.orEmpty()
    return events.filter { event ->
        val name = event.text("name") ?: return@filter false
        if (name != "web_search" && name != "web_fetch") return@filter false
        val id = event.text("id")
        if (callId != null) id == callId else true
    }
}

fun webSources(message: JsonObject, callId: String?): List<WebSource> {
    val details = message.record("details") ?: return emptyList()
    val events = (details["webTools"] as? JsonArray)?.mapNotNull { it as? JsonObject }.orEmpty()
    val sources = linkedMapOf<String, WebSource>()
    for (event in events) {
        val name = event.text("name") ?: continue
        if (name != "web_search" && name != "web_fetch") continue
        val id = event.text("id")
        if (callId != null && id != callId) continue
        val result = event.record("result") ?: continue
        val records = if (name == "web_search") {
            (result["results"] as? JsonArray)?.mapNotNull { it as? JsonObject }
                ?: listOf(result)
        } else listOf(result)
        for (record in records) {
            val url = record.text("url") ?: continue
            if (sources.containsKey(url)) continue
            sources[url] = WebSource(
                record.text("title") ?: hostnameFromUrl(url) ?: url,
                url, record.text("text") ?: record.text("snippet"),
            )
        }
    }
    return sources.values.toList()
}

private fun hostnameFromUrl(url: String): String? =
    runCatching { java.net.URI(url).host?.removePrefix("www.") }.getOrNull()

private fun toolStep(
    part: JsonObject,
    message: JsonObject,
    steps: List<JsonObject>,
    mcpLabels: Map<String, String>,
): ActivityStep {
    val callId = part.string("id")
    val name = part.string("name").orEmpty()
    val status = part.string("status")
    val result = resultFor(callId, steps)
    val event = (message.record("details")?.get("tools") as? JsonArray)
        ?.mapNotNull { it as? JsonObject }
        ?.lastOrNull { it.string("id") == callId }
    val savedOutput = event?.record("result")
    val error = event?.text("error") ?: savedOutput?.text("error")
    val failed = status in listOf("error", "aborted", "interrupted", "output-error") ||
        (result?.get("isError") as? JsonPrimitive)?.booleanOrNull == true || error != null
    val completed = status in listOf("completed", "output-available") ||
        result != null || savedOutput != null
    val running = !completed && !failed
    val isWebTool = name == "web_search" || name == "web_fetch"
    if (isWebTool) {
        val events = webEvents(message, callId)
        val arguments = part.record("arguments") ?: part.text("partialJson")?.let {
            runCatching { wireJson.parseToJsonElement(it) as? JsonObject }.getOrNull()
        }
        val requests = events.mapNotNull { event ->
            val args = event.record("arguments")
            val out = event.record("result")
            Triple(event.text("name") ?: name,
                args?.text("query") ?: out?.text("query"),
                args?.text("url") ?: out?.text("url"))
        }.ifEmpty { listOf(Triple(name, arguments?.text("query"), arguments?.text("url"))) }
        return webStep(
            requests,
            events.mapNotNull { it.text("error") },
            running = running,
            webSources(message, callId),
        )
    }
    val input = part.record("arguments")
    val label = input?.text("label")
    val resultDetails = result?.record("details") ?: savedOutput
    val serverName = resultDetails?.text("mcpServer")
    val toolName = resultDetails?.text("mcpTool")
    val displayName = if (serverName != null && toolName != null) "$serverName · $toolName"
        else mcpLabels[name]
    val title = if (name.startsWith("mcp_")) {
        val action = if (completed) "Called" else "Calling"
        "$action ${displayName ?: "remote tool"}" + (label?.let { ": $it" } ?: "")
    } else toolActionTitle(name, completed, label, input)
    val outputText = resultText(result).ifEmpty { savedOutput?.toString().orEmpty() }
    val meta =
        when {
            failed -> error ?: resultText(result).ifEmpty { "No result was saved for this call." }
            name.startsWith("mcp_") -> argumentSummary(input)
            completed -> outputText
            else -> ""
        }
    return ActivityStep.Tool(
        title = title,
        meta = meta,
        running = running,
        failed = failed,
        web = false,
        details = if (name.startsWith("mcp_")) {
            listOfNotNull(
                input?.let { "Input\n$it" },
                outputText.takeIf { it.isNotBlank() }?.let { "Output\n$it" },
            ).joinToString("\n\n")
        } else "",
    )
}

private fun webStep(
    events: List<Triple<String, String?, String?>>,
    errors: List<String>,
    running: Boolean,
    sources: List<WebSource>,
): ActivityStep.Tool {
    val title =
        when {
            events.isEmpty() -> "Using the web"
            errors.isNotEmpty() -> {
                val verb = if (running) "Searching" else "Searched"
                "$verb the web"
            }
            else -> {
                val searches = events.count { it.first == "web_search" }
                val fetches = events.count { it.first == "web_fetch" }
                val searchVerb = if (running) "Searching" else "Searched"
                val readVerb = if (running) "Reading" else "Read"
                when {
                    searches > 0 && fetches > 0 -> "$searchVerb $searches× and read $fetches pages"
                    searches > 1 -> "$searchVerb $searches queries"
                    fetches > 1 -> "$readVerb $fetches pages"
                    fetches == 1 -> {
                        val target = sources.firstOrNull()?.title ?: events[0].third
                        if (target != null) "$readVerb $target" else readVerb
                    }
                    else -> {
                        val target = events[0].second ?: events[0].third
                        if (target != null) "$searchVerb “$target”" else searchVerb
                    }
                }
            }
        }
    val meta =
        when {
            errors.isNotEmpty() -> errors.first()
            events.size == 1 && events[0].first == "web_fetch" ->
                events[0].third?.let { hostnameFromUrl(it) ?: it }.orEmpty()
            else -> ""
        }
    return ActivityStep.Tool(title, meta, running, errors.isNotEmpty(), web = true, sources = sources)
}

private fun toolActionTitle(
    name: String,
    completed: Boolean,
    label: String?,
    input: JsonObject?,
): String =
    when {
        label != null -> "${toolActionName(name, completed)}: $label"
        name == "math_eval" -> {
            val expr = input?.text("expr")
            if (expr != null) "Calculating: $expr" else "Calculating"
        }
        name.startsWith("mcp_") -> {
            if (completed) "Called remote tool" else "Calling remote tool"
        }
        else -> toolActionName(name, completed)
    }

private fun toolActionName(name: String, completed: Boolean): String {
    val verb = when (name) {
        "terminal" -> if (completed) "Ran command" else "Running command"
        "read_file", "read" -> if (completed) "Read file" else "Reading file"
        "list_files", "list_directory" -> if (completed) "Listed files" else "Listing files"
        "write_file", "write" -> if (completed) "Wrote file" else "Writing file"
        else -> {
            val humanized = name.replace('_', ' ')
            if (completed) "Used $humanized" else "Using $humanized"
        }
    }
    return verb
}

fun argumentSummary(input: JsonObject?): String =
    input?.entries
        ?.filter { it.value !is JsonNull && !(it.value is JsonPrimitive && (it.value as JsonPrimitive).content.isEmpty()) }
        ?.joinToString(", ") { (key, value) ->
            val text =
                if (value is JsonPrimitive) value.content
                else runCatching { value.toString() }.getOrDefault("").take(200)
            "$key: ${if (text.length > 40) text.take(40) + "…" else text}"
        }
        .orEmpty()
