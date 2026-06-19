import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  appQueryKeys,
  createProvider,
  deleteProvider,
  testConnection,
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

export type ProviderDraftState = {
  label: string
  baseURL: string
  apiKey: string
}

export function createEmptyProviderDraft(): ProviderDraftState {
  return {
    label: '',
    baseURL: '',
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
  const [testingConnection, setTestingConnection] = useState(false)
  const [testResult, setTestResult] = useState<{
    success: boolean
    message: string
  } | null>(null)

  const refreshProviderQueries = async function refreshProviderQueries() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: appQueryKeys.providers }),
      queryClient.invalidateQueries({ queryKey: appQueryKeys.models }),
      queryClient.invalidateQueries({ queryKey: appQueryKeys.preferences }),
    ])
  }

  function resetEditorFeedback() {
    setErrorMessage('')
    setTestResult(null)
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
    label: string
    baseUrl?: string
  }) {
    setEditorState({
      mode: 'edit',
      providerId: provider.id,
    })
    setDraft({
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
      kind: 'openai_compatible',
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

  async function handleTestConnection() {
    if (!draft.apiKey.trim()) {
      setErrorMessage('API key is required.')
      return
    }
    if (!draft.baseURL.trim()) {
      setErrorMessage('Base URL is required for testing.')
      return
    }

    setTestingConnection(true)
    setErrorMessage('')
    setTestResult(null)

    try {
      const result = await testConnection({
        kind: 'openai_compatible',
        baseUrl: draft.baseURL.trim(),
        apiKey: draft.apiKey.trim(),
      })
      setTestResult({
        success: result.success,
        message: result.message || '',
      })
      if (!result.success) {
        setErrorMessage(result.message || 'Connection failed.')
      }
    } catch (error) {
      setTestResult({ success: false, message: 'Connection failed.' })
      setErrorMessage(
        error instanceof Error ? error.message : 'Connection failed.',
      )
    } finally {
      setTestingConnection(false)
    }
  }

  return {
    createProviderMutation,
    deleteProviderMutation,
    draft,
    editorState,
    errorMessage,
    handleCreateProvider,
    handleSaveProvider,
    handleTestConnection,
    openAddEditor,
    openEditEditor,
    refreshProviderQueries,
    resetEditorState,
    saveProviderMutation,
    setErrorMessage,
    testResult,
    testingConnection,
    toggleProviderMutation,
    updateDraft,
    updatePreferencesMutation,
  }
}
