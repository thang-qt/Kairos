package org.kairos.android

import org.junit.Assert.*
import org.junit.Test
import org.kairos.android.ui.theme.KairosPalettes

class OverlayMarkdownTest {
    @Test fun paragraphsHeadingsAndNestedLists() {
        val parsed = OverlayMarkdownParser.parse("# One\n## Two\n### Three\n\nParagraph\ncontinued\n\n- Outer\n  - Inner\n1. Ordered\n  2. Nested")
        assertEquals(listOf(1, 2, 3), parsed.blocks.filterIsInstance<MarkdownBlock.Heading>().map { it.level })
        assertEquals("Paragraph\ncontinued", (parsed.blocks[3] as MarkdownBlock.Paragraph).content.text)
        val items = parsed.blocks.filterIsInstance<MarkdownBlock.ListItem>()
        assertEquals(listOf(0, 1, 0, 1), items.map { it.nesting })
        assertEquals(listOf("•", "•", "1.", "2."), items.map { it.marker })
        assertFalse(parsed.needsFullView)
    }

    @Test fun inlineStylesLinksAndLiteralCode() {
        val inline = OverlayMarkdownParser.inline("**bold** *italic* `**literal**` [Android](https://developer.android.com)")
        assertEquals("bold italic **literal** Android", inline.text)
        assertEquals(setOf(InlineKind.Bold, InlineKind.Italic, InlineKind.Code, InlineKind.Link), inline.spans.map { it.kind }.toSet())
        assertEquals("https://developer.android.com", inline.spans.single { it.kind == InlineKind.Link }.href)
        val annotated = inline.annotated(KairosPalettes[0].light) { }
        assertEquals(inline.text, annotated.text)
        assertEquals(3, annotated.spanStyles.size)
        assertEquals(1, annotated.getLinkAnnotations(0, annotated.length).size)
    }

    @Test fun partialEmphasisAndInlineCodeHaveStableVisibleText() {
        for (marker in listOf("**", "*", "`")) {
            val open = OverlayMarkdownParser.inline("${marker}hello")
            val closed = OverlayMarkdownParser.inline("${marker}hello$marker")
            assertEquals("hello", open.text)
            assertEquals(open, closed)
        }
        assertEquals("*literal*", OverlayMarkdownParser.inline("\\*literal\\*").text)
    }

    @Test fun openFencePreservesCodeAndDoesNotParseItsContents() {
        val open = OverlayMarkdownParser.parse("```kotlin\nval x = \"**literal**\"\nprintln(x)")
        val code = open.blocks.single() as MarkdownBlock.Code
        assertEquals("kotlin", code.language)
        assertEquals("val x = \"**literal**\"\nprintln(x)", code.text)
        assertFalse(code.closed)
        for (partialClose in listOf("`", "``")) {
            assertEquals(code, OverlayMarkdownParser.parse("```kotlin\n${code.text}\n$partialClose").blocks.single())
        }
        val closed = OverlayMarkdownParser.parse("```kotlin\n${code.text}\n```\n\nAfter")
        assertEquals(code.copy(closed = true), closed.blocks[0])
        assertTrue(closed.blocks[1] is MarkdownBlock.Paragraph)
        assertEquals("", (OverlayMarkdownParser.parse("```kot").blocks.single() as MarkdownBlock.Code).text)
    }

    @Test fun unsupportedContentStaysPlainAndRequestsFullView() {
        for (text in listOf("| A | B |\n| --- | --- |\n| 1 | 2 |", "${'$'}E=mc^2${'$'}", "${'$'}${'$'}\nx+y\n${'$'}${'$'}", "<b>HTML</b>")) {
            val parsed = OverlayMarkdownParser.parse(text)
            assertTrue(parsed.needsFullView)
            assertEquals(text, (parsed.blocks.single() as MarkdownBlock.Plain).text)
        }
        assertFalse(OverlayMarkdownParser.parse("```html\n<b>literal</b>\n```").needsFullView)
    }

    @Test fun everyStreamingPrefixHasValidRangesAndNeverCrashes() {
        val input = "# Heading\n\n**Partial *nested*** and `code` 😀 [link](https://example.com)\n\n- item\n  1. nested\n\n```kotlin\nval x = 1\n```\n\n| A | B |\n\n${'$'}x${'$'}"
        for (length in 0..input.length) {
            val prefix = input.take(length)
            val parsed = OverlayMarkdownParser.parse(prefix)
            val inline = OverlayMarkdownParser.inline(prefix)
            inline.spans.forEach { assertTrue(it.start >= 0 && it.end <= inline.text.length && it.start < it.end) }
            assertNotNull(inline.annotated(KairosPalettes[0].light) { })
            assertNotNull(parsed)
        }
    }
}
