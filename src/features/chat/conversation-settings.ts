import { useCallback, useMemo, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { create } from 'zustand'

import {
  invalidateChatSessionQueries,
  upsertSessionSummary,
} from './chat-queries'
import { getChatBackend } from '@/lib/chat-backend'
import { providerModelKey } from '@/lib/model-utils'

import type { ProviderModel } from '@/lib/app-api'
import type {
  ConversationAdvancedSettings,
  ConversationSettings,
  SessionMeta,
} from '@/lib/chat-backend/contracts'

export type { ConversationAdvancedSettings, ConversationSettings }

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

type ConversationSettingsDraft = Omit<
  Partial<ConversationSettings>,
  'advanced'
> & {
  advanced?: Partial<ConversationAdvancedSettings>
}

type NewConversationSettingsState = {
  settings: ConversationSettingsDraft
  generation: number
  updateSettings: (updates: Partial<ConversationSettings>) => void
  reset: () => void
}

export const useConversationSettingsStore =
  create<NewConversationSettingsState>((set) => ({
    settings: {},
    generation: 0,
    updateSettings: (updates) =>
      set((state) => ({
        settings: {
          ...state.settings,
          ...updates,
          advanced: { ...state.settings.advanced, ...updates.advanced },
        },
      })),
    reset: () =>
      set((state) => ({
        settings: {},
        generation: state.generation + 1,
      })),
  }))

type UseConversationSettingsInput = {
  conversationId: string
  session?: SessionMeta
  defaultSettings?: ConversationSettings
  modelOverrides?: Record<string, ConversationSettings>
  defaultModelId?: string
}

export function useConversationSettings({
  conversationId,
  session,
  defaultSettings = defaultConversationSettings,
  modelOverrides = {},
  defaultModelId,
}: UseConversationSettingsInput) {
  const queryClient = useQueryClient()
  const newConversationSettings = useConversationSettingsStore(
    (state) => state.settings,
  )
  const updateNewConversationSettings = useConversationSettingsStore(
    (state) => state.updateSettings,
  )
  const persistenceQueue = useRef(Promise.resolve())
  const settings = useMemo(
    function getSettings() {
      if (conversationId !== 'new') {
        return normalizeConversationSettings(session?.settings)
      }
      const modelId =
        newConversationSettings.model ||
        defaultSettings.model ||
        defaultModelId ||
        ''
      const modelOverride = modelOverrides[modelId]
      const settingsWithModelOverride = modelOverride
        ? { ...modelOverride, model: defaultSettings.model }
        : defaultSettings
      return mergeConversationSettings(
        settingsWithModelOverride,
        newConversationSettings,
      )
    },
    [
      conversationId,
      defaultModelId,
      defaultSettings,
      modelOverrides,
      newConversationSettings,
      session?.settings,
    ],
  )

  const updateSettings = useCallback(
    function updateSettings(updates: Partial<ConversationSettings>) {
      const nextSettings = mergeConversationSettings(settings, updates)
      if (conversationId === 'new') {
        if (Object.hasOwn(updates, 'model')) {
          updateNewConversationSettings({ model: updates.model })
        } else {
          updateNewConversationSettings(updates)
        }
        return
      }

      if (!session) return
      upsertSessionSummary(queryClient, { ...session, settings: nextSettings })
      persistenceQueue.current = persistenceQueue.current
        .catch(function ignorePreviousSaveFailure() {})
        .then(async function saveSettings() {
          await getChatBackend().updateConversationSettings({
            sessionKey: session.key,
            friendlyId: conversationId,
            settings: nextSettings,
          })
          await invalidateChatSessionQueries(queryClient)
        })
        .catch(function refreshAfterSaveFailure() {
          void invalidateChatSessionQueries(queryClient)
        })
    },
    [
      conversationId,
      queryClient,
      session,
      settings,
      updateNewConversationSettings,
    ],
  )

  return { settings, updateSettings }
}

export function beginFreshNewChat() {
  useConversationSettingsStore.getState().reset()
}

export function mergeConversationSettings(
  settings: ConversationSettings,
  updates: ConversationSettingsDraft,
): ConversationSettings {
  return {
    ...settings,
    ...updates,
    advanced: {
      ...settings.advanced,
      ...updates.advanced,
    },
  }
}

function normalizeConversationSettings(
  settings: Partial<ConversationSettings> | undefined,
): ConversationSettings {
  return mergeConversationSettings(defaultConversationSettings, settings ?? {})
}

// Display-only fallback for the model picker. Commands send the settings draft.
export function displayConversationModelID(
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

  if (models.length > 0) return providerModelKey(models[0])
  return ''
}

function normalizeConversationStringValue(
  value: string | number | null | undefined,
) {
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return ''
}
