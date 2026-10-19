import { readFile, mkdir, writeFile } from 'node:fs/promises'

const css = await readFile(
  new URL('../src/styles.css', import.meta.url),
  'utf8',
)
const steps = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950]
function hex(value) {
  if (value.startsWith('#')) return value.slice(1).toUpperCase()
  if (value === 'var(--color-white)') return 'FFFFFF'
  if (value === 'var(--color-black)') return '000000'
  const match = value.match(/^oklch\(([\d.]+) ([\d.]+) ([\d.]+)\)$/)
  if (!match) throw new Error(`Unsupported CSS color: ${value}`)
  const lightness = Number(match[1])
  const chroma = Number(match[2])
  const hue = (Number(match[3]) * Math.PI) / 180
  const a = chroma * Math.cos(hue)
  const b = chroma * Math.sin(hue)
  const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ]
    .map(function channel(linear) {
      const srgb =
        linear <= 0.0031308
          ? 12.92 * linear
          : 1.055 * Math.max(0, linear) ** (1 / 2.4) - 0.055
      return Math.round(Math.max(0, Math.min(1, srgb)) * 255)
        .toString(16)
        .padStart(2, '0')
        .toUpperCase()
    })
    .join('')
}
const palettes = []
for (const match of css.matchAll(
  /\.theme-(default|harvest|mist|canopy|ember|tide)\s*\{([^}]+)\}/g,
)) {
  const [, name, block] = match
  const modes = []
  for (const mode of ['light', 'dark']) {
    const colors = []
    for (const token of [
      ...steps.map(function token(step) {
        return `primary-${step}`
      }),
      'surface',
      'ink',
    ]) {
      const value = block
        .match(new RegExp(`--theme-${mode}-${token}:\\s*([^;]+);`))?.[1]
        .trim()
      if (!value) throw new Error(`Missing ${name}/${mode}/${token}`)
      colors.push(`Color(0xFF${hex(value)})`)
    }
    modes.push(
      `        ${mode} = PaletteColors(listOf(${colors.slice(0, 11).join(', ')}), ${colors[11]}, ${colors[12]})`,
    )
  }
  palettes.push(`    ColorPalette("${name}",\n${modes.join(',\n')}\n    )`)
}
if (palettes.length !== 6) throw new Error('Expected six palettes')
const target = new URL(
  '../android/app/src/main/java/org/kairos/android/ui/theme/color-palettes.kt',
  import.meta.url,
)
await mkdir(new URL('.', target), { recursive: true })
await writeFile(
  target,
  `// Generated from src/styles.css by scripts/gen-android-theme.mjs. Do not edit.\npackage org.kairos.android.ui.theme\n\nimport androidx.compose.ui.graphics.Color\n\ndata class PaletteColors(val primary: List<Color>, val surface: Color, val ink: Color) {\n    fun p(step: Int): Color = primary[listOf(${steps.join(', ')}).indexOf(step)]\n}\ndata class ColorPalette(val name: String, val light: PaletteColors, val dark: PaletteColors)\n\nval ColorPalettes = listOf(\n${palettes.join(',\n')}\n)\n`,
)
console.log('Generated all six Android palettes (light and dark).')
