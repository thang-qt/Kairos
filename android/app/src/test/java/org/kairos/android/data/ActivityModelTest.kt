package org.kairos.android.data

import kotlinx.serialization.json.jsonObject
import org.junit.Assert.*
import org.junit.Test

class ActivityModelTest {
    private fun tool(json: String): ActivityStep.Tool {
        val message = wireJson.parseToJsonElement(json).jsonObject
        return activitySteps(message, splitAssistantActivity(message).activityIndexes).single() as ActivityStep.Tool
    }

    @Test
    fun completedCallUsesArgumentsAndStepResult() {
        val step = tool("""{
            "role":"assistant", "status":"completed",
            "content":[{"type":"toolCall","id":"call-1","name":"terminal","status":"completed","arguments":{"label":"Check files"}}],
            "steps":[{"role":"toolResult","toolCallId":"call-1","content":[{"type":"text","text":"Found three files"}]}]
        }""")
        assertEquals("Ran command: Check files", step.title)
        assertEquals("Found three files", step.meta)
        assertFalse(step.running)
    }

    @Test
    fun persistedResultCompletesCallWithoutStatus() {
        val step = tool("""{
            "role":"assistant",
            "content":[{"type":"toolCall","id":"call-1","name":"math_eval","arguments":{"expr":"1+1"}}],
            "details":{"tools":[{"id":"call-1","result":{"value":2}}]}
        }""")
        assertFalse(step.running)
        assertTrue(step.meta.contains("2"))
    }

    @Test
    fun interruptedCallShowsFailureInsteadOfRunning() {
        val step = tool("""{
            "role":"assistant",
            "content":[{"type":"toolCall","id":"call-1","name":"terminal","status":"interrupted"}]
        }""")
        assertFalse(step.running)
        assertTrue(step.failed)
        assertEquals("No result was saved for this call.", step.meta)
    }

    @Test
    fun completedWebCallShowsSources() {
        val step = tool("""{
            "role":"assistant",
            "content":[{"type":"toolCall","id":"call-1","name":"web_search","status":"completed"}],
            "details":{"webTools":[{"id":"call-1","name":"web_search","arguments":{"query":"Kairos"},"result":{"url":"https://example.com","title":"Kairos"}}]}
        }""")
        assertFalse(step.running)
        assertTrue(step.web)
        assertEquals("Searched “Kairos”", step.title)
        assertEquals("Kairos", step.sources.single().title)
    }
    @Test
    fun mcpResultUsesSavedServerAndToolNamesAndKeepsOutputInDetails() {
        val step = tool("""{
            "role":"assistant",
            "content":[{"type":"toolCall","id":"call-1","name":"mcp_opaque_hash","status":"completed","arguments":{"path":"README.md"}}],
            "steps":[{"role":"toolResult","toolCallId":"call-1","details":{"mcpServer":"Files","mcpTool":"read_file"},"content":[{"type":"text","text":"Large tool output"}]}]
        }""")
        assertEquals("Called Files · read_file", step.title)
        assertEquals("path: README.md", step.meta)
        assertTrue(step.details.contains("Large tool output"))
        assertFalse(step.title.contains("opaque"))
    }

    @Test
    fun runningMcpCallUsesCatalogLabelsAndNeverExposesAlias() {
        val message = wireJson.parseToJsonElement("""{
            "role":"assistant",
            "content":[{"type":"toolCall","id":"call-1","name":"mcp_opaque_hash","status":"running"}]
        }""").jsonObject
        val indexes = splitAssistantActivity(message).activityIndexes
        val labeled = activitySteps(message, indexes, mapOf("mcp_opaque_hash" to "Files · read_file")).single() as ActivityStep.Tool
        val fallback = activitySteps(message, indexes).single() as ActivityStep.Tool
        assertEquals("Calling Files · read_file", labeled.title)
        assertEquals("Calling remote tool", fallback.title)
        assertTrue(labeled.running)
    }

    @Test
    fun webCallsUseRequestArgumentsBeforeEventsArrive() {
        val search = tool("""{
            "role":"assistant","content":[{"type":"toolCall","id":"search","name":"web_search","status":"running","arguments":{"query":"Kairos"}}]
        }""")
        val fetch = tool("""{
            "role":"assistant","content":[{"type":"toolCall","id":"fetch","name":"web_fetch","status":"completed","arguments":{"url":"https://example.com/page"}}]
        }""")
        assertEquals("Searching “Kairos”", search.title)
        assertEquals("Read https://example.com/page", fetch.title)
        assertFalse(fetch.running)
    }

    @Test
    fun searchSourcesReadTheResultList() {
        val step = tool("""{
            "role":"assistant",
            "content":[{"type":"toolCall","id":"search","name":"web_search","status":"completed"}],
            "details":{"webTools":[{"id":"search","name":"web_search","arguments":{"query":"Kairos"},"result":{"results":[{"title":"One","url":"https://one.example","snippet":"Preview"},{"title":"Two","url":"https://two.example"}]}}]}
        }""")
        assertEquals(listOf("One", "Two"), step.sources.map { it.title })
        assertEquals("Preview", step.sources.first().content)
    }

}
