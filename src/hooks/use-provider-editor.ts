import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  appQueryKeys,
  createProvider,
  deleteProvider,
  updatePreferences,
  updateProvider,
} from '@/lib/app-api'
import type { UpdateProviderPayload } from '@/lib/app-api'
import { mutationErrorMessage } from '@/lib/error-utils'

export type ProviderEditorState =
  | {
      mode: 'add'
    }
  | {
      mode: 'edit'
      providerId: string
    }

export type ProviderKind = 'openrouter' | 'openai'

export type ProviderDraftState = {
  kind: ProviderKind
  label: string
  baseURL: string
  apiKey: string
}

export const providerKindDefaults: Record<
  ProviderKind,
  { label: string; baseURL: string }
> = {
  openrouter: {
    label: 'OpenRouter',
    baseURL: 'https://openrouter.ai/api/v1',
  },
  openai: {
    label: 'OpenAI Compatible',
    baseURL: 'https://api.openai.com/v1',
  },
}

export const defaultProviderDraft = {
  kind: 'openrouter',
  ...providerKindDefaults.openrouter,
} as const

export function createEmptyProviderDraft(): ProviderDraftState {
  return {
    ...defaultProviderDraft,
    apiKey: '',
  }
}

export function useProviderEditor(options?: { canSyncModels?: boolean }) {
  const queryClient = useQueryClient()
  const [editorState, setEditorState] = useState<ProviderEditorState | null>(
    null,
  )
  const [draft, setDraft] = useState<ProviderDraftState>(
    createEmptyProviderDraft(),
  )
  const [errorMessage, setErrorMessage] = useState('')

  const refreshProviderQueries = async function refreshProviderQueries() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: appQueryKeys.providers }),
      queryClient.invalidateQueries({ queryKey: appQueryKeys.models }),
      queryClient.invalidateQueries({ queryKey: appQueryKeys.preferences }),
    ])
  }

  function resetEditorFeedback() {
    setErrorMessage('')
  }

  function resetEditorState() {
    setEditorState(null)
    setDraft(createEmptyProviderDraft())
    resetEditorFeedback()
  }

  function openAddEditor() {
    setEditorState({ mode: 'add' })
    setDraft(createEmptyProviderDraft())
    resetEditorFeedback()
  }

  function openEditEditor(provider: {
    id: string
    kind?: string
    label: string
    baseUrl?: string
  }) {
    setEditorState({
      mode: 'edit',
      providerId: provider.id,
    })
    setDraft({
      kind: provider.kind === 'openai' ? 'openai' : 'openrouter',
      label: provider.label,
      baseURL: provider.baseUrl ?? '',
      apiKey: '',
    })
    resetEditorFeedback()
  }

  function updateDraft<TKey extends keyof ProviderDraftState>(
    key: TKey,
    value: ProviderDraftState[TKey],
  ) {
    setDraft(function handleDraft(previous) {
      if (key === 'kind') {
        const nextKind = value as ProviderKind
        const defaults = providerKindDefaults[nextKind]
        const previousDefaults = providerKindDefaults[previous.kind]
        return {
          ...previous,
          kind: nextKind,
          label:
            previous.label.trim() === '' ||
            previous.label === previousDefaults.label
              ? defaults.label
              : previous.label,
          baseURL:
            previous.baseURL.trim() === '' ||
            previous.baseURL === previousDefaults.baseURL
              ? defaults.baseURL
              : previous.baseURL,
        }
      }
      return {
        ...previous,
        [key]: value,
      }
    })
    resetEditorFeedback()
  }

  function buildUpdateProviderPayload(): UpdateProviderPayload {
    const payload: UpdateProviderPayload = {
      label: draft.label.trim() || 'Custom Provider',
      baseUrl: draft.baseURL.trim(),
    }

    if (draft.apiKey.trim()) {
      payload.apiKey = draft.apiKey.trim()
    }

    return payload
  }

  const createProviderMutation = useMutation({
    mutationFn: createProvider,
    onSuccess: async function handleSuccess() {
      resetEditorState()
      await refreshProviderQueries()
    },
    onError: function handleError(error) {
      setErrorMessage(mutationErrorMessage(error, 'Failed to save provider.'))
    },
  })

  const toggleProviderMutation = useMutation({
    mutationFn: function mutate(payload: {
      providerId: string
      enabled?: boolean
    }) {
      return updateProvider(payload.providerId, {
        enabled: payload.enabled,
      })
    },
    onSuccess: refreshProviderQueries,
    onError: function handleError(error) {
      setErrorMessage(mutationErrorMessage(error, 'Failed to update provider.'))
    },
  })

  const saveProviderMutation = useMutation({
    mutationFn: function mutate(payload: {
      providerId: string
      values: UpdateProviderPayload
    }) {
      return updateProvider(payload.providerId, payload.values)
    },
    onSuccess: async function handleSuccess() {
      resetEditorState()
      await refreshProviderQueries()
    },
    onError: function handleError(error) {
      setErrorMessage(mutationErrorMessage(error, 'Failed to save provider.'))
    },
  })

  const deleteProviderMutation = useMutation({
    mutationFn: deleteProvider,
    onSuccess: refreshProviderQueries,
    onError: function handleError(error) {
      setErrorMessage(mutationErrorMessage(error, 'Failed to delete provider.'))
    },
  })

  const updatePreferencesMutation = useMutation({
    mutationFn: updatePreferences,
    onSuccess: refreshProviderQueries,
    onError: function handleError(error) {
      setErrorMessage(
        mutationErrorMessage(error, 'Failed to update preferences.'),
      )
    },
  })

  function handleCreateProvider() {
    if (!draft.apiKey.trim()) {
      setErrorMessage('API key is required.')
      return
    }

    createProviderMutation.mutate({
      label: draft.label.trim() || 'Custom Provider',
      baseUrl: draft.baseURL.trim(),
      apiKey: draft.apiKey.trim(),
      kind: draft.kind,
      supportsModelSync: options?.canSyncModels ?? true,
    })
  }

  function handleSaveProvider() {
    if (editorState?.mode !== 'edit') {
      return
    }

    saveProviderMutation.mutate({
      providerId: editorState.providerId,
      values: buildUpdateProviderPayload(),
    })
  }

  return {
    createProviderMutation,
    deleteProviderMutation,
    draft,
    editorState,
    errorMessage,
    handleCreateProvider,
    handleSaveProvider,
    openAddEditor,
    openEditEditor,
    refreshProviderQueries,
    resetEditorState,
    saveProviderMutation,
    setErrorMessage,
    toggleProviderMutation,
    updateDraft,
    updatePreferencesMutation,
  }
}
