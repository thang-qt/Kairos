import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { ProviderModel } from '@/lib/app-api'

export type ConversationSettings = {
  model: string
  thinkingLevel: 'low' | 'medium' | 'high'
  temperature: number
  topP: number
  maxOutputTokens: number
}

type ConversationSettingsState = {
  conversations: Record<string, ConversationSettings>
  updateConversationSettings: (
    conversationId: string,
    updates: Partial<ConversationSettings>,
  ) => void
}

export const defaultConversationSettings: ConversationSettings = {
  model: '',
  thinkingLevel: 'medium',
  temperature: 0.7,
  topP: 1,
  maxOutputTokens: 2048,
}

export const useConversationSettingsStore =
  create<ConversationSettingsState>()(
    persist(
      (set) => ({
        conversations: {},
        updateConversationSettings: (conversationId, updates) =>
          set((state) => ({
            conversations: {
              ...state.conversations,
              [conversationId]: {
                ...(state.conversations[conversationId] ?? defaultConversationSettings),
                ...updates,
              },
            },
          })),
      }),
      {
        name: 'kairos-conversation-settings',
      },
    ),
  )

export function useConversationSettings(conversationId: string) {
  const settings = useConversationSettingsStore(
    (state) => state.conversations[conversationId] ?? defaultConversationSettings,
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

export function resolveConversationModelID(
  preferredModelID: string,
  models: Array<ProviderModel>,
  defaultModelID?: string,
) {
  const normalizedPreferredModelID = preferredModelID.trim()
  if (
    normalizedPreferredModelID &&
    models.some((model) => model.id === normalizedPreferredModelID)
  ) {
    return normalizedPreferredModelID
  }

  const normalizedDefaultModelID = defaultModelID?.trim()
  if (
    normalizedDefaultModelID &&
    models.some((model) => model.id === normalizedDefaultModelID)
  ) {
    return normalizedDefaultModelID
  }

  if (models.length > 0) {
    return models[0].id
  }

  if (normalizedPreferredModelID) {
    return normalizedPreferredModelID
  }

  return 'kairos-balanced'
}
