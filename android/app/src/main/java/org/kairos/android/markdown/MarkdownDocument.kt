package org.kairos.android.markdown

import org.commonmark.ext.autolink.AutolinkExtension
import org.commonmark.ext.gfm.strikethrough.Strikethrough
import org.commonmark.ext.gfm.strikethrough.StrikethroughExtension
import org.commonmark.ext.gfm.tables.TableBlock
import org.commonmark.ext.gfm.tables.TableBody
import org.commonmark.ext.gfm.tables.TableCell
import org.commonmark.ext.gfm.tables.TableHead
import org.commonmark.ext.gfm.tables.TableRow
import org.commonmark.ext.gfm.tables.TablesExtension
import org.commonmark.ext.task.list.items.TaskListItemMarker
import org.commonmark.ext.task.list.items.TaskListItemsExtension
import org.commonmark.node.*
import org.commonmark.parser.Parser

/*
 * Pure JVM model of an assistant reply: CommonMark + GFM (what Streamdown renders on the web)
 * plus remark-math style `$…$` / `$$…$$`. No Android types, so it is unit-tested on the JVM.
 */

enum class SpanKind { Bold, Italic, Strike, Code, Link, Math }

/** [start, end) in [RichText.text]. Math spans cover one [MATH_PLACEHOLDER] char; data is the TeX. */
data class Span(val kind: SpanKind, val start: Int, val end: Int, val data: String? = null)

data class RichText(val text: String, val spans: List<Span>) {
    val isBlank get() = text.isBlank()
}

enum class CellAlign { Start, Center, End }

sealed interface MdBlock {
    data class Paragraph(val content: RichText) : MdBlock
    data class Heading(val level: Int, val content: RichText) : MdBlock
    data class Quote(val blocks: List<MdBlock>) : MdBlock
    data class ListBlock(val ordered: Boolean, val start: Int, val items: List<ListItem>, val depth: Int) : MdBlock
    data class Code(val language: String, val text: String) : MdBlock
    data class Math(val tex: String) : MdBlock
    data class Table(val aligns: List<CellAlign>, val header: List<RichText>, val rows: List<List<RichText>>) : MdBlock
    data object Rule : MdBlock
}

data class ListItem(val blocks: List<MdBlock>, val checked: Boolean?)

const val MATH_PLACEHOLDER = '\uFFFC'

// Private-use markers survive CommonMark untouched, so math is never parsed as emphasis.
private const val MATH_OPEN = '\uE000'
private const val MATH_CLOSE = '\uE001'

object MarkdownDocument {
    private val parser: Parser = Parser.builder()
        .extensions(listOf(TablesExtension.create(), StrikethroughExtension.create(), TaskListItemsExtension.create(), AutolinkExtension.create()))
        .build()


    /** [streaming] closes dangling inline markers in the tail so they never flash as literals. */
    fun parse(markdown: String, streaming: Boolean = false): List<MdBlock> {
        var source = normalizeLatexDelimiters(markdown.replace("\r\n", "\n"))
        if (streaming) source = repairTail(source)
        val maths = mutableListOf<String>()
        source = protectMath(source, maths)
        return Converter(maths).blocks(parser.parse(source), depth = 0)
    }

    /** Port of normalizeLatexMathDelimiters in src/components/prompt-kit/markdown.tsx. */
    fun normalizeLatexDelimiters(markdown: String): String {
        val out = StringBuilder()
        var cursor = 0
        while (cursor < markdown.length) {
            if (markdown[cursor] == '`') {
                val run = backtickRun(markdown, cursor)
                val close = closingBackticks(markdown, cursor + run, run)
                if (close == -1) { out.append(markdown, cursor, markdown.length); break }
                out.append(markdown, cursor, close + run)
                cursor = close + run
                continue
            }
            val opening = markdown.substring(cursor, minOf(cursor + 2, markdown.length))
            if ((opening == "\\(" || opening == "\\[") && (cursor == 0 || markdown[cursor - 1] != '\\')) {
                val closing = if (opening == "\\(") "\\)" else "\\]"
                val close = latexClose(markdown, closing, cursor + 2)
                if (close != -1) {
                    val dollars = if (opening == "\\(") "$" else "$$"
                    out.append(dollars).append(markdown, cursor + 2, close).append(dollars)
                    cursor = close + 2
                    continue
                }
            }
            out.append(markdown[cursor++])
        }
        return out.toString()
    }

    private fun backtickRun(text: String, start: Int): Int {
        var end = start
        while (end < text.length && text[end] == '`') end++
        return end - start
    }

    private fun closingBackticks(text: String, start: Int, run: Int): Int {
        var cursor = start
        while (cursor < text.length) {
            val next = text.indexOf('`', cursor)
            if (next == -1) return -1
            val length = backtickRun(text, next)
            if (length == run) return next
            cursor = next + length
        }
        return -1
    }

    private fun latexClose(text: String, delimiter: String, start: Int): Int {
        var cursor = start
        while (cursor < text.length) {
            val next = text.indexOf(delimiter, cursor)
            if (next == -1) return -1
            if (next == 0 || text[next - 1] != '\\') return next
            cursor = next + delimiter.length
        }
        return -1
    }

    private val fence = Regex("^ {0,3}(`{3,}|~{3,})")

    /**
     * Turns `$$` display blocks into ```math fences and inline `$…$` / `$$…$$` into placeholders.
     * Skips fenced code and inline code spans, like remark-math.
     */
    fun protectMath(markdown: String, maths: MutableList<String>): String {
        val lines = markdown.split('\n')
        val out = StringBuilder()
        var fenceMarker: String? = null
        var index = 0
        fun emit(line: String) { if (out.isNotEmpty()) out.append('\n'); out.append(line) }
        while (index < lines.size) {
            val line = lines[index]
            val marker = fence.find(line)?.groupValues?.get(1)
            if (fenceMarker != null) {
                emit(line)
                if (marker != null && marker[0] == fenceMarker[0] && marker.length >= fenceMarker.length && line.trim().all { it == marker[0] }) fenceMarker = null
                index++
                continue
            }
            if (marker != null) { fenceMarker = marker; emit(line); index++; continue }
            val trimmed = line.trim()
            if (trimmed.startsWith("$$")) {
                val rest = trimmed.removePrefix("$$")
                val sameLineClose = rest.indexOf("$$")
                if (sameLineClose >= 0 && rest.substring(sameLineClose + 2).isBlank()) {
                    emit("```math"); emit(rest.substring(0, sameLineClose).trim()); emit("```")
                    index++
                    continue
                }
                if (sameLineClose < 0) {
                    // Display block; an unclosed one (still streaming) stays an open fence.
                    val body = mutableListOf<String>()
                    if (rest.isNotBlank()) body.add(rest)
                    index++
                    var closed = false
                    while (index < lines.size) {
                        val candidate = lines[index++]
                        val end = candidate.indexOf("$$")
                        if (end >= 0) { if (candidate.substring(0, end).isNotBlank()) body.add(candidate.substring(0, end)); closed = true; break }
                        body.add(candidate)
                    }
                    emit("```math"); body.forEach(::emit); if (closed) emit("```")
                    continue
                }
            }
            emit(protectInlineMath(line, maths))
            index++
        }
        return out.toString()
    }

    private fun protectInlineMath(line: String, maths: MutableList<String>): String {
        val out = StringBuilder()
        var cursor = 0
        while (cursor < line.length) {
            val char = line[cursor]
            if (char == '\\' && cursor + 1 < line.length) { out.append(line, cursor, cursor + 2); cursor += 2; continue }
            if (char == '`') {
                val run = backtickRun(line, cursor)
                val close = closingBackticks(line, cursor + run, run)
                if (close == -1) { out.append(line, cursor, line.length); break }
                out.append(line, cursor, close + run)
                cursor = close + run
                continue
            }
            if (char == '$') {
                val display = line.startsWith("$$", cursor)
                val delimiter = if (display) "$$" else "$"
                val close = inlineMathClose(line, cursor + delimiter.length, delimiter)
                if (close > 0) {
                    maths.add(line.substring(cursor + delimiter.length, close).trim())
                    out.append(MATH_OPEN).append(maths.lastIndex).append(MATH_CLOSE)
                    cursor = close + delimiter.length
                    continue
                }
                // Skip the whole run so `$$` is not retried as two single dollars.
                out.append(delimiter)
                cursor += delimiter.length
                continue
            }
            out.append(char)
            cursor++
        }
        return out.toString()
    }

    /** Pandoc's rule keeps prices literal: no space inside the delimiters, no digit after the close. */
    private fun inlineMathClose(line: String, start: Int, delimiter: String): Int {
        if (start >= line.length || line[start].isWhitespace()) return -1
        var cursor = start
        while (cursor < line.length) {
            val next = line.indexOf(delimiter, cursor)
            if (next == -1) return -1
            val escaped = line[next - 1] == '\\'
            val spaced = line[next - 1].isWhitespace()
            val digitAfter = delimiter == "$" && next + 1 < line.length && line[next + 1].isDigit()
            val longer = delimiter == "$" && next + 1 < line.length && line[next + 1] == '$'
            if (next > start && !escaped && !spaced && !digitAfter && !longer) return next
            cursor = next + 1
        }
        return -1
    }

    /**
     * Streamdown-style repair of the streaming tail: closes an unterminated code span, `**`, `*`,
     * `~~`, inline `$` and a link whose URL is still arriving. Only the last paragraph is touched.
     */
    fun repairTail(markdown: String): String {
        if (insideOpenFence(markdown)) return markdown
        val start = markdown.lastIndexOf("\n\n").let { if (it < 0) 0 else it + 2 }
        val tail = markdown.substring(start)
        if (tail.isBlank()) return markdown
        val suffix = StringBuilder()
        var codeOpen = false
        var bold = 0
        var italic = 0
        var strike = 0
        var dollars = 0
        var cursor = 0
        var lineStart = true
        while (cursor < tail.length) {
            val char = tail[cursor]
            when {
                char == '\\' -> { cursor += 2; lineStart = false; continue }
                char == '\n' -> { lineStart = true; cursor++; continue }
                char == '`' -> {
                    val run = backtickRun(tail, cursor)
                    val close = closingBackticks(tail, cursor + run, run)
                    if (close == -1) { codeOpen = true; suffix.append("`".repeat(run)); break }
                    cursor = close + run
                }
                tail.startsWith("**", cursor) -> { bold++; cursor += 2 }
                tail.startsWith("~~", cursor) -> { strike++; cursor += 2 }
                char == '*' -> {
                    // A list bullet is not emphasis.
                    val bullet = lineStart && cursor + 1 < tail.length && tail[cursor + 1] == ' '
                    if (!bullet) italic++
                    cursor++
                }
                char == '$' -> if (tail.startsWith("$$", cursor)) cursor += 2 else { dollars++; cursor++ }
                else -> cursor++
            }
            if (char != ' ' && char != '\t') lineStart = false
        }
        if (!codeOpen) {
            val link = Regex("\\[[^\\]\\n]*\\]\\([^)\\s]*$").find(tail)
            if (link != null) suffix.append(')')
            if (dollars % 2 == 1) suffix.append('$')
            if (strike % 2 == 1) suffix.append("~~")
            if (italic % 2 == 1) suffix.append('*')
            if (bold % 2 == 1) suffix.append("**")
        }
        // Emphasis cannot close after trailing whitespace; close it on the last character instead.
        val trimmed = markdown.trimEnd()
        return if (suffix.isEmpty()) markdown else trimmed + suffix
    }

    private fun insideOpenFence(markdown: String): Boolean {
        var marker: String? = null
        for (line in markdown.split('\n')) {
            val found = fence.find(line)?.groupValues?.get(1) ?: continue
            marker = when {
                marker == null -> found
                found[0] == marker[0] && found.length >= marker.length && line.trim().all { it == found[0] } -> null
                else -> marker
            }
        }
        return marker != null
    }

    private class Converter(private val maths: List<String>) {
        fun blocks(parent: Node, depth: Int): List<MdBlock> {
            val result = mutableListOf<MdBlock>()
            var node = parent.firstChild
            while (node != null) {
                block(node, depth)?.let(result::add)
                node = node.next
            }
            return result
        }

        private fun block(node: Node, depth: Int): MdBlock? = when (node) {
            is Paragraph -> MdBlock.Paragraph(inline(node))
            is Heading -> MdBlock.Heading(node.level, inline(node))
            is BlockQuote -> MdBlock.Quote(blocks(node, depth))
            is BulletList -> MdBlock.ListBlock(false, 1, items(node, depth), depth)
            is OrderedList -> MdBlock.ListBlock(true, node.markerStartNumber ?: 1, items(node, depth), depth)
            is FencedCodeBlock -> {
                val info = node.info.orEmpty().trim().substringBefore(' ')
                val literal = node.literal.orEmpty().removeSuffix("\n")
                if (info == "math") MdBlock.Math(literal) else MdBlock.Code(info, literal)
            }
            is IndentedCodeBlock -> MdBlock.Code("", node.literal.orEmpty().removeSuffix("\n"))
            is ThematicBreak -> MdBlock.Rule
            is HtmlBlock -> MdBlock.Paragraph(RichText(node.literal.orEmpty().trim(), emptyList()))
            is TableBlock -> table(node)
            else -> null
        }

        private fun items(list: ListBlock, depth: Int): List<ListItem> {
            val result = mutableListOf<ListItem>()
            var item = list.firstChild
            while (item != null) {
                if (item is org.commonmark.node.ListItem) {
                    // The extension puts the marker before the item's first paragraph.
                    val marker = item.firstChild as? TaskListItemMarker ?: (item.firstChild as? Paragraph)?.firstChild as? TaskListItemMarker
                    marker?.unlink()
                    result.add(ListItem(blocks(item, depth + 1), marker?.isChecked))
                }
                item = item.next
            }
            return result
        }

        private fun table(node: TableBlock): MdBlock.Table {
            val header = mutableListOf<RichText>()
            val aligns = mutableListOf<CellAlign>()
            val rows = mutableListOf<List<RichText>>()
            var section = node.firstChild
            while (section != null) {
                var row = section.firstChild
                while (row != null) {
                    if (row is TableRow) {
                        val cells = mutableListOf<RichText>()
                        var cell = row.firstChild
                        while (cell != null) {
                            if (cell is TableCell) {
                                cells.add(inline(cell))
                                if (section is TableHead) aligns.add(when (cell.alignment) {
                                    TableCell.Alignment.CENTER -> CellAlign.Center
                                    TableCell.Alignment.RIGHT -> CellAlign.End
                                    else -> CellAlign.Start
                                })
                            }
                            cell = cell.next
                        }
                        if (section is TableHead) header.addAll(cells) else if (section is TableBody) rows.add(cells)
                    }
                    row = row.next
                }
                section = section.next
            }
            return MdBlock.Table(aligns, header, rows)
        }

        fun inline(parent: Node): RichText = InlineBuilder(maths).apply { walk(parent) }.build()
    }
}

/** Flattens CommonMark inline nodes into text plus spans, restoring protected math. */
private class InlineBuilder(private val maths: List<String>) {
    private val text = StringBuilder()
    private val spans = mutableListOf<Span>()

    fun build() = RichText(text.toString(), spans.toList())

    fun walk(parent: Node) {
        var child = parent.firstChild
        while (child != null) { visit(child); child = child.next }
    }

    private fun visit(node: Node) {
        when (node) {
            is Text -> appendText(node.literal)
            is Code -> { val start = text.length; text.append(node.literal); spans.add(Span(SpanKind.Code, start, text.length)) }
            is StrongEmphasis -> wrap(SpanKind.Bold, node)
            is Emphasis -> wrap(SpanKind.Italic, node)
            is Strikethrough -> wrap(SpanKind.Strike, node)
            is Link -> wrap(SpanKind.Link, node, node.destination)
            is Image -> {
                val start = text.length
                walk(node)
                if (text.length == start) text.append("image")
                spans.add(Span(SpanKind.Link, start, text.length, node.destination))
            }
            is SoftLineBreak -> text.append(' ')
            is HardLineBreak -> text.append('\n')
            is HtmlInline -> text.append(node.literal)
            else -> walk(node)
        }
    }

    private fun wrap(kind: SpanKind, node: Node, data: String? = null) {
        val start = text.length
        walk(node)
        if (text.length > start) spans.add(Span(kind, start, text.length, data))
    }

    private fun appendText(literal: String) {
        var cursor = 0
        while (cursor < literal.length) {
            val open = literal.indexOf(MATH_OPEN, cursor)
            if (open < 0) { text.append(literal, cursor, literal.length); break }
            val close = literal.indexOf(MATH_CLOSE, open)
            val index = if (close > open) literal.substring(open + 1, close).toIntOrNull() else null
            if (index == null || index !in maths.indices) { text.append(literal, cursor, open + 1); cursor = open + 1; continue }
            text.append(literal, cursor, open)
            spans.add(Span(SpanKind.Math, text.length, text.length + 1, maths[index]))
            text.append(MATH_PLACEHOLDER)
            cursor = close + 1
        }
    }
}
