import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import {
  ApiError,
  appQueryKeys,
  updatePreferences,
  useModelsQuery,
  useProvidersQuery,
} from '@/lib/app-api'

function mutationErrorMessage(error: unknown, fallback: string) {
  if (error instanceof ApiError) {
    return error.message
  }
  if (error instanceof Error) {
    return error.message
  }
  return fallback
}

export function ModelSettingsPanel() {
  const queryClient = useQueryClient()
  const modelsQuery = useModelsQuery()
  const providersQuery = useProvidersQuery()
  const [errorMessage, setErrorMessage] = useState('')

  const models = modelsQuery.data?.models ?? []
  const preferences = modelsQuery.data?.preferences
  const defaultModelId = preferences?.defaultModelId

  const defaultModel = models.find((m) => m.id === defaultModelId)

  const refreshPreferences = async function refreshPreferences() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: appQueryKeys.preferences }),
      queryClient.invalidateQueries({ queryKey: appQueryKeys.models }),
    ])
  }

  const updatePreferencesMutation = useMutation({
    mutationFn: updatePreferences,
    onSuccess: refreshPreferences,
    onError: function handleError(error) {
      setErrorMessage(
        mutationErrorMessage(error, 'Failed to update preferences.'),
      )
    },
  })

  function handleSelectModel(event: React.ChangeEvent<HTMLSelectElement>) {
    const value = event.target.value
    if (value) {
      updatePreferencesMutation.mutate({
        defaultModelId: value,
      })
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-sm text-primary-800">Default model</div>
          <div className="text-xs text-primary-500">
            Used as the default for new conversations. You can override per
            conversation.
          </div>
        </div>
        <span className="text-xs text-primary-500">
          {modelsQuery.isLoading ? 'Loading...' : `${models.length} available`}
        </span>
      </div>

      {modelsQuery.isLoading ? (
        <div className="text-sm text-primary-500">Loading models...</div>
      ) : models.length === 0 ? (
        <div className="text-sm text-primary-500">
          No models available. Add a provider first.
        </div>
      ) : (
        <select
          value={defaultModelId || ''}
          onChange={handleSelectModel}
          disabled={updatePreferencesMutation.isPending}
          className="w-full rounded-lg border border-primary-200 bg-primary-50 px-3 py-2 text-sm text-primary-900 outline-none transition-colors hover:border-primary-300 focus:border-primary-400 focus:ring-2 focus:ring-primary-400/20"
        >
          {!defaultModelId ? <option value="">Select a model...</option> : null}
          {models.map((model) => (
            <option key={model.id} value={model.id}>
              {model.id}
              {model.providerLabel ? ` (${model.providerLabel})` : ''}
              {model.name ? ` - ${model.name}` : ''}
            </option>
          ))}
        </select>
      )}

      {defaultModel ? (
        <div className="rounded-lg border border-primary-200 bg-primary-50 px-3 py-2">
          <div className="flex items-center justify-between gap-2">
            <span className="truncate font-mono text-xs text-primary-800">
              {defaultModel.id}
            </span>
            <span className="shrink-0 rounded-full bg-primary-100 px-2 py-0.5 text-[11px] text-primary-700">
              default
            </span>
          </div>
          {defaultModel.name || defaultModel.providerLabel ? (
            <div className="mt-1 text-xs text-primary-500">
              {defaultModel.providerLabel || defaultModel.owned_by}
              {defaultModel.name ? ` · ${defaultModel.name}` : ''}
            </div>
          ) : null}
        </div>
      ) : null}

      {errorMessage ? (
        <div className="text-xs text-red-600">{errorMessage}</div>
      ) : null}

      {!providersQuery.data?.preferences.useSystemProviders &&
      (providersQuery.data?.providers ?? []).length === 0 ? (
        <div className="rounded-lg border border-primary-200 bg-primary-50 p-3 text-xs text-primary-700">
          No providers configured. Add a provider to get started.
        </div>
      ) : null}
    </div>
  )
}
