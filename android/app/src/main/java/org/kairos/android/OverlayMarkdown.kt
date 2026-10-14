package org.kairos.android

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.LinkAnnotation
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextLinkStyles
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import org.kairos.android.ui.KIcon
import org.kairos.android.ui.icons.KairosIcons
import org.kairos.android.ui.pressable
import org.kairos.android.ui.theme.KairosColors
import org.kairos.android.ui.theme.LocalKairosColors

// Pure, Android-independent parser output; tests run on the JVM without a device.
enum class InlineKind { Bold, Italic, Code, Link }
data class InlineSpan(val kind: InlineKind, val start: Int, val end: Int, val href: String? = null)
data class InlineContent(val text: String, val spans: List<InlineSpan>)
sealed class MarkdownBlock {
    data class Paragraph(val content: InlineContent) : MarkdownBlock()
    data class Heading(val level: Int, val content: InlineContent) : MarkdownBlock()
    data class ListItem(val marker: String, val nesting: Int, val content: InlineContent) : MarkdownBlock()
    data class Code(val text: String, val language: String, val closed: Boolean) : MarkdownBlock()
    data class Plain(val text: String) : MarkdownBlock()
}
data class ParsedMarkdown(val blocks: List<MarkdownBlock>, val needsFullView: Boolean)

object OverlayMarkdownParser {
    private val heading = Regex("^(#{1,3})\\s+(.*)$")
    private val list = Regex("^( {0,4})([-+*]|\\d+[.)])\\s+(.*)$")
    private val fence = Regex("^\\s*(`{3,}|~{3,})(.*)$")
    private val html = Regex("<[/!a-zA-Z][^>]*>?")

    private fun unsupported(line: String): Boolean =
        '$' in line || html.containsMatchIn(line) || line.count { it == '|' } >= 2 ||
            line.startsWith('>') || line.startsWith("####")

    fun parse(markdown: String): ParsedMarkdown {
        val lines = markdown.replace("\r\n", "\n").split('\n')
        val blocks = mutableListOf<MarkdownBlock>()
        var fullView = false
        var index = 0
        while (index < lines.size) {
            val line = lines[index]
            if (line.isBlank()) { index++; continue }
            val opening = fence.matchEntire(line)
            if (opening != null) {
                val delimiter = opening.groupValues[1]
                val code = mutableListOf<String>()
                index++
                var closed = false
                while (index < lines.size) {
                    val candidate = lines[index].trim()
                    if (candidate.length >= delimiter.length && candidate.all { it == delimiter[0] }) {
                        closed = true; index++; break
                    }
                    // A partially streamed closing fence should not flash literal backticks.
                    if (index == lines.lastIndex && candidate.isNotEmpty() && candidate.length < delimiter.length && candidate.all { it == delimiter[0] }) {
                        index++; break
                    }
                    code.add(lines[index++])
                }
                blocks.add(MarkdownBlock.Code(code.joinToString("\n").removeSuffix("\n"), opening.groupValues[2].trim(), closed))
                continue
            }
            if (unsupported(line)) {
                val raw = mutableListOf(line)
                index++
                while (index < lines.size && lines[index].isNotBlank() && fence.matchEntire(lines[index]) == null) raw.add(lines[index++])
                blocks.add(MarkdownBlock.Plain(raw.joinToString("\n")))
                fullView = true
                continue
            }
            val title = heading.matchEntire(line)
            val item = list.matchEntire(line)
            when {
                title != null -> { blocks.add(MarkdownBlock.Heading(title.groupValues[1].length, inline(title.groupValues[2]))); index++ }
                item != null -> {
                    val marker = item.groupValues[2].let { if (it in listOf("-", "+", "*")) "•" else it }
                    blocks.add(MarkdownBlock.ListItem(marker, if (item.groupValues[1].length >= 2) 1 else 0, inline(item.groupValues[3])))
                    index++
                }
                else -> {
                    val paragraph = mutableListOf(line)
                    index++
                    while (index < lines.size && lines[index].isNotBlank() &&
                        heading.matchEntire(lines[index]) == null && list.matchEntire(lines[index]) == null &&
                        fence.matchEntire(lines[index]) == null && !unsupported(lines[index])) paragraph.add(lines[index++])
                    blocks.add(MarkdownBlock.Paragraph(inline(paragraph.joinToString("\n"))))
                }
            }
        }
        return ParsedMarkdown(blocks, fullView)
    }

    /** Open emphasis/code extends to the current end, so a closing token doesn't swap out text. */
    fun inline(source: String): InlineContent {
        val text = StringBuilder()
        val spans = mutableListOf<InlineSpan>()
        fun segment(input: String, depth: Int) {
            if (depth > 12) { text.append(input); return }
            var index = 0
            while (index < input.length) {
                if (input[index] == '\\' && index + 1 < input.length) { text.append(input[index + 1]); index += 2; continue }
                if (input[index] == '[') {
                    val labelEnd = input.indexOf("](", index + 1)
                    val urlEnd = if (labelEnd >= 0) input.indexOf(')', labelEnd + 2) else -1
                    if (urlEnd >= 0 && labelEnd > index + 1) {
                        val start = text.length
                        segment(input.substring(index + 1, labelEnd), depth + 1)
                        spans.add(InlineSpan(InlineKind.Link, start, text.length, input.substring(labelEnd + 2, urlEnd)))
                        index = urlEnd + 1
                        continue
                    }
                }
                val marker = when {
                    input.startsWith("**", index) -> "**"
                    input[index] == '*' -> "*"
                    input[index] == '`' -> "`"
                    else -> null
                }
                if (marker != null) {
                    val close = input.indexOf(marker, index + marker.length)
                    val end = if (close >= 0) close else input.length
                    val start = text.length
                    val content = input.substring(index + marker.length, end)
                    if (marker == "`") text.append(content) else segment(content, depth + 1)
                    val kind = if (marker == "**") InlineKind.Bold else if (marker == "*") InlineKind.Italic else InlineKind.Code
                    if (text.length > start) spans.add(InlineSpan(kind, start, text.length))
                    index = if (close >= 0) close + marker.length else end
                } else { text.append(input[index++]) }
            }
        }
        segment(source, 0)
        return InlineContent(text.toString(), spans)
    }
}

fun InlineContent.annotated(colors: KairosColors, onLink: (String) -> Unit): AnnotatedString {
    val builder = AnnotatedString.Builder(text)
    spans.forEach { span ->
        when (span.kind) {
            InlineKind.Bold -> builder.addStyle(SpanStyle(fontWeight = FontWeight.Medium, color = colors.p(950)), span.start, span.end)
            InlineKind.Italic -> builder.addStyle(SpanStyle(fontStyle = FontStyle.Italic), span.start, span.end)
            InlineKind.Code -> builder.addStyle(SpanStyle(fontFamily = FontFamily.Monospace, fontSize = 0.9.em, color = colors.p(900), background = colors.p(100)), span.start, span.end)
            InlineKind.Link -> builder.addLink(
                LinkAnnotation.Url(span.href.orEmpty(), TextLinkStyles(SpanStyle(color = colors.p(950), textDecoration = TextDecoration.Underline))) { onLink(span.href.orEmpty()) },
                span.start, span.end,
            )
        }
    }
    return builder.toAnnotatedString()
}

private val bodySize = 15.sp
private val bodyLeading = 24.sp // leading-relaxed

/** Native subset of src/components/prompt-kit/markdown.tsx for the overlay. */
@Composable
fun OverlayMarkdown(text: String, onLink: (String) -> Unit) {
    val parsed = remember(text) { OverlayMarkdownParser.parse(text) }
    val colors = LocalKairosColors.current
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        parsed.blocks.forEachIndexed { index, block ->
            key(index) {
                when (block) {
                    is MarkdownBlock.Paragraph -> Text(block.content.annotated(colors, onLink), color = colors.p(950), fontSize = bodySize, lineHeight = bodyLeading)
                    is MarkdownBlock.Heading -> Text(
                        block.content.annotated(colors, onLink),
                        color = if (block.level == 1) colors.p(950) else colors.p(900),
                        fontSize = when (block.level) { 1 -> 20.sp; 2 -> 18.sp; else -> 16.sp },
                        lineHeight = when (block.level) { 1 -> 28.sp; 2 -> 26.sp; else -> 24.sp },
                        fontWeight = FontWeight.Medium,
                    )
                    is MarkdownBlock.ListItem -> Row(Modifier.padding(start = (4 + block.nesting * 16).dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text(block.marker, color = if (block.marker == "•") colors.p(400) else colors.p(500), fontSize = bodySize, lineHeight = bodyLeading,
                            style = TextStyle(fontFeatureSettings = "tnum"))
                        Text(block.content.annotated(colors, onLink), color = colors.p(950), fontSize = bodySize, lineHeight = bodyLeading)
                    }
                    is MarkdownBlock.Code -> CodeBlock(block)
                    is MarkdownBlock.Plain -> Text(block.text, color = colors.p(950), fontSize = bodySize, lineHeight = bodyLeading)
                }
            }
        }
        if (parsed.needsFullView) Text("Open in Kairos for the full view", color = colors.p(600), fontSize = 12.sp)
    }
}

/** prompt-kit/code-block: bordered, language label and Copy in a header row. */
@Composable
private fun CodeBlock(block: MarkdownBlock.Code) {
    val colors = LocalKairosColors.current
    val context = LocalContext.current
    val shape = RoundedCornerShape(8.dp)
    var copied by remember(block.text) { mutableStateOf(false) }
    Column(Modifier.fillMaxWidth().clip(shape).background(colors.p(50)).border(1.dp, colors.p(200), shape)) {
        Row(Modifier.fillMaxWidth().padding(start = 12.dp, end = 8.dp, top = 4.dp, bottom = 4.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(block.language.ifBlank { "text" }.replaceFirstChar { it.uppercase() }, Modifier.weight(1f), color = colors.p(500), fontSize = 12.sp, fontWeight = FontWeight.Medium)
            Row(
                Modifier.pressable(RoundedCornerShape(6.dp), pressedColor = colors.p(100)) {
                    (context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager).setPrimaryClip(ClipData.newPlainText("Code", block.text))
                    copied = true
                }.padding(horizontal = 4.dp, vertical = 2.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(4.dp),
            ) {
                KIcon(if (copied) KairosIcons.Tick02 else KairosIcons.Copy01, colors.p(500), size = 16.dp)
                Text(if (copied) "Copied" else "Copy", color = colors.p(500), fontSize = 12.sp, fontWeight = FontWeight.Medium)
            }
        }
        Text(block.text, fontFamily = FontFamily.Monospace, fontSize = 13.sp, lineHeight = 20.sp, color = colors.p(900), softWrap = false,
            modifier = Modifier.horizontalScroll(rememberScrollState()).padding(start = 12.dp, end = 12.dp, bottom = 12.dp, top = 4.dp))
    }
}
