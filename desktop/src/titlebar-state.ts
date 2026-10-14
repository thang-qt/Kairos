export const themeKeys = [
  '--color-surface',
  '--color-ink',
  '--color-primary-100',
  '--color-primary-200',
  '--color-primary-500',
  '--color-primary-700',
  '--color-primary-950',
] as const

export type Theme = Partial<Record<(typeof themeKeys)[number], string>>
export type TitlebarState = {
  title: string
  maximized: boolean
  focused: boolean
  top: 'frame' | 'surface'
  theme: Theme
}

export function validateTheme(value: unknown): Theme | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return undefined
  const theme: Theme = {}
  const entries = Object.entries(value)
  if (!entries.length || entries.length > themeKeys.length) return undefined
  for (const [key, color] of entries) {
    if (
      !themeKeys.includes(key as (typeof themeKeys)[number]) ||
      typeof color !== 'string' ||
      !color.length ||
      color.length >= 100 ||
      /[;{}]|url\s*\(/i.test(color) ||
      !/^(?:#[\da-f]{3}(?:[\da-f]{1}|[\da-f]{3}|[\da-f]{5})?|(?:oklch|rgb|rgba|color-mix|var)\([\w\s.,%+#()/-]*\))$/i.test(
        color,
      )
    )
      return undefined
    theme[key as (typeof themeKeys)[number]] = color
  }
  return theme
}

export function fallbackTheme(dark: boolean): Theme {
  return {
    '--color-surface': dark ? '#000000' : '#ffffff',
    '--color-ink': dark ? '#ffffff' : '#000000',
    '--color-primary-100': dark ? '#0d0d0d' : '#f9f9f9',
    '--color-primary-200': dark
      ? 'oklch(0.2078 0 89.88)'
      : 'oklch(0.9461 0 89.88)',
    '--color-primary-500': dark
      ? 'oklch(0.52 0.006 80)'
      : 'oklch(0.785 0.006 80)',
    '--color-primary-700': dark
      ? 'oklch(0.73 0.006 80)'
      : 'oklch(0.56 0.006 80)',
    '--color-primary-950': dark
      ? 'oklch(0.945 0.003 80)'
      : 'oklch(0.25 0.003 80)',
  }
}
