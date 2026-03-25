import { useEffect, useMemo, useState } from 'react'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type ThemeMode = 'system' | 'light' | 'dark'
export type ThemePalette =
  | 'default'
  | 'harvest'
  | 'mist'
  | 'canopy'
  | 'ember'
  | 'tide'
export type ThinkingLevel = 'low' | 'medium' | 'high'
export type ChatModelInfo = {
  id: string
  object: 'model'
  created: number
  owned_by: string
  name?: string
  description?: string
  contextWindow?: number
}

export const MOCK_CHAT_MODELS = [
  {
    id: 'kairos-fast',
    object: 'model' as const,
    created: 1_742_780_800,
    owned_by: 'kairos',
    name: 'Kairos Fast',
    description: 'Quick responses for lightweight turns',
    contextWindow: 128_000,
  },
  {
    id: 'kairos-balanced',
    object: 'model' as const,
    created: 1_742_780_800,
    owned_by: 'kairos',
    name: 'Kairos Balanced',
    description: 'General-purpose model for most chats',
    contextWindow: 128_000,
  },
  {
    id: 'kairos-deep',
    object: 'model' as const,
    created: 1_742_780_800,
    owned_by: 'kairos',
    name: 'Kairos Deep',
    description: 'Slower, more deliberate responses',
    contextWindow: 200_000,
  },
  {
    id: 'kairos-vision',
    object: 'model' as const,
    created: 1_742_780_800,
    owned_by: 'kairos',
    name: 'Kairos Vision',
    description: 'Best fit when attachments matter',
    contextWindow: 128_000,
  },
  {
    id: 'kairos-code',
    object: 'model' as const,
    created: 1_742_780_800,
    owned_by: 'kairos',
    name: 'Kairos Code',
    description: 'Optimized for implementation and technical debugging',
    contextWindow: 128_000,
  },
  {
    id: 'kairos-reasoning',
    object: 'model' as const,
    created: 1_742_780_800,
    owned_by: 'kairos',
    name: 'Kairos Reasoning',
    description: 'Higher-latency model for multi-step thinking',
    contextWindow: 200_000,
  },
  {
    id: 'kairos-compact',
    object: 'model' as const,
    created: 1_742_780_800,
    owned_by: 'kairos',
    name: 'Kairos Compact',
    description: 'Small, efficient model for short interactions',
    contextWindow: 64_000,
  },
  {
    id: 'kairos-research',
    object: 'model' as const,
    created: 1_742_780_800,
    owned_by: 'kairos',
    name: 'Kairos Research',
    description: 'Long-form analysis and synthesis',
    contextWindow: 200_000,
  },
] satisfies Array<ChatModelInfo>

export const THEME_PALETTE_OPTIONS = [
  {
    value: 'default',
    label: 'Default',
    description: 'Quiet neutrals with restrained contrast.',
  },
  {
    value: 'harvest',
    label: 'Harvest',
    description: 'Warm parchment, brass accents, and dusk-brown depth.',
  },
  {
    value: 'mist',
    label: 'Mist',
    description: 'Soft blue-grays with cool highlights and calm contrast.',
  },
  {
    value: 'canopy',
    label: 'Canopy',
    description: 'Muted moss, sage, and bark tones with grounded contrast.',
  },
  {
    value: 'ember',
    label: 'Ember',
    description: 'Clay reds and smoke-charcoal tones with warmer contrast.',
  },
  {
    value: 'tide',
    label: 'Tide',
    description: 'Slate blues and sea-glass accents with crisp structure.',
  },
] satisfies Array<{
  value: ThemePalette
  label: string
  description: string
}>

export type ChatSettings = {
  showToolMessages: boolean
  showReasoningBlocks: boolean
  showConversationNavigator: boolean
  themeMode: ThemeMode
  themePalette: ThemePalette
  wideMode: boolean
}

type ChatSettingsState = {
  settings: ChatSettings
  updateSettings: (updates: Partial<ChatSettings>) => void
}

const THEME_MODE_CLASS_NAMES = ['light', 'dark', 'system'] as const
const THEME_PALETTE_CLASS_NAMES = [
  'theme-default',
  'theme-harvest',
  'theme-mist',
  'theme-canopy',
  'theme-ember',
  'theme-tide',
] as const

const DEFAULT_CHAT_SETTINGS: ChatSettings = {
  showToolMessages: true,
  showReasoningBlocks: true,
  showConversationNavigator: true,
  themeMode: 'system',
  themePalette: 'default',
  wideMode: true,
}

function isThemeMode(value: unknown): value is ThemeMode {
  return value === 'system' || value === 'light' || value === 'dark'
}

function isThemePalette(value: unknown): value is ThemePalette {
  return (
    value === 'default' ||
    value === 'harvest' ||
    value === 'mist' ||
    value === 'canopy' ||
    value === 'ember' ||
    value === 'tide'
  )
}

function normalizeThemePalette(value: unknown): ThemePalette | null {
  if (value === 'gruvbox') return 'harvest'
  if (value === 'catppuccin') return 'mist'
  if (value === 'everforest') return 'canopy'
  return isThemePalette(value) ? value : null
}

function objectRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function booleanOrDefault(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function normalizeChatSettings(value: unknown): ChatSettings {
  const record = objectRecord(value)
  const legacyTheme = record?.theme
  const normalizedThemePalette = normalizeThemePalette(record?.themePalette)
  const themeMode = isThemeMode(record?.themeMode)
    ? record.themeMode
    : isThemeMode(legacyTheme)
      ? legacyTheme
      : DEFAULT_CHAT_SETTINGS.themeMode
  const themePalette = normalizedThemePalette ?? DEFAULT_CHAT_SETTINGS.themePalette

  return {
    showToolMessages: booleanOrDefault(
      record?.showToolMessages,
      DEFAULT_CHAT_SETTINGS.showToolMessages,
    ),
    showReasoningBlocks: booleanOrDefault(
      record?.showReasoningBlocks,
      DEFAULT_CHAT_SETTINGS.showReasoningBlocks,
    ),
    showConversationNavigator: booleanOrDefault(
      record?.showConversationNavigator,
      DEFAULT_CHAT_SETTINGS.showConversationNavigator,
    ),
    themeMode,
    themePalette,
    wideMode: booleanOrDefault(record?.wideMode, DEFAULT_CHAT_SETTINGS.wideMode),
  }
}

export function themePaletteClassName(themePalette: ThemePalette): string {
  if (themePalette === 'harvest') return 'theme-harvest'
  if (themePalette === 'mist') return 'theme-mist'
  if (themePalette === 'canopy') return 'theme-canopy'
  if (themePalette === 'ember') return 'theme-ember'
  if (themePalette === 'tide') return 'theme-tide'
  return 'theme-default'
}

export function applyThemeSettingsToDocument(settings: {
  themeMode: ThemeMode
  themePalette: ThemePalette
}) {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  root.classList.remove(
    ...THEME_MODE_CLASS_NAMES,
    ...THEME_PALETTE_CLASS_NAMES,
  )
  root.classList.add(settings.themeMode, themePaletteClassName(settings.themePalette))
  if (
    settings.themeMode === 'system' &&
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-color-scheme: dark)').matches
  ) {
    root.classList.add('dark')
  }
}

export const useChatSettingsStore = create<ChatSettingsState>()(
  persist(
    (set) => ({
      settings: DEFAULT_CHAT_SETTINGS,
      updateSettings: (updates) =>
        set((state) => {
          const nextSettings = { ...state.settings, ...updates }
          if (
            updates.themeMode !== undefined ||
            updates.themePalette !== undefined
          ) {
            applyThemeSettingsToDocument(nextSettings)
          }
          return {
            settings: nextSettings,
          }
        }),
    }),
    {
      name: 'chat-settings',
      version: 3,
      migrate: (persistedState) => {
        const state = objectRecord(persistedState)
        return {
          ...(state ?? {}),
          settings: normalizeChatSettings(state?.settings),
        }
      },
      onRehydrateStorage: () => (state) => {
        applyThemeSettingsToDocument(state?.settings ?? DEFAULT_CHAT_SETTINGS)
      },
    },
  ),
)

export function useChatSettings() {
  const settings = useChatSettingsStore((state) => state.settings)
  const updateSettings = useChatSettingsStore((state) => state.updateSettings)

  return {
    settings,
    updateSettings,
  }
}

export function getChatModelLabel(modelId: string): string {
  const match = MOCK_CHAT_MODELS.find((model) => model.id === modelId)
  return match?.name || modelId
}

export function getChatModelInfo(modelId: string): ChatModelInfo | undefined {
  return MOCK_CHAT_MODELS.find((model) => model.id === modelId)
}

export function useResolvedTheme() {
  const themeMode = useChatSettingsStore((state) => state.settings.themeMode)
  const [systemIsDark, setSystemIsDark] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined') return
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    setSystemIsDark(media.matches)
    function handleChange(event: MediaQueryListEvent) {
      setSystemIsDark(event.matches)
    }
    media.addEventListener('change', handleChange)
    return () => media.removeEventListener('change', handleChange)
  }, [])

  return useMemo(() => {
    if (themeMode === 'dark') return 'dark'
    if (themeMode === 'light') return 'light'
    return systemIsDark ? 'dark' : 'light'
  }, [themeMode, systemIsDark])
}
