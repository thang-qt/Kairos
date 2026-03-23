import { useEffect, useMemo, useState } from 'react'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type ThemeMode = 'system' | 'light' | 'dark'
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

export type ChatSettings = {
  showToolMessages: boolean
  showReasoningBlocks: boolean
  showConversationNavigator: boolean
  theme: ThemeMode
  wideMode: boolean
}

type ChatSettingsState = {
  settings: ChatSettings
  updateSettings: (updates: Partial<ChatSettings>) => void
}

export const useChatSettingsStore = create<ChatSettingsState>()(
  persist(
    (set) => ({
      settings: {
        showToolMessages: true,
        showReasoningBlocks: true,
        showConversationNavigator: true,
        theme: 'system',
        wideMode: true,
      },
      updateSettings: (updates) =>
        set((state) => ({
          settings: { ...state.settings, ...updates },
        })),
    }),
    {
      name: 'chat-settings',
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
  const theme = useChatSettingsStore((state) => state.settings.theme)
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
    if (theme === 'dark') return 'dark'
    if (theme === 'light') return 'light'
    return systemIsDark ? 'dark' : 'light'
  }, [theme, systemIsDark])
}
