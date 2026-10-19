package org.kairos.android.data

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement

/**
 * Remote MCP tool calls can require a human decision before the run continues. Approvals ride
 * the conversation stream: the history payload carries pending approvals, decision changes
 * arrive as `mcp-approval` events, and reconcile/terminal events prune finished runs. The
 * only outgoing call is the decision itself (POST /api/mcp/approvals/{id}).
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
data class McpDecisionRequest(val decision: String, val scope: String? = null)
