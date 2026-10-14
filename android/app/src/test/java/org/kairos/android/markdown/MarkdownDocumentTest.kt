package org.kairos.android.markdown

import org.junit.Assert.*
import org.junit.Test

class MarkdownDocumentTest {
    private fun paragraph(markdown: String, streaming: Boolean = false) =
        (MarkdownDocument.parse(markdown, streaming).single() as MdBlock.Paragraph).content

    @Test fun headingsListsQuotesAndRules() {
        val blocks = MarkdownDocument.parse("# One\n#### Four\n\n> quoted\n\n---\n\n- outer\n  - inner\n\n3. three\n4. four")
        assertEquals(listOf(1, 4), blocks.filterIsInstance<MdBlock.Heading>().map { it.level })
        assertTrue(blocks[2] is MdBlock.Quote)
        assertEquals(MdBlock.Rule, blocks[3])
        val bullets = blocks[4] as MdBlock.ListBlock
        val nested = bullets.items.single().blocks[1] as MdBlock.ListBlock
        assertEquals(1, nested.depth)
        val ordered = blocks[5] as MdBlock.ListBlock
        assertTrue(ordered.ordered)
        assertEquals(3, ordered.start)
    }

    @Test fun inlineStylesStrikeAndLinks() {
        val content = paragraph("**bold** *italic* ~~gone~~ `**code**` [site](https://example.com) https://kairos.dev")
        assertEquals("bold italic gone **code** site https://kairos.dev", content.text)
        assertEquals(setOf(SpanKind.Bold, SpanKind.Italic, SpanKind.Strike, SpanKind.Code, SpanKind.Link), content.spans.map { it.kind }.toSet())
        assertEquals(listOf("https://example.com", "https://kairos.dev"), content.spans.filter { it.kind == SpanKind.Link }.map { it.data })
    }

    @Test fun gfmTablesAndTaskLists() {
        val blocks = MarkdownDocument.parse("| a | b |\n|:-|-:|\n| *x* | 2 |\n\n- [x] done\n- [ ] todo")
        val table = blocks[0] as MdBlock.Table
        assertEquals(listOf("a", "b"), table.header.map { it.text })
        assertEquals(listOf(CellAlign.Start, CellAlign.End), table.aligns)
        assertEquals(SpanKind.Italic, table.rows.single()[0].spans.single().kind)
        val tasks = blocks[1] as MdBlock.ListBlock
        assertEquals(listOf(true, false), tasks.items.map { it.checked })
        assertEquals("done", (tasks.items[0].blocks.single() as MdBlock.Paragraph).content.text)
    }

    @Test fun mathInlineDisplayAndLatexDelimiters() {
        val content = paragraph("Area $\\pi r^2$ and \\(a*b*c\\) cost $5 or $10.")
        val math = content.spans.filter { it.kind == SpanKind.Math }
        assertEquals(listOf("\\pi r^2", "a*b*c"), math.map { it.data })
        assertTrue(content.text.endsWith("cost $5 or $10."))
        assertEquals(MATH_PLACEHOLDER, content.text[math[0].start])

        val blocks = MarkdownDocument.parse("Before\n\n$$\n\\int_0^1 x\\,dx\n$$\n\n\\[E = mc^2\\]\n\n`\$not math\$`")
        assertEquals(listOf("\\int_0^1 x\\,dx", "E = mc^2"), blocks.filterIsInstance<MdBlock.Math>().map { it.tex })
        assertEquals("\$not math\$", (blocks.last() as MdBlock.Paragraph).content.text)
    }

    @Test fun codeFencesKeepLanguageAndIgnoreMath() {
        val code = MarkdownDocument.parse("```kotlin\nval price = \"$5\" // \$x\$\n```").single() as MdBlock.Code
        assertEquals("kotlin", code.language)
        assertEquals("val price = \"$5\" // \$x\$", code.text)
    }

    @Test fun streamingTailIsRepairedSoMarkersNeverFlash() {
        assertEquals("bold", paragraph("**bold", streaming = true).text)
        assertEquals(SpanKind.Bold, paragraph("**bold", streaming = true).spans.single().kind)
        assertEquals("ital", paragraph("Some *ital", streaming = true).text.removePrefix("Some "))
        assertEquals("code **x", paragraph("`code **x", streaming = true).text)
        assertEquals(SpanKind.Math, paragraph("\$x^2", streaming = true).spans.single().kind)
        assertEquals("https://exa", paragraph("[docs](https://exa", streaming = true).spans.single().data)
        // A bullet star is not an emphasis opener.
        val list = MarkdownDocument.parse("* item", streaming = true).single() as MdBlock.ListBlock
        assertEquals("item", (list.items.single().blocks.single() as MdBlock.Paragraph).content.text)
        // Finished replies are never rewritten.
        assertEquals("2 * 3", paragraph("2 * 3").text)
    }

    @Test fun unclosedFencesStreamAsCode() {
        val code = MarkdownDocument.parse("```py\nprint(1)\n**", streaming = true).single() as MdBlock.Code
        assertEquals("print(1)\n**", code.text)
        val math = MarkdownDocument.parse("$$\n\\frac{1}{", streaming = true).single() as MdBlock.Math
        assertEquals("\\frac{1}{", math.tex)
    }
}
