import { useMemo } from 'react'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { ProviderModel } from '@/lib/app-api'
import { providerModelKey } from '@/lib/model-utils'
import type { ThinkingLevel } from '@/hooks/use-chat-settings'

export type ConversationSettings = {
  model: string
  systemPrompt: string
  temperature: string
  topP: string
  maxOutputTokens: string
  thinkingLevel: ThinkingLevel
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
}

export const defaultConversationSettings: ConversationSettings = {
  model: '',
  systemPrompt: '',
  temperature: '',
  topP: '',
  maxOutputTokens: '',
  thinkingLevel: 'high',
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
          const sourceSettings = {
            ...defaultConversationSettings,
            ...(state.conversations[sourceConversationId] ??
              defaultConversationSettings),
          }

          return {
            conversations: {
              ...state.conversations,
              [targetConversationId]: {
                ...sourceSettings,
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
      return {
        ...defaultConversationSettings,
        ...storedSettings,
      }
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

export function normalizeConversationTextSetting(value: string): string {
  return normalizeConversationStringValue(value)
}

export function parseConversationNumberSetting(
  value: string | number | null | undefined,
  {
    max,
    min,
    round = false,
  }: {
    min: number
    max: number
    round?: boolean
  },
): number | undefined {
  const normalizedValue = normalizeConversationStringValue(value)
  if (normalizedValue.length === 0) return undefined

  const parsedValue = Number(normalizedValue)
  if (!Number.isFinite(parsedValue)) return undefined
  if (parsedValue < min || parsedValue > max) return undefined
  if (round && !Number.isInteger(parsedValue)) return undefined

  return parsedValue
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
