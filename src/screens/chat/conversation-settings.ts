import { useMemo } from 'react'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { ProviderModel } from '@/lib/app-api'
import { providerModelKey } from '@/lib/model-utils'

export type ConversationSettings = {
  model: string
  systemPrompt: string
  webSearch: boolean
  mathTools: boolean
  advanced: ConversationAdvancedSettings
}

export type ReasoningEffort = 'low' | 'medium' | 'high'

export type ConversationAdvancedSettings = {
  reasoning: boolean
  reasoningEffort: ReasoningEffort
  sampling: boolean
  temperature: number
  topP: number
  topK: number
  penalties: boolean
  frequencyPenalty: number
  presencePenalty: number
  maxTokens: boolean
  maxTokensValue: number
}

export type ChatRequestAdvancedSettings = {
  reasoning?: {
    effort?: ReasoningEffort
  }
  sampling?: {
    temperature?: number
    topP?: number
    topK?: number
  }
  penalties?: {
    frequencyPenalty?: number
    presencePenalty?: number
  }
  maxTokens?: number
}

type ConversationSettingsState = {
  conversations: Record<string, ConversationSettings>
  updateConversationSettings: (
    conversationId: string,
    updates: Partial<ConversationSettings>,
  ) => void
  copyConversationSettings: (
    sourceConversationId: string,
    targetConversationId: string,
  ) => void
  clearConversationModelOverride: (conversationId: string) => void
}

export const defaultConversationSettings: ConversationSettings = {
  model: '',
  systemPrompt: '',
  webSearch: true,
  mathTools: true,
  advanced: {
    reasoning: false,
    reasoningEffort: 'medium',
    sampling: false,
    temperature: 0.7,
    topP: 1,
    topK: 0,
    penalties: false,
    frequencyPenalty: 0,
    presencePenalty: 0,
    maxTokens: false,
    maxTokensValue: 4096,
  },
}

export const useConversationSettingsStore = create<ConversationSettingsState>()(
  persist(
    (set) => ({
      conversations: {},
      updateConversationSettings: (conversationId, updates) =>
        set((state) => ({
          conversations: {
            ...state.conversations,
            [conversationId]: {
              ...(state.conversations[conversationId] ??
                defaultConversationSettings),
              ...updates,
            },
          },
        })),
      copyConversationSettings: (sourceConversationId, targetConversationId) =>
        set((state) => {
          const sourceSettings = normalizeConversationSettings(
            state.conversations[sourceConversationId],
          )

          return {
            conversations: {
              ...state.conversations,
              [targetConversationId]: {
                ...sourceSettings,
              },
            },
          }
        }),
      clearConversationModelOverride: (conversationId) =>
        set((state) => {
          const current = state.conversations[conversationId]
          if (!current || current.model === '') return state
          return {
            conversations: {
              ...state.conversations,
              [conversationId]: {
                ...current,
                model: '',
              },
            },
          }
        }),
    }),
    {
      name: 'kairos-conversation-settings',
    },
  ),
)

export function useConversationSettings(conversationId: string) {
  const storedSettings = useConversationSettingsStore(
    (state) => state.conversations[conversationId],
  )
  const settings = useMemo(
    function buildSettings() {
      return normalizeConversationSettings(storedSettings)
    },
    [storedSettings],
  )
  const updateConversationSettings = useConversationSettingsStore(
    (state) => state.updateConversationSettings,
  )

  return {
    settings,
    updateSettings(updates: Partial<ConversationSettings>) {
      updateConversationSettings(conversationId, updates)
    },
  }
}

export function copyConversationSettings(
  sourceConversationId: string,
  targetConversationId: string,
) {
  useConversationSettingsStore
    .getState()
    .copyConversationSettings(sourceConversationId, targetConversationId)
}

export function clearConversationModelOverride(conversationId: string) {
  useConversationSettingsStore
    .getState()
    .clearConversationModelOverride(conversationId)
}

export function beginFreshNewChat() {
  clearConversationModelOverride('new')
}

function normalizeConversationSettings(
  settings: Partial<ConversationSettings> | undefined,
): ConversationSettings {
  return {
    ...defaultConversationSettings,
    ...settings,
    advanced: {
      ...defaultConversationSettings.advanced,
      ...settings?.advanced,
    },
  }
}

export function resolveConversationModelID(
  preferredModelID: string,
  models: Array<ProviderModel>,
  defaultModelID?: string,
) {
  const normalizedPreferredModelID =
    normalizeConversationStringValue(preferredModelID)
  if (
    normalizedPreferredModelID &&
    models.some(function hasPreferredModel(model) {
      return (
        providerModelKey(model) === normalizedPreferredModelID ||
        model.id === normalizedPreferredModelID
      )
    })
  ) {
    return (
      models.find(function findPreferredModel(model) {
        return (
          providerModelKey(model) === normalizedPreferredModelID ||
          model.id === normalizedPreferredModelID
        )
      })?.modelRef ?? normalizedPreferredModelID
    )
  }

  const normalizedDefaultModelID =
    normalizeConversationStringValue(defaultModelID)
  if (
    normalizedDefaultModelID &&
    models.some(function hasDefaultModel(model) {
      return (
        providerModelKey(model) === normalizedDefaultModelID ||
        model.id === normalizedDefaultModelID
      )
    })
  ) {
    return (
      models.find(function findDefaultModel(model) {
        return (
          providerModelKey(model) === normalizedDefaultModelID ||
          model.id === normalizedDefaultModelID
        )
      })?.modelRef ?? normalizedDefaultModelID
    )
  }

  if (models.length > 0) {
    return providerModelKey(models[0])
  }

  return ''
}

export function buildChatRequestAdvancedSettings(
  settings: ConversationAdvancedSettings,
): ChatRequestAdvancedSettings | undefined {
  const advanced: ChatRequestAdvancedSettings = {}

  if (settings.reasoning) {
    advanced.reasoning = {
      effort: settings.reasoningEffort,
    }
  }

  if (settings.sampling) {
    advanced.sampling = {
      temperature: clampNumber(settings.temperature, 0, 2),
      topP: clampNumber(settings.topP, 0, 1),
    }
    if (settings.topK > 0) {
      advanced.sampling.topK = Math.floor(clampNumber(settings.topK, 0, 1000))
    }
  }

  if (settings.penalties) {
    advanced.penalties = {
      frequencyPenalty: clampNumber(settings.frequencyPenalty, -2, 2),
      presencePenalty: clampNumber(settings.presencePenalty, -2, 2),
    }
  }

  if (settings.maxTokens) {
    advanced.maxTokens = Math.floor(
      clampNumber(settings.maxTokensValue, 1, 200000),
    )
  }

  return Object.keys(advanced).length > 0 ? advanced : undefined
}

function clampNumber(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min
  return Math.min(Math.max(value, min), max)
}

export function normalizeConversationTextSetting(value: string): string {
  return normalizeConversationStringValue(value)
}

function normalizeConversationStringValue(
  value: string | number | null | undefined,
) {
  if (typeof value === 'string') {
    return value.trim()
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value)
  }
  return ''
}
