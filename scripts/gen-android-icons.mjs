// Generates Compose ImageVectors from the web app's Hugeicons set so both apps
// draw the same glyphs. Run after changing ICONS: `node scripts/gen-android-icons.mjs`.
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as hugeicons from '@hugeicons/core-free-icons'

const ICONS = [
  'AiMagicIcon',
  'ArrowDown01Icon',
  'ArrowRight01Icon',
  'ArrowUp02Icon',
  'ArrowUpRight01Icon',
  'BubbleChatIcon',
  'Cancel01Icon',
  'Copy01Icon',
  'CopyLinkIcon',
  'Delete01Icon',
  'Moon01Icon',
  'MoreHorizontalIcon',
  'MoreVerticalIcon',
  'PaintBoardIcon',
  'PencilEdit02Icon',
  'PlusSignIcon',
  'Search01Icon',
  'Settings01Icon',
  'SidebarLeft01Icon',
  'SmartPhone01Icon',
  'Sun01Icon',
  'Tick02Icon',
]

const output = fileURLToPath(
  new URL(
    '../android/app/src/main/java/org/kairos/android/ui/icons/KairosIcons.kt',
    import.meta.url,
  ),
)

function circlePath({ cx, cy, r }) {
  const [x, y, radius] = [cx, cy, r].map(Number)
  return `M${x - radius} ${y}a${radius} ${radius} 0 1 0 ${radius * 2} 0a${radius} ${radius} 0 1 0 ${-radius * 2} 0Z`
}

function elementPath(tag, attrs) {
  if (tag === 'path') return attrs.d
  if (tag === 'circle') return circlePath(attrs)
  throw new Error(
    `Unsupported Hugeicons element <${tag}>; extend gen-android-icons.mjs`,
  )
}

const CAPS = { round: 'StrokeCap.Round', square: 'StrokeCap.Square' }
const JOINS = { round: 'StrokeJoin.Round', bevel: 'StrokeJoin.Bevel' }

function renderElement([tag, attrs]) {
  const d = elementPath(tag, attrs)
  const args = [JSON.stringify(d)]
  if (attrs.stroke === 'currentColor') args.push('stroke = true')
  if (attrs.fill === 'currentColor') args.push('fill = true')
  if (attrs.fillRule === 'evenodd') args.push('evenOdd = true')
  if (attrs.strokeLinecap && CAPS[attrs.strokeLinecap]) {
    args.push(`cap = ${CAPS[attrs.strokeLinecap]}`)
  }
  if (attrs.strokeLinejoin && JOINS[attrs.strokeLinejoin]) {
    args.push(`join = ${JOINS[attrs.strokeLinejoin]}`)
  }
  if (attrs.opacity) args.push(`alpha = ${Number(attrs.opacity)}f`)
  return `        path(${args.join(', ')})`
}

const icons = ICONS.map(function renderIcon(name) {
  const elements = hugeicons[name]
  if (!elements) throw new Error(`Unknown Hugeicons icon ${name}`)
  const property = name.replace(/Icon$/, '')
  return [
    `    val ${property}: ImageVector by lazy {`,
    `        icon("${property}") {`,
    ...elements.map((element) => `    ${renderElement(element)}`),
    '        }',
    '    }',
  ].join('\n')
})

const source = `// Generated from @hugeicons/core-free-icons by scripts/gen-android-icons.mjs. Do not edit.
package org.kairos.android.ui.icons

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.PathFillType
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.addPathNodes
import androidx.compose.ui.unit.dp

// The web renders every icon with strokeWidth={1.5}, which overrides each element's own width.
private const val STROKE_WIDTH = 1.5f

private fun icon(name: String, block: ImageVector.Builder.() -> Unit): ImageVector =
    ImageVector.Builder(name, 24.dp, 24.dp, 24f, 24f).apply(block).build()

private fun ImageVector.Builder.path(
    d: String,
    stroke: Boolean = false,
    fill: Boolean = false,
    evenOdd: Boolean = false,
    cap: StrokeCap = StrokeCap.Butt,
    join: StrokeJoin = StrokeJoin.Miter,
    alpha: Float = 1f,
) {
    // Black is replaced by the tint at draw time.
    addPath(
        pathData = addPathNodes(d),
        pathFillType = if (evenOdd) PathFillType.EvenOdd else PathFillType.NonZero,
        fill = if (fill) SolidColor(Color.Black) else null,
        fillAlpha = alpha,
        stroke = if (stroke) SolidColor(Color.Black) else null,
        strokeAlpha = alpha,
        strokeLineWidth = STROKE_WIDTH,
        strokeLineCap = cap,
        strokeLineJoin = join,
    )
}

object KairosIcons {
${icons.join('\n\n')}
}
`

mkdirSync(dirname(output), { recursive: true })
writeFileSync(output, source)
console.log(`Wrote ${ICONS.length} icons to ${output}`)
