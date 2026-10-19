package org.kairos.android.data

import kotlinx.serialization.json.*

// Port of conversation-event-reducer.ts. Turns remain opaque; clone only modified paths.
fun applyTurnPatch(turn: JsonObject, operations: List<TurnPatch>): JsonObject? {
    var result: JsonElement = turn
    for (operation in operations) {
        if (operation.path.any { it in listOf("__proto__", "constructor", "prototype") })
            return null
        result = patchValue(result, operation.path, operation) ?: return null
    }
    return result as? JsonObject
}

private fun patchValue(
    current: JsonElement?,
    path: List<String>,
    operation: TurnPatch,
): JsonElement? {
    if (path.isEmpty()) {
        if (operation.op == "append") {
            val before = current as? JsonPrimitive ?: return null
            val value = operation.value as? JsonPrimitive ?: return null
            return if (before.isString && value.isString)
                JsonPrimitive(before.content + value.content)
            else null
        }
        return if (operation.op == "remove") null else operation.value
    }
    val key = path.first()
    val rest = path.drop(1)
    return when (current) {
        is JsonObject -> {
            val copy = current.toMutableMap()
            if (rest.isEmpty() && operation.op == "remove") copy.remove(key)
            else copy[key] = patchValue(copy[key], rest, operation) ?: return null
            JsonObject(copy)
        }
        is JsonArray -> {
            if (!key.matches(Regex("^\\d+$"))) return null
            val index = key.toIntOrNull() ?: return null
            if (index > current.size) return null
            val copy = current.toMutableList()
            if (rest.isEmpty() && operation.op == "remove") {
                if (index < copy.size) copy.removeAt(index)
            } else {
                val value = patchValue(copy.getOrNull(index), rest, operation) ?: return null
                if (index == copy.size) copy.add(value) else copy[index] = value
            }
            JsonArray(copy)
        }
        else -> null
    }
}

fun turnFromConversationEvent(event: ConversationEvent): JsonObject? {
    val turn = event.message?.takeIf { it.id.isNotEmpty() } ?: return null
    return JsonObject(
        turn.toMutableMap().apply {
            event.revision?.let { put("revision", JsonPrimitive(it)) }
            if (turn.string("runId") == null) event.runId?.let { put("runId", JsonPrimitive(it)) }
            if (event.state == "delta" && event.runId == null) remove("__streamRunId")
            else
                put(
                    "__streamRunId",
                    if (event.state == "delta") JsonPrimitive(event.runId!!) else JsonNull,
                )
        }
    )
}

fun applyConversationEvent(messages: List<JsonObject>, event: ConversationEvent): List<JsonObject> {
    val revision =
        messages.maxOfOrNull { (it["revision"] as? JsonPrimitive)?.longOrNull ?: -1 } ?: -1
    if (event.revision != null && event.revision < revision) return messages
    var turn = turnFromConversationEvent(event)
    if (event.turnPatch.isNotEmpty() && event.turnId != null) {
        val previous = messages.find { it.id == event.turnId } ?: return messages
        val patched = applyTurnPatch(previous, event.turnPatch) ?: return messages
        turn =
            JsonObject(
                patched.toMutableMap().apply {
                    event.revision?.let { put("revision", JsonPrimitive(it)) }
                    put("__streamRunId", event.runId?.let(::JsonPrimitive) ?: JsonNull)
                }
            )
    }
    turn ?: return messages
    val index =
        messages.indexOfFirst {
            it.id == turn.id || (turn.clientId.isNotEmpty() && it.clientId == turn.clientId)
        }
    return if (index < 0) messages + turn else messages.toMutableList().apply { set(index, turn) }
}

fun applyConversationCommand(turns: List<JsonObject>, ack: CommandAck): List<JsonObject> {
    val next =
        turns
            .filter { it.id !in ack.removedTurnIds && it.runId !in ack.invalidatedRunIds }
            .toMutableList()
    val user = ack.userTurn ?: return next
    val index =
        next.indexOfFirst {
            it.id == user.id || (user.clientId.isNotEmpty() && it.clientId == user.clientId)
        }
    if (index < 0) next.add(user) else next[index] = user
    return next
}

fun acceptConversationCommand(previous: History, ack: CommandAck): History {
    if ((ack.revision ?: -1) < previous.revision) return previous
    return previous.copy(
        sessionKey = ack.sessionKey.ifBlank { previous.sessionKey },
        revision = ack.revision ?: previous.revision,
        messages = applyConversationCommand(previous.messages, ack),
    )
}

data class EventApplication(
    val history: History,
    val refetch: Boolean = false,
    val accepted: Boolean = true,
)

// Preserve the order in use-chat-stream.ts: snapshot, revision, cursor, refetch, identity, reducer,
// cursor. Approvals ride the same stream: a dedicated event carries the decision state, and
// reconcile/terminal events prune stale pending approvals for finished runs.
fun handleConversationEvent(previous: History, event: ConversationEvent): EventApplication {
    event.mcpApproval?.let { approval ->
        val pending =
            previous.pendingMcpApprovals.filter { it.id != approval.id } +
                if (approval.state == "pending") listOf(approval) else emptyList()
        return EventApplication(
            previous.copy(
                pendingMcpApprovals = pending,
                revision = event.revision ?: previous.revision,
                cursor = event.cursor ?: previous.cursor,
            )
        )
    }
    if (event.state == "heartbeat") return EventApplication(previous, accepted = false)
    event.snapshot?.let { snapshot ->
        return if (snapshot.revision >= previous.revision && snapshot.cursor >= previous.cursor)
            EventApplication(snapshot)
        else EventApplication(previous, accepted = false)
    }
    if (event.revision != null && event.revision < previous.revision)
        return EventApplication(previous, accepted = false)
    if (event.cursor != null && event.cursor > 0 && event.cursor <= previous.cursor)
        return EventApplication(previous, accepted = false)
    var next = previous
    var refetch = false
    if (event.revision != null && event.revision > previous.revision) {
        next =
            next.copy(
                revision = event.revision,
                messages =
                    if (event.state == "reconcile" && previous.revision >= 0) emptyList()
                    else previous.messages,
                pendingMcpApprovals = remainingApprovals(next, event),
            )
        refetch = true
    }
    if (event.message == null && event.turnPatch.isEmpty()) {
        if (event.state in listOf("reconcile", "final", "error", "aborted")) {
            next =
                next.copy(
                    messages = applyConversationEvent(next.messages, event),
                    pendingMcpApprovals = remainingApprovals(next, event),
                )
            refetch = true
        }
        return EventApplication(next, refetch)
    }
    if (
        !event.sessionKey.isNullOrEmpty() &&
            previous.sessionKey.isNotEmpty() &&
            event.sessionKey != previous.sessionKey
    )
        return EventApplication(next, refetch, accepted = false)
    if (event.message == null && previous.messages.none { it.id == event.turnId })
        return EventApplication(next, refetch = true)
    val turns = applyConversationEvent(next.messages, event)
    val affected =
        if (event.message != null) turnFromConversationEvent(event)
        else turns.find { it.id == event.turnId }
    next = next.copy(messages = turns, pendingMcpApprovals = remainingApprovals(next, event))
    if (affected != null) {
        next =
            next.copy(
                revision = event.revision ?: next.revision,
                cursor = event.cursor ?: next.cursor,
                activeRunIds = event.activeRunIds ?: next.activeRunIds,
            )
        if (event.state in listOf("final", "error", "aborted")) refetch = true
    }
    return EventApplication(next, refetch)
}

/**
 * Port of the web's remainingApprovals: a reconcile keeps approvals for runs that are still
 * active, a terminal event drops the run's approvals, everything else keeps the pending set.
 */
fun remainingApprovals(previous: History, event: ConversationEvent): List<McpApproval> {
    val pending = previous.pendingMcpApprovals
    if (event.state == "reconcile") {
        val active = event.activeRunIds ?: return emptyList()
        return pending.filter { approval -> approval.runId in active }
    }
    if (event.state in listOf("final", "error", "aborted"))
        return pending.filter { approval -> approval.runId != event.runId }
    return pending
}
