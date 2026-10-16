package org.kairos.android.data

import kotlinx.coroutines.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject

/**
 * Remote MCP tool calls can require a human decision before the run continues. Approvals are
 * polled while a relevant run is active and decided through POST /api/mcp/approvals/{id}; the
 * same contract as the web's approval dock.
 */
@Serializable
data class McpApproval(
    val id: String,
    val runId: String = "",
    val serverName: String = "",
    val toolName: String = "",
    val arguments: JsonElement? = null,
    val state: String = "",
    val expiresAt: Long = 0,
)

@Serializable
data class McpApprovalsResponse(val approvals: List<McpApproval> = emptyList())

@Serializable
data class McpDecisionRequest(val decision: String, val scope: String? = null)

class McpApprovalsRepository(private val api: KairosApi) {
    private val _pending = MutableStateFlow<List<McpApproval>>(emptyList())
    val pending = _pending.asStateFlow()

    suspend fun refresh() {
        _pending.value = api.get<McpApprovalsResponse>("/api/mcp/approvals").approvals
    }

    suspend fun decide(approval: McpApproval, decision: String, scope: String? = null) {
        api.write<JsonObject, McpDecisionRequest>(
            "/api/mcp/approvals/" + api.encodePath(approval.id),
            "POST",
            McpDecisionRequest(decision, scope),
        )
        refresh()
    }

    fun clear() {
        _pending.value = emptyList()
    }
}

/**
 * The run to poll for approvals: the newest assistant turn while it is still live and has
 * called a remote MCP tool (mcp_*), mirroring the web's mcpApprovalRunId.
 */
fun approvalRunId(messages: List<JsonObject>): String? =
    messages.lastOrNull { it.role == "assistant" }?.takeIf { turn ->
        turn.isLive &&
            turn.parts().any {
                it.string("type") == "toolCall" && it.string("name").orEmpty().startsWith("mcp_")
            }
    }?.runId?.takeIf { it.isNotBlank() }
