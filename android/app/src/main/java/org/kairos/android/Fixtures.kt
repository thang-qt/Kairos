package org.kairos.android

import org.json.JSONObject

// Mirror of src/transcript/protocol.ts. Offsets are CSS pixels (Compose dp on Android).
data class ChatMessage(
    val id: String,
    val role: String,
    val text: String,
    val model: String? = null,
    val streaming: Boolean = false,
    val attachment: ScreenAttachment? = null,
) {
    fun json() = JSONObject().put("id", id).put("role", role).put("text", text)
        .put("model", model).put("streaming", streaming).put("attachment", attachment?.json())
}

data class Session(val id: Int, val title: String, val fixture: Int)

object Fixtures {
    val reply = """
        ## A small architecture experiment

        Keep the shell native and reuse the conversation renderer. The interesting part is how the two surfaces cooperate when your finger changes direction, the keyboard appears, or a long answer is arriving.

        - Scroll vertically through the reply.
        - Pan the long line below in both directions, then try dragging at each boundary.
        - Open the sidebar from the middle of a paragraph.
        - Change the palette and check the code highlighting too.

        ```kotlin
        val architecture = listOf("native Compose header", "native full-width sidebar", "single persistent WebView transcript", "native streaming simulation", "keyboard-aware native composer").joinToString(separator = " → ")
        fun greeting(name: String): String = "Hello, ${'$'}name"
        ```

        | Surface | Renderer | Responsibility | Observation on the phone |
        | --- | --- | --- | --- |
        | Sidebar | Compose | Navigation and theme switching | Drag from anywhere, release quickly, then reverse |
        | Transcript | React + Streamdown | Markdown, code, tables and math | Horizontal scrolling should keep the drawer still |
        | Composer | Compose | Input, stop and simulated streaming | Keyboard should preserve the bottom position |

        Inline math: ${'$'}E = mc^2${'$'}. The Gaussian integral is:

        ${'$'}${'$'}
        \int_{-\infty}^{\infty} e^{-x^2}\,dx = \sqrt{\pi}
        ${'$'}${'$'}

        There is enough prose here to make scrolling a meaningful test. A transcript is a document that changes while you read it. When you scroll away from the latest reply, new text should continue arriving without moving the paragraph under your finger. Returning to the bottom should resume following. The shell should respond to a swipe without waiting for the entire markdown document to render again.

        The native and web colors come from the same source. Try every palette in both modes, including during generation. Code highlighting is asynchronous, so a paint acknowledgement measures the committed text and layout rather than completion of every syntax highlight. Comparing the first and later conversations helps reveal the cost of warming the renderer.

        > Blockquotes, ~~strikethrough~~ and **bold with *nested* emphasis** should render the same in both.

        1. Ordered item
           - nested bullet with `inline code`
           - another one, with ${'$'}\alpha + \beta${'$'} inline
        2. Second ordered item

        - [x] Task that is done
        - [ ] Task still pending

        ---

        [Open the Android documentation](https://developer.android.com/develop/ui/compose)
    """.trimIndent()

    val sessions = List(20) { index ->
        val names = listOf("Architecture sandbox", "Long conversation · 48 turns", "Markdown field notes")
        Session(index, if (index < 3) names[index] else "${names[index % 3]} · ${index + 1}", index % 3)
    }

    fun conversation(fixture: Int): List<ChatMessage> = when (fixture) {
        0 -> listOf(
            ChatMessage("intro-u", "user", "Show me the Android architecture experiment."),
            ChatMessage("intro-a", "assistant", reply, "mock / compose"),
        )
        1 -> List(48) { index ->
            if (index % 2 == 0) ChatMessage("long-$index", "user", "Field test ${index / 2 + 1}: what should I observe?")
            else ChatMessage("long-$index", "assistant", if (index % 8 == 1) reply else """
                ### Observation ${index / 2 + 1}

                Read this paragraph while the next answer streams. The document should stay still after you scroll up. Open and close the full-width sidebar, try a slow reversal, and compare how a fast fling settles. A native shell needs to preserve touch intent while a web document owns text selection and vertical scrolling.

                1. Try a vertical drag.
                2. Try a diagonal drag.
                3. Try a horizontal drag away from code.

                Inline check: ${'$'}a^2 + b^2 = c^2${'$'}.
            """.trimIndent(), "mock / field-test")
        }
        else -> listOf(
            ChatMessage("notes-u", "user", "Can I select text, copy a reply and follow a link?"),
            ChatMessage("notes-a", "assistant", """
                ## Text and gestures

                Long press a reply to open the native actions sheet. **Copy** uses the Android clipboard. Edit, Fork and Delete only display a prototype toast.

                Text selection remains enabled. The 500 ms bridge timer may compete with Chromium's selection gesture; check this on your installed WebView version.

                > Select a few words here and watch whether selection handles remain usable.

            """.trimIndent() + "\n\n" + reply, "mock / markdown"),
        )
    }
}
