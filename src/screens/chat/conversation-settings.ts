import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { ProviderModel } from '@/lib/app-api'

export type ConversationSettings = {
  model: string
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
          const sourceSettings =
            state.conversations[sourceConversationId] ??
            defaultConversationSettings

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
  const settings = useConversationSettingsStore(
    (state) =>
      state.conversations[conversationId] ?? defaultConversationSettings,
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

  return ''
}
