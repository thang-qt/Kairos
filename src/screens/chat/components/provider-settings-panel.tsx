import { useState } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import { Add01Icon, Delete02Icon } from '@hugeicons/core-free-icons'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  ApiError,
  appQueryKeys,
  createProvider,
  deleteProvider,
  updatePreferences,
  updateProvider,
  useCapabilitiesQuery,
  useProvidersQuery,
} from '@/lib/app-api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'

function mutationErrorMessage(error: unknown, fallback: string) {
  if (error instanceof ApiError) {
    return error.message
  }
  if (error instanceof Error) {
    return error.message
  }
  return fallback
}

export function ProviderSettingsPanel() {
  const queryClient = useQueryClient()
  const capabilitiesQuery = useCapabilitiesQuery()
  const providersQuery = useProvidersQuery()
  const [label, setLabel] = useState('')
  const [baseURL, setBaseURL] = useState('')
  const [apiKey, setAPIKey] = useState('')
  const [errorMessage, setErrorMessage] = useState('')

  const providers = providersQuery.data?.providers ?? []
  const preferences = providersQuery.data?.preferences
  const capabilities = capabilitiesQuery.data?.providers

  const refreshProviderQueries = async function refreshProviderQueries() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: appQueryKeys.providers }),
      queryClient.invalidateQueries({ queryKey: appQueryKeys.models }),
      queryClient.invalidateQueries({ queryKey: appQueryKeys.preferences }),
    ])
  }

  const createProviderMutation = useMutation({
    mutationFn: createProvider,
    onSuccess: async function handleSuccess() {
      setLabel('')
      setBaseURL('')
      setAPIKey('')
      setErrorMessage('')
      await refreshProviderQueries()
    },
    onError: function handleError(error) {
      setErrorMessage(
        mutationErrorMessage(error, 'Failed to save provider.'),
      )
    },
  })

  const updateProviderMutation = useMutation({
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
      setErrorMessage(
        mutationErrorMessage(error, 'Failed to update provider.'),
      )
    },
  })

  const deleteProviderMutation = useMutation({
    mutationFn: deleteProvider,
    onSuccess: refreshProviderQueries,
    onError: function handleError(error) {
      setErrorMessage(
        mutationErrorMessage(error, 'Failed to delete provider.'),
      )
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
    if (!apiKey.trim()) {
      setErrorMessage('API key is required.')
      return
    }

    createProviderMutation.mutate({
      label: label.trim() || 'Custom Provider',
      baseUrl: baseURL.trim(),
      apiKey: apiKey.trim(),
      kind: 'openai_compatible',
      supportsModelSync: capabilities?.canSyncModels ?? true,
    })
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-sm text-primary-800">Provider access</div>
          <div className="text-xs text-primary-500">
            Models are loaded from enabled providers. Server providers stay
            read-only.
          </div>
        </div>
        <span className="text-xs text-primary-500">
          {providersQuery.isLoading ? 'Loading...' : `${providers.length} total`}
        </span>
      </div>

      {capabilities?.systemProvidersEnabled ? (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-primary-200 px-3 py-2">
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm text-primary-900">
              Use server provider
            </div>
            <div className="text-xs text-primary-500">
              Turn it off only if you want Kairos to use your BYOK providers
              exclusively.
            </div>
          </div>
          <Switch
            checked={preferences?.useSystemProviders ?? true}
            disabled={
              !capabilities.canDisableSystemProvider ||
              updatePreferencesMutation.isPending
            }
            onCheckedChange={function handleCheckedChange(checked) {
              updatePreferencesMutation.mutate({
                useSystemProviders: checked,
              })
            }}
          />
        </div>
      ) : null}

      <div className="space-y-2">
        {providers.map((provider) => (
          <div
            key={provider.ref}
            className="flex items-center gap-3 rounded-lg border border-primary-200 px-3 py-2"
          >
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm text-primary-900">
                {provider.label}
              </div>
              <div className="truncate text-xs text-primary-500">
                {provider.systemManaged ? 'System' : 'User'} · {provider.kind}
                {provider.baseUrl ? ` · ${provider.baseUrl}` : ''}
              </div>
            </div>
            {!provider.systemManaged ? (
              <Switch
                checked={provider.enabled}
                disabled={updateProviderMutation.isPending}
                onCheckedChange={function handleCheckedChange(checked) {
                  updateProviderMutation.mutate({
                    providerId: provider.id,
                    enabled: checked,
                  })
                }}
              />
            ) : (
              <span className="text-xs text-primary-500">
                {provider.enabled ? 'enabled' : 'disabled'}
              </span>
            )}
            {!provider.systemManaged ? (
              <Button
                size="icon-sm"
                variant="ghost"
                onClick={function handleDelete() {
                  deleteProviderMutation.mutate(provider.id)
                }}
                aria-label={`Delete ${provider.label}`}
                className="text-primary-500 hover:bg-primary-100"
              >
                <HugeiconsIcon
                  icon={Delete02Icon}
                  size={20}
                  strokeWidth={1.5}
                />
              </Button>
            ) : null}
          </div>
        ))}
      </div>

      {capabilities?.userProvidersEnabled ? (
        <div className="space-y-2 rounded-lg border border-primary-200 p-3">
          <div className="text-sm text-primary-900">Add provider</div>
          <Input
            placeholder="Label"
            value={label}
            onChange={function handleChange(event) {
              setLabel(event.target.value)
            }}
          />
          <Input
            placeholder="Base URL"
            value={baseURL}
            disabled={!capabilities.canAddCustomBaseUrl}
            onChange={function handleChange(event) {
              setBaseURL(event.target.value)
            }}
          />
          <Input
            placeholder="API key"
            type="password"
            value={apiKey}
            onChange={function handleChange(event) {
              setAPIKey(event.target.value)
            }}
          />
          <div className="flex items-center justify-between gap-3">
            <div className="text-xs text-primary-500">
              OpenAI-compatible providers only in v1.
            </div>
            <Button
              size="sm"
              onClick={handleCreateProvider}
              disabled={createProviderMutation.isPending}
            >
              <HugeiconsIcon icon={Add01Icon} size={20} strokeWidth={1.5} />
              <span>Add</span>
            </Button>
          </div>
        </div>
      ) : null}

      {errorMessage ? (
        <div className="text-xs text-red-600">{errorMessage}</div>
      ) : null}
    </div>
  )
}
