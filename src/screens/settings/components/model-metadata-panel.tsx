import { useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { ProviderModel } from '@/lib/app-api'
import {
  ApiError,
  appQueryKeys,
  syncModels,
  updateModelMetadata,
  useModelsQuery,
  useProvidersQuery,
} from '@/lib/app-api'
import { ModelSettingsPanel } from '@/screens/chat/components/model-settings-panel'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

function mutationErrorMessage(error: unknown, fallback: string) {
  if (error instanceof ApiError) {
    return error.message
  }
  if (error instanceof Error) {
    return error.message
  }
  return fallback
}

function formatContextWindow(value?: number) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return 'Unknown'
  }
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(value % 1_000_000 === 0 ? 0 : 1)}M`
  }
  if (value >= 1_000) {
    return `${Math.round(value / 1_000)}K`
  }
  return String(value)
}

type ModelMetadataEditorProps = {
  model: ProviderModel
  onSave: (payload: {
    modelId: string
    name: string
    description: string
    contextWindow: number
  }) => Promise<void>
  onReset: (modelId: string) => Promise<void>
  savePending: boolean
  resetPending: boolean
}

function ModelMetadataEditor({
  model,
  onSave,
  onReset,
  savePending,
  resetPending,
}: ModelMetadataEditorProps) {
  const [name, setName] = useState(model.name ?? '')
  const [description, setDescription] = useState(model.description ?? '')
  const [contextWindow, setContextWindow] = useState(
    model.contextWindow ? String(model.contextWindow) : '',
  )

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const normalizedContextWindow = Number.parseInt(contextWindow, 10)
    await onSave({
      modelId: model.id,
      name: name.trim(),
      description: description.trim(),
      contextWindow:
        Number.isFinite(normalizedContextWindow) && normalizedContextWindow > 0
          ? normalizedContextWindow
          : 0,
    })
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="rounded-lg border border-primary-200 bg-primary-50/50 px-4 py-3">
        <div className="truncate font-mono text-xs text-primary-800">
          {model.id}
        </div>
        <div className="mt-1 text-sm text-primary-900">
          {model.providerLabel || model.owned_by}
        </div>
        <div className="mt-1 text-xs text-primary-500 tabular-nums">
          {formatContextWindow(model.contextWindow)} context window
        </div>
      </div>

      <div className="space-y-1.5">
        <label className="text-xs text-primary-500" htmlFor="model-name">
          Display name
        </label>
        <Input
          id="model-name"
          value={name}
          onChange={function handleChange(event) {
            setName(event.target.value)
          }}
          placeholder="GPT-4.1 Mini"
        />
      </div>

      <div className="space-y-1.5">
        <label
          className="text-xs text-primary-500"
          htmlFor="model-description"
        >
          Description
        </label>
        <textarea
          id="model-description"
          value={description}
          onChange={function handleChange(event) {
            setDescription(event.target.value)
          }}
          rows={4}
          placeholder="Short model description"
          className="w-full rounded-lg border border-primary-200 bg-surface px-3 py-2 text-sm text-primary-900 outline-none transition-colors hover:border-primary-300 focus:border-primary-400 focus:ring-2 focus:ring-primary-400/20"
        />
      </div>

      <div className="space-y-1.5">
        <label
          className="text-xs text-primary-500"
          htmlFor="model-context-window"
        >
          Context window
        </label>
        <Input
          id="model-context-window"
          type="number"
          min={0}
          step={1}
          inputMode="numeric"
          value={contextWindow}
          onChange={function handleChange(event) {
            setContextWindow(event.target.value)
          }}
          placeholder="128000"
        />
      </div>

      <div className="flex items-center gap-2">
        <Button size="sm" type="submit" disabled={savePending}>
          Save metadata
        </Button>
        <Button
          size="sm"
          type="button"
          variant="ghost"
          disabled={resetPending}
          onClick={function handleReset() {
            void onReset(model.id)
          }}
        >
          Reset override
        </Button>
      </div>
    </form>
  )
}

export function ModelMetadataPanel() {
  const queryClient = useQueryClient()
  const modelsQuery = useModelsQuery()
  const providersQuery = useProvidersQuery()
  const [query, setQuery] = useState('')
  const [selectedModelId, setSelectedModelId] = useState('')
  const [errorMessage, setErrorMessage] = useState('')

  const models = modelsQuery.data?.models ?? []
  const defaultModelId = modelsQuery.data?.preferences.defaultModelId

  const filteredModels = useMemo(
    function filterModels() {
      const normalizedQuery = query.trim().toLowerCase()
      if (!normalizedQuery) return models
      return models.filter(function matchesModel(model) {
        const haystack = [
          model.id,
          model.name,
          model.description,
          model.providerLabel,
          model.owned_by,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
        return haystack.includes(normalizedQuery)
      })
    },
    [models, query],
  )

  const activeModel =
    filteredModels.find(function matchSelectedModel(model) {
      return model.id === selectedModelId
    }) ||
    models.find(function matchSelectedModel(model) {
      return model.id === selectedModelId
    }) ||
    filteredModels.at(0) ||
    models.at(0)

  const refreshModels = async function refreshModels() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: appQueryKeys.models }),
      queryClient.invalidateQueries({ queryKey: appQueryKeys.preferences }),
    ])
  }

  const updateModelMetadataMutation = useMutation({
    mutationFn: updateModelMetadata,
    onSuccess: async function handleSuccess() {
      setErrorMessage('')
      await refreshModels()
    },
    onError: function handleError(error) {
      setErrorMessage(
        mutationErrorMessage(error, 'Failed to update model metadata.'),
      )
    },
  })

  const syncModelsMutation = useMutation({
    mutationFn: syncModels,
    onSuccess: async function handleSuccess() {
      setErrorMessage('')
      await refreshModels()
    },
    onError: function handleError(error) {
      setErrorMessage(
        mutationErrorMessage(error, 'Failed to sync model catalog.'),
      )
    },
  })

  async function handleSaveModelMetadata(payload: {
    modelId: string
    name: string
    description: string
    contextWindow: number
  }) {
    await updateModelMetadataMutation.mutateAsync({
      modelId: payload.modelId,
      name: payload.name,
      description: payload.description,
      contextWindow: payload.contextWindow,
    })
  }

  async function handleResetModelMetadata(modelId: string) {
    await updateModelMetadataMutation.mutateAsync({
      modelId,
      name: '',
      description: '',
      contextWindow: 0,
    })
  }

  return (
    <div className="space-y-6">
      <div>
        <ModelSettingsPanel />
      </div>

      <div className="space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <h3 className="text-sm text-primary-900">Model metadata</h3>
            <p className="text-pretty text-xs text-primary-500">
              Review and override model names, descriptions, and context window
              values. Catalog sync uses `models.dev` when available.
            </p>
          </div>
          <Button
            size="sm"
            variant="ghost"
            onClick={function handleSync() {
              void syncModelsMutation.mutateAsync()
            }}
            disabled={syncModelsMutation.isPending}
          >
            Sync catalog
          </Button>
        </div>

        <div className="grid gap-4 lg:grid-cols-[minmax(0,320px)_minmax(0,1fr)]">
          <div className="space-y-3 rounded-xl border border-primary-200 bg-surface p-3">
            <Input
              value={query}
              onChange={function handleQueryChange(event) {
                setQuery(event.target.value)
              }}
              placeholder="Search models"
            />

            <div className="max-h-[480px] space-y-2 overflow-y-auto pr-1">
              {modelsQuery.isLoading ? (
                <div className="rounded-lg border border-primary-200 px-3 py-2 text-sm text-primary-500">
                  Loading models...
                </div>
              ) : filteredModels.length === 0 ? (
                <div className="rounded-lg border border-primary-200 px-3 py-2 text-sm text-primary-500">
                  No models match this search.
                </div>
              ) : (
                filteredModels.map(function renderModel(model) {
                  const isActive = model.id === activeModel.id
                  return (
                    <button
                      key={model.id}
                      type="button"
                      onClick={function handleSelectModel() {
                        setSelectedModelId(model.id)
                      }}
                      className={cn(
                        'flex w-full items-start gap-3 rounded-lg border border-primary-200 px-3 py-3 text-left transition-colors hover:border-primary-300 hover:bg-primary-50',
                        isActive && 'border-primary-400 bg-primary-50',
                      )}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-mono text-xs text-primary-800">
                          {model.id}
                        </div>
                        <div className="truncate text-sm text-primary-900">
                          {model.name || model.providerLabel || model.owned_by}
                        </div>
                        <div className="line-clamp-2 text-xs text-primary-500">
                          {model.description || 'No description available.'}
                        </div>
                      </div>
                      <div className="shrink-0 text-right">
                        {defaultModelId === model.id ? (
                          <div className="rounded-full bg-primary-100 px-2 py-0.5 text-[11px] text-primary-700">
                            default
                          </div>
                        ) : null}
                        <div className="mt-1 text-[11px] text-primary-500 tabular-nums">
                          {formatContextWindow(model.contextWindow)}
                        </div>
                      </div>
                    </button>
                  )
                })
              )}
            </div>

            {!providersQuery.data?.preferences.useSystemProviders &&
            (providersQuery.data?.providers ?? []).length === 0 ? (
              <div className="rounded-lg border border-primary-200 bg-primary-50 px-3 py-2 text-xs text-primary-700">
                No providers configured. Add a provider first.
              </div>
            ) : null}
          </div>

          <div className="rounded-xl border border-primary-200 bg-surface p-4">
            {activeModel ? (
              <ModelMetadataEditor
                key={[
                  activeModel.id,
                  activeModel.name,
                  activeModel.description,
                  activeModel.contextWindow,
                ].join(':')}
                model={activeModel}
                onSave={handleSaveModelMetadata}
                onReset={handleResetModelMetadata}
                savePending={updateModelMetadataMutation.isPending}
                resetPending={updateModelMetadataMutation.isPending}
              />
            ) : (
              <div className="text-sm text-primary-500">
                Select a model to edit its metadata.
              </div>
            )}
          </div>
        </div>

        {errorMessage ? (
          <div className="text-sm text-red-600">{errorMessage}</div>
        ) : null}
      </div>
    </div>
  )
}
