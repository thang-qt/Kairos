package org.kairos.android.markdown

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.InlineTextContent
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.drawIntoCanvas
import androidx.compose.ui.graphics.nativeCanvas
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.LinkAnnotation
import androidx.compose.ui.text.Placeholder
import androidx.compose.ui.text.PlaceholderVerticalAlign
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextLinkStyles
import androidx.compose.ui.text.TextStyle
import androidx.compose.foundation.text.appendInlineContent
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.kairos.android.ui.KIcon
import org.kairos.android.ui.icons.KairosIcons
import org.kairos.android.ui.pressable
import org.kairos.android.ui.theme.KairosColors
import org.kairos.android.ui.theme.LocalKairosColors

/*
 * Native renderer for the assistant overlay, at feature parity with the web's Streamdown setup
 * (GFM, math, highlighted code) but drawn with Compose. Styles follow prompt-kit/markdown.tsx.
 */

private val Body = TextStyle(fontSize = 15.sp, lineHeight = 24.sp, letterSpacing = (-0.15).sp)

private class MdEnv(val colors: KairosColors, val dark: Boolean, val density: Density, val onLink: (String) -> Unit)

private val LocalMdEnv = staticCompositionLocalOf<MdEnv> { error("OverlayMarkdown only") }

@Composable
fun OverlayMarkdown(text: String, streaming: Boolean, dark: Boolean, onLink: (String) -> Unit) {
    val blocks = remember(text, streaming) { MarkdownDocument.parse(text, streaming) }
    val colors = LocalKairosColors.current
    val density = LocalDensity.current
    val env = remember(colors, dark, density, onLink) { MdEnv(colors, dark, density, onLink) }
    CompositionLocalProvider(LocalMdEnv provides env) {
        Blocks(blocks, Body.copy(color = colors.p(950)))
    }
}

@Composable
private fun Blocks(blocks: List<MdBlock>, style: TextStyle, spacing: Int = 8) {
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(spacing.dp)) {
        blocks.forEachIndexed { index, block -> key(index) { Block(block, style) } }
    }
}

@Composable
private fun Block(block: MdBlock, style: TextStyle) {
    val colors = LocalMdEnv.current.colors
    when (block) {
        is MdBlock.Paragraph -> RichTextView(block.content, style)
        is MdBlock.Heading -> RichTextView(block.content, when (block.level) {
            1 -> style.copy(fontSize = 20.sp, lineHeight = 28.sp, fontWeight = FontWeight.Medium, color = colors.p(950))
            2 -> style.copy(fontSize = 18.sp, lineHeight = 26.sp, fontWeight = FontWeight.Medium, color = colors.p(900))
            3 -> style.copy(fontSize = 16.sp, lineHeight = 24.sp, fontWeight = FontWeight.Medium, color = colors.p(900))
            else -> style.copy(fontWeight = FontWeight.Medium, color = colors.p(900))
        })
        is MdBlock.Quote -> Box(
            Modifier.fillMaxWidth()
                .drawBehind { drawLine(colors.p(300), Offset(1.dp.toPx(), 0f), Offset(1.dp.toPx(), size.height), 2.dp.toPx()) }
                .padding(start = 16.dp),
        ) { Blocks(block.blocks, style.copy(color = colors.p(900), fontStyle = FontStyle.Italic)) }
        is MdBlock.ListBlock -> ListView(block, style)
        is MdBlock.Code -> CodeBlock(block)
        is MdBlock.Math -> MathBlock(block.tex)
        is MdBlock.Table -> TableView(block)
        MdBlock.Rule -> Box(Modifier.padding(vertical = 4.dp).fillMaxWidth().height(1.dp).background(colors.p(200)))
    }
}

@Composable
private fun ListView(list: MdBlock.ListBlock, style: TextStyle) {
    val colors = LocalMdEnv.current.colors
    val bullet = listOf("•", "◦", "▪")[list.depth.coerceAtMost(2)]
    val markerWidth = if (list.ordered) (12 + 8 * (list.start + list.items.size - 1).toString().length).dp else 16.dp
    Column(Modifier.fillMaxWidth().padding(start = 4.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
        list.items.forEachIndexed { index, item ->
            key(index) {
                Row(Modifier.fillMaxWidth()) {
                    Box(Modifier.width(markerWidth).height(with(LocalDensity.current) { style.lineHeight.toDp() }), contentAlignment = Alignment.CenterStart) {
                        when {
                            item.checked != null -> TaskBox(item.checked)
                            list.ordered -> Text("${list.start + index}.", style = style.copy(color = colors.p(500), fontFeatureSettings = "tnum"))
                            else -> Text(bullet, style = style.copy(color = colors.p(400)))
                        }
                    }
                    Box(Modifier.weight(1f)) { Blocks(item.blocks, style, spacing = 4) }
                }
            }
        }
    }
}

@Composable
private fun TaskBox(checked: Boolean) {
    val colors = LocalMdEnv.current.colors
    val shape = RoundedCornerShape(3.dp)
    Box(
        Modifier.size(14.dp).background(if (checked) colors.p(950) else Color.Transparent, shape)
            .border(1.dp, if (checked) colors.p(950) else colors.p(400), shape),
        contentAlignment = Alignment.Center,
    ) { if (checked) KIcon(KairosIcons.Tick02, colors.p(50), size = 12.dp) }
}

/** AnnotatedString plus inline math placeholders; the placeholder list also feeds table measuring. */
private class RenderedText(val text: AnnotatedString, val inline: Map<String, InlineTextContent>, val placeholders: List<AnnotatedString.Range<Placeholder>>)

private fun render(content: RichText, style: TextStyle, env: MdEnv): RenderedText {
    val colors = env.colors
    val inline = mutableMapOf<String, InlineTextContent>()
    val placeholders = mutableListOf<AnnotatedString.Range<Placeholder>>()
    val fontSize = if (style.fontSize.isSp) style.fontSize else Body.fontSize
    val textSizePx = with(env.density) { fontSize.toPx() }
    val color = (style.color.takeIf { it != Color.Unspecified } ?: colors.p(950)).toArgb()
    val text = buildAnnotatedString {
        append(content.text)
        for (span in content.spans) {
            when (span.kind) {
                SpanKind.Bold -> addStyle(SpanStyle(fontWeight = FontWeight.Medium, color = colors.p(950)), span.start, span.end)
                SpanKind.Italic -> addStyle(SpanStyle(fontStyle = FontStyle.Italic), span.start, span.end)
                SpanKind.Strike -> addStyle(SpanStyle(textDecoration = TextDecoration.LineThrough), span.start, span.end)
                SpanKind.Code -> addStyle(SpanStyle(fontFamily = FontFamily.Monospace, fontSize = 0.9.em, color = colors.p(900), background = colors.p(100)), span.start, span.end)
                SpanKind.Link -> {
                    val href = span.data.orEmpty()
                    addLink(LinkAnnotation.Url(href, TextLinkStyles(SpanStyle(color = colors.p(950), textDecoration = TextDecoration.Underline))) { env.onLink(href) }, span.start, span.end)
                }
                SpanKind.Math -> Unit
            }
        }
    }
    val maths = content.spans.filter { it.kind == SpanKind.Math }
    if (maths.isEmpty()) return RenderedText(text, inline, placeholders)
    // Rebuild with inline content at each placeholder char, keeping the other styles in place.
    val withMath = buildAnnotatedString {
        var cursor = 0
        maths.forEachIndexed { index, span ->
            append(text.subSequence(cursor, span.start))
            val tex = span.data.orEmpty()
            val id = "math$index"
            val drawable = MathRenderer.drawable(tex, textSizePx, color)
            if (drawable == null) {
                withStyle(SpanStyle(fontFamily = FontFamily.Monospace, fontSize = 0.9.em, color = colors.p(700))) { append(tex) }
            } else {
                val scale = env.density.density * env.density.fontScale
                val placeholder = Placeholder((drawable.intrinsicWidth / scale).sp, (drawable.intrinsicHeight / scale).sp, PlaceholderVerticalAlign.TextCenter)
                val start = length
                appendInlineContent(id, tex)
                placeholders.add(AnnotatedString.Range(placeholder, start, length))
                inline[id] = InlineTextContent(placeholder) {
                    Canvas(Modifier.fillMaxSize()) {
                        drawIntoCanvas { canvas ->
                            drawable.setBounds(0, 0, drawable.intrinsicWidth, drawable.intrinsicHeight)
                            drawable.draw(canvas.nativeCanvas)
                        }
                    }
                }
            }
            cursor = span.end
        }
        append(text.subSequence(cursor, text.length))
    }
    return RenderedText(withMath, inline, placeholders)
}

private inline fun AnnotatedString.Builder.withStyle(style: SpanStyle, block: AnnotatedString.Builder.() -> Unit) {
    val index = pushStyle(style)
    try { block() } finally { pop(index) }
}

@Composable
private fun RichTextView(content: RichText, style: TextStyle, modifier: Modifier = Modifier) {
    val env = LocalMdEnv.current
    val rendered = remember(content, style, env) { render(content, style, env) }
    Text(rendered.text, modifier, style = style, inlineContent = rendered.inline)
}

@Composable
private fun MathBlock(tex: String) {
    val env = LocalMdEnv.current
    val colors = env.colors
    val sizePx = with(env.density) { 17.sp.toPx() }
    val drawable = remember(tex, sizePx, colors) { MathRenderer.drawable(tex, sizePx, colors.p(950).toArgb()) }
    if (drawable == null) {
        // Unparseable (usually still streaming): show the source like KaTeX's error fallback.
        Text(tex, fontFamily = FontFamily.Monospace, fontSize = 13.sp, lineHeight = 20.sp, color = colors.p(700))
        return
    }
    BoxWithConstraints(Modifier.fillMaxWidth()) {
        val available = maxWidth
        val width = with(env.density) { drawable.intrinsicWidth.toDp() }
        val height = with(env.density) { drawable.intrinsicHeight.toDp() }
        Box(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(vertical = 4.dp)) {
            Box(Modifier.widthIn(min = available), contentAlignment = Alignment.Center) {
                Canvas(Modifier.size(width, height)) {
                    drawIntoCanvas { canvas ->
                        drawable.setBounds(0, 0, drawable.intrinsicWidth, drawable.intrinsicHeight)
                        drawable.draw(canvas.nativeCanvas)
                    }
                }
            }
        }
    }
}

/** prompt-kit/code-block: bordered, language label and Copy in a header row, highlighted body. */
@Composable
private fun CodeBlock(block: MdBlock.Code) {
    val env = LocalMdEnv.current
    val colors = env.colors
    val context = LocalContext.current
    val shape = RoundedCornerShape(8.dp)
    var copied by remember(block.text) { mutableStateOf(false) }
    // Keep the last highlighted prefix while a streaming block re-highlights off the main thread.
    var highlighted by remember(block.language, env.dark) { mutableStateOf(AnnotatedString("")) }
    LaunchedEffect(block.text, block.language, env.dark) {
        highlighted = withContext(Dispatchers.Default) { CodeHighlighter.highlight(block.text, block.language, env.dark) }
    }
    val shown = when {
        highlighted.text == block.text -> highlighted
        block.text.startsWith(highlighted.text) -> buildAnnotatedString { append(highlighted); append(block.text.substring(highlighted.length)) }
        else -> AnnotatedString(block.text)
    }
    Column(Modifier.fillMaxWidth().clip(shape).background(colors.p(50)).border(1.dp, colors.p(200), shape)) {
        Row(Modifier.fillMaxWidth().padding(start = 12.dp, end = 8.dp, top = 4.dp, bottom = 4.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(CodeHighlighter.label(block.language), Modifier.weight(1f), color = colors.p(500), fontSize = 12.sp, fontWeight = FontWeight.Medium)
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
        Text(shown, fontFamily = FontFamily.Monospace, fontSize = 13.sp, lineHeight = 20.sp, color = colors.p(900), softWrap = false,
            modifier = Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(start = 12.dp, end = 12.dp, bottom = 12.dp, top = 4.dp))
    }
}

/** markdown.tsx table: text-sm, primary-50 header with a primary-200 rule, primary-100 row dividers. */
@Composable
private fun TableView(table: MdBlock.Table) {
    val env = LocalMdEnv.current
    val colors = env.colors
    val measurer = rememberTextMeasurer()
    val cellStyle = Body.copy(fontSize = 14.sp, lineHeight = 20.sp, color = colors.p(950))
    val headStyle = cellStyle.copy(fontWeight = FontWeight.Medium)
    val columns = maxOf(table.header.size, table.rows.maxOfOrNull { it.size } ?: 0)
    if (columns == 0) return
    val headers = remember(table, env) { table.header.map { render(it, headStyle, env) } }
    val rows = remember(table, env) { table.rows.map { row -> row.map { render(it, cellStyle, env) } } }
    BoxWithConstraints(Modifier.fillMaxWidth()) {
        val padX = 12.dp
        val maxCell = 280.dp
        val natural = remember(headers, rows, env) {
            (0 until columns).map { column ->
                val cells = listOfNotNull(headers.getOrNull(column)) + rows.mapNotNull { it.getOrNull(column) }
                val widest = cells.maxOfOrNull { cell ->
                    measurer.measure(cell.text, if (cell in headers) headStyle else cellStyle, placeholders = cell.placeholders).size.width
                } ?: 0
                with(env.density) { (widest.toDp() + padX * 2).coerceIn(48.dp, maxCell) }
            }
        }
        // w-full: stretch to the card when the table is narrower, otherwise scroll sideways.
        val total = natural.fold(0.dp) { sum, width -> sum + width }
        val widths = if (total < maxWidth) natural.map { it * (maxWidth / total) } else natural
        Column(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState())) {
            TableRowView(headers, widths, table.aligns, Modifier.background(colors.p(50)), headStyle)
            Box(Modifier.width(widths.fold(0.dp) { s, w -> s + w }).height(1.dp).background(colors.p(200)))
            rows.forEachIndexed { index, row ->
                key(index) {
                    if (index > 0) Box(Modifier.width(widths.fold(0.dp) { s, w -> s + w }).height(1.dp).background(colors.p(100)))
                    TableRowView(row, widths, table.aligns, Modifier, cellStyle)
                }
            }
        }
    }
}

@Composable
private fun TableRowView(cells: List<RenderedText>, widths: List<androidx.compose.ui.unit.Dp>, aligns: List<CellAlign>, modifier: Modifier, style: TextStyle) {
    Row(modifier.height(IntrinsicSize.Min)) {
        widths.forEachIndexed { column, width ->
            val cell = cells.getOrNull(column)
            val align = when (aligns.getOrNull(column)) { CellAlign.Center -> TextAlign.Center; CellAlign.End -> TextAlign.End; else -> TextAlign.Start }
            Box(Modifier.width(width).fillMaxHeight().padding(horizontal = 12.dp, vertical = 8.dp)) {
                if (cell != null) Text(cell.text, Modifier.fillMaxWidth(), style = style.copy(textAlign = align), inlineContent = cell.inline)
            }
        }
    }
}
