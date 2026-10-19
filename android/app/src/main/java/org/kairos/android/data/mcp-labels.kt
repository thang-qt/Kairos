package org.kairos.android.data

import androidx.compose.runtime.*
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.serialization.json.*

/** Presentation labels only. Tool eligibility and approvals remain backend-owned. */
class McpLabels(private val api: BackendApi) {
    var labels by mutableStateOf<Map<String, String>>(emptyMap())
        private set

    fun clear() { labels = emptyMap() }

    suspend fun refresh() {
        val identity = api.tokens.token
        val serverUrl = api.server.url
        if (identity == null) { clear(); return }
        try {
            val servers = api.get<JsonObject>("/api/mcp/servers")["servers"] as? JsonArray
            val entries = coroutineScope {
                servers.orEmpty().mapNotNull { it as? JsonObject }
                    .filter { (it["enabled"] as? JsonPrimitive)?.booleanOrNull == true }
                    .map { server -> async {
                        val id = server.string("id") ?: return@async emptyList<Pair<String, String>>()
                        val name = server.string("name").orEmpty()
                        val tools = api.get<JsonObject>("/api/mcp/servers/${api.encodePath(id)}/tools")["tools"] as? JsonArray
                        tools.orEmpty().mapNotNull { tool ->
                            val record = tool as? JsonObject ?: return@mapNotNull null
                            val alias = record.string("alias") ?: return@mapNotNull null
                            val toolName = record.string("name") ?: return@mapNotNull null
                            alias to "$name · $toolName"
                        }
                    } }.awaitAll().flatten()
            }
            if (api.tokens.token == identity && api.server.url == serverUrl) labels = entries.toMap()
        } catch (e: CancellationException) { throw e }
        catch (_: Exception) { /* Saved result metadata remains available offline. */ }
    }
}
