import { useSyncExternalStore } from 'react'

export type SiteThemeMode = 'light' | 'dark'

export const SITE_PALETTES = [
  'default',
  'harvest',
  'mist',
  'canopy',
  'ember',
  'tide',
] as const

export type SitePalette = (typeof SITE_PALETTES)[number]

type SiteTheme = {
  mode: SiteThemeMode
  palette: SitePalette
}

const PALETTE_STORAGE_KEY = 'kairos-site-palette'

let theme: SiteTheme = {
  mode: readInitialMode(),
  palette: readInitialPalette(),
}
const listeners = new Set<() => void>()

function readInitialMode(): SiteThemeMode {
  if (typeof window === 'undefined') return 'light'
  return window.matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light'
}

function readInitialPalette(): SitePalette {
  try {
    const stored = localStorage.getItem(PALETTE_STORAGE_KEY)
    const match = SITE_PALETTES.find(function isStored(palette) {
      return palette === stored
    })
    return match ?? 'canopy'
  } catch {
    return 'canopy'
  }
}

export function applySiteTheme() {
  const root = document.documentElement
  for (const palette of SITE_PALETTES) {
    root.classList.toggle(`theme-${palette}`, palette === theme.palette)
  }
  root.classList.toggle('dark', theme.mode === 'dark')
  root.classList.toggle('light', theme.mode === 'light')
}

function update(next: Partial<SiteTheme>) {
  theme = { ...theme, ...next }
  applySiteTheme()
  for (const listener of listeners) listener()
}

export function setSiteMode(mode: SiteThemeMode) {
  update({ mode })
}

export function setSitePalette(palette: SitePalette) {
  try {
    localStorage.setItem(PALETTE_STORAGE_KEY, palette)
  } catch {
    // Remembering the palette is a convenience; the page works without it.
  }
  update({ palette })
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return function unsubscribe() {
    listeners.delete(listener)
  }
}

function getTheme() {
  return theme
}

export function useSiteTheme() {
  return useSyncExternalStore(subscribe, getTheme)
}

function getMode() {
  return theme.mode
}

// The shared code renderer picks its Shiki theme from this hook.
export function useResolvedTheme() {
  return useSyncExternalStore(subscribe, getMode)
}

// MessageItem needs only these render preferences. The landing page does not
// create the web app's persisted store, router, or query providers.
const renderPreferences = {
  settings: {
    showReasoningBlocks: true,
    showToolMessages: true,
    showLiveActivity: true,
    reasoningCollapseMode: 'expanded-while-thinking' as const,
  },
}

export function useChatSettingsStore<T>(
  selector: (state: typeof renderPreferences) => T,
): T {
  return selector(renderPreferences)
}
