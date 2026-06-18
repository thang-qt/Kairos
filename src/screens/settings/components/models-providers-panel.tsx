import { useMemo, useState } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  Cancel01Icon,
  Loading03Icon,
  Search01Icon,
  Download01Icon,
  ArrowLeft01Icon,
} from '@hugeicons/core-free-icons'
import { AnimatePresence, motion } from 'motion/react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  appQueryKeys,
  createProvider,
  deleteProvider,
  syncModels,
  testConnection,
  updateModelMetadata,
  updatePreferences,
  updateProvider,
  useCapabilitiesQuery,
  useModelsQuery,
  useProvidersQuery,
} from '@/lib/app-api'
import type { UpdateProviderPayload } from '@/lib/app-api'
import { Button } from '@/components/ui/button'
import { TitleSettingsPopover } from './title-settings-popover'
import { ProvidersDialog } from './providers-dialog'
import { ModelMetadataEditor } from './model-metadata-editor'
import { mutationErrorMessage } from '@/lib/error-utils'
import { formatContextWindow } from '@/lib/model-utils'
import { cn } from '@/lib/utils'

type ProviderEditorState =
  | {
      mode: 'add'
    }
  | {
      mode: 'edit'
      providerId: string
    }

type ProviderDraftState = {
  label: string
  baseURL: string
  apiKey: string
}

function createEmptyProviderDraft(): ProviderDraftState {
  return {
    label: '',
    baseURL: '',
    apiKey: '',
  }
}

export function ModelsProvidersPanel() {
  const queryClient = useQueryClient()
  const capabilitiesQuery = useCapabilitiesQuery()
  const providersQuery = useProvidersQuery()
  const modelsQuery = useModelsQuery()

  const [modelSearchQuery, setModelSearchQuery] = useState('')
  const [selectedModelId, setSelectedModelId] = useState('')
  const [selectedProviderFilter, setSelectedProviderFilter] = useState<
    'all' | 'system' | string
  >('all')
  const [errorMessage, setErrorMessage] = useState('')

  const [editorState, setEditorState] = useState<ProviderEditorState | null>(
    null,
  )
  const [draft, setDraft] = useState<ProviderDraftState>(
    createEmptyProviderDraft(),
  )
  const [testingConnection, setTestingConnection] = useState(false)
  const [testResult, setTestResult] = useState<{
    success: boolean
    message: string
  } | null>(null)

  const providers = providersQuery.data?.providers ?? []
  const preferences = providersQuery.data?.preferences
  const capabilities = capabilitiesQuery.data?.providers

  const models = modelsQuery.data?.models ?? []
  const modelPreferences = modelsQuery.data?.preferences
  const defaultModelId = modelPreferences?.defaultModelId
  const titleGenerationModelId = modelPreferences?.titleGenerationModelId

  const refreshQueries = async function refreshQueries() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: appQueryKeys.providers }),
      queryClient.invalidateQueries({ queryKey: appQueryKeys.models }),
      queryClient.invalidateQueries({ queryKey: appQueryKeys.preferences }),
    ])
  }

  const filteredModels = useMemo(
    function filterModels() {
      let list = models

      // Apply provider filter
      if (selectedProviderFilter === 'system') {
        const systemProviderLabels = new Set(
          providers
            .filter(function isSys(p) {
              return p.systemManaged
            })
            .map(function getLabel(p) {
              return p.label
            }),
        )
        list = list.filter(function matchSys(m) {
          return m.providerLabel && systemProviderLabels.has(m.providerLabel)
        })
      } else if (selectedProviderFilter !== 'all') {
        const targetProvider = providers.find(function matchTarget(p) {
          return (
            p.id === selectedProviderFilter ||
            p.label === selectedProviderFilter
          )
        })
        if (targetProvider) {
          list = list.filter(function matchProv(m) {
            return (
              m.providerLabel === targetProvider.label ||
              m.owned_by === targetProvider.label
            )
          })
        }
      }

      // Apply search query
      const normalizedQuery = modelSearchQuery.trim().toLowerCase()
      if (!normalizedQuery) return list
      return list.filter(function matchesModel(model) {
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
    [models, selectedProviderFilter, modelSearchQuery, providers],
  )

  const activeModel = useMemo(
    function getActiveModel() {
      return (
        models.find(function matchModel(m) {
          return m.id === selectedModelId
        }) || null
      )
    },
    [models, selectedModelId],
  )

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
      await refreshQueries()
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
    onSuccess: refreshQueries,
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
      await refreshQueries()
    },
    onError: function handleError(error) {
      setErrorMessage(mutationErrorMessage(error, 'Failed to save provider.'))
    },
  })

  const deleteProviderMutation = useMutation({
    mutationFn: deleteProvider,
    onSuccess: refreshQueries,
    onError: function handleError(error) {
      setErrorMessage(mutationErrorMessage(error, 'Failed to delete provider.'))
    },
  })

  const updatePreferencesMutation = useMutation({
    mutationFn: updatePreferences,
    onSuccess: refreshQueries,
    onError: function handleError(error) {
      setErrorMessage(
        mutationErrorMessage(error, 'Failed to update preferences.'),
      )
    },
  })

  const updateModelMetadataMutation = useMutation({
    mutationFn: updateModelMetadata,
    onSuccess: async function handleSuccess() {
      setErrorMessage('')
      await refreshQueries()
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
      await refreshQueries()
    },
    onError: function handleError(error) {
      setErrorMessage(
        mutationErrorMessage(error, 'Failed to sync model catalog.'),
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
      supportsModelSync: capabilities?.canSyncModels ?? true,
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

  function resolveInitialTitleModelId() {
    const normalizedConfiguredId = titleGenerationModelId?.trim()
    if (normalizedConfiguredId) {
      return normalizedConfiguredId
    }

    const normalizedDefaultModelId = defaultModelId?.trim()
    if (normalizedDefaultModelId) {
      return normalizedDefaultModelId
    }

    return models[0]?.id ?? ''
  }

  function handleAutoGenerateTitleChange(checked: boolean) {
    void updatePreferencesMutation.mutateAsync({
      autoGenerateTitle: checked,
    })
  }

  function handleUseSeparateTitleModelChange(checked: boolean) {
    void updatePreferencesMutation.mutateAsync({
      useSeparateTitleModel: checked,
      titleGenerationModelId: checked
        ? resolveInitialTitleModelId()
        : titleGenerationModelId,
    })
  }

  function handleTitleGenerationModelChange(modelId: string) {
    void updatePreferencesMutation.mutateAsync({
      titleGenerationModelId: modelId,
    })
  }

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
      {/* Top Toolbar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b border-primary-200/60 pb-4">
        {/* Search */}
        <div className="relative flex-1 max-w-md">
          <span className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none">
            <HugeiconsIcon
              icon={Search01Icon}
              size={20}
              strokeWidth={1.5}
              className="text-primary-400"
            />
          </span>
          <input
            type="text"
            value={modelSearchQuery}
            onChange={function handleQueryChange(event) {
              setModelSearchQuery(event.target.value)
            }}
            placeholder="Search models in your catalog..."
            className="w-full pl-10 pr-4 py-2 border border-primary-200 rounded-xl bg-surface text-sm text-primary-955 placeholder-primary-450 focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-400/20 transition-all"
          />
        </div>

        {/* Toolbar Settings Popovers & Dialogs */}
        <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap">
          {/* Title Generator Settings Popover */}
          <TitleSettingsPopover
            preferences={preferences}
            models={models}
            titleGenerationModelId={titleGenerationModelId}
            modelsQuery={modelsQuery}
            updatePreferencesMutation={updatePreferencesMutation}
            handleAutoGenerateTitleChange={handleAutoGenerateTitleChange}
            handleUseSeparateTitleModelChange={
              handleUseSeparateTitleModelChange
            }
            handleTitleGenerationModelChange={handleTitleGenerationModelChange}
          />

          {/* Connection Settings Dialog */}
          <ProvidersDialog
            providers={providers}
            capabilities={capabilities}
            preferences={preferences}
            editorState={editorState}
            draft={draft}
            testingConnection={testingConnection}
            testResult={testResult}
            errorMessage={errorMessage}
            updatePreferencesMutation={updatePreferencesMutation}
            toggleProviderMutation={toggleProviderMutation}
            deleteProviderMutation={deleteProviderMutation}
            saveProviderMutation={saveProviderMutation}
            createProviderMutation={createProviderMutation}
            openEditEditor={openEditEditor}
            openAddEditor={openAddEditor}
            resetEditorState={resetEditorState}
            updateDraft={updateDraft}
            handleTestConnection={handleTestConnection}
            handleSaveProvider={handleSaveProvider}
            handleCreateProvider={handleCreateProvider}
          />

          {/* Sync catalog button */}
          <Button
            size="sm"
            variant="outline"
            onClick={function handleSync() {
              void syncModelsMutation.mutateAsync()
            }}
            disabled={syncModelsMutation.isPending}
            className="h-9 gap-2 bg-surface hover:bg-primary-50 hover:text-primary-950 border-primary-200"
          >
            <HugeiconsIcon
              icon={
                syncModelsMutation.isPending ? Loading03Icon : Download01Icon
              }
              size={20}
              strokeWidth={1.5}
              className={cn(syncModelsMutation.isPending && 'animate-spin')}
            />
            <span className="hidden sm:inline">
              {syncModelsMutation.isPending ? 'Syncing...' : 'Sync Catalog'}
            </span>
            <span className="sm:hidden">
              {syncModelsMutation.isPending ? 'Syncing...' : 'Sync'}
            </span>
          </Button>
        </div>
      </div>

      {/* Provider Filter Pills */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1 mt-3 scrollbar-none">
        <button
          type="button"
          onClick={function handleSelectAll() {
            setSelectedProviderFilter('all')
          }}
          className={cn(
            'rounded-full px-3 py-1 text-xs font-medium border transition-colors whitespace-nowrap',
            selectedProviderFilter === 'all'
              ? 'bg-primary-900 border-primary-900 text-primary-50 font-normal'
              : 'bg-surface border-primary-200 text-primary-650 hover:bg-primary-50 hover:text-primary-900',
          )}
        >
          All Models ({models.length})
        </button>

        {capabilities?.systemProvidersEnabled && (
          <button
            type="button"
            onClick={function handleSelectSystem() {
              setSelectedProviderFilter('system')
            }}
            className={cn(
              'rounded-full px-3 py-1 text-xs font-medium border transition-colors whitespace-nowrap',
              selectedProviderFilter === 'system'
                ? 'bg-primary-900 border-primary-900 text-primary-50 font-normal'
                : 'bg-surface border-primary-200 text-primary-650 hover:bg-primary-50 hover:text-primary-900',
            )}
          >
            System Models
          </button>
        )}

        {providers.map(function renderProviderPill(provider) {
          const modelCount = models.filter(function matchCount(m) {
            return (
              m.providerLabel === provider.label ||
              m.owned_by === provider.label
            )
          }).length

          if (modelCount === 0 && !provider.enabled) return null

          return (
            <button
              key={provider.id}
              type="button"
              onClick={function handleSelectProvider() {
                setSelectedProviderFilter(provider.id)
              }}
              className={cn(
                'rounded-full px-3 py-1 text-xs font-medium border transition-colors whitespace-nowrap',
                selectedProviderFilter === provider.id
                  ? 'bg-primary-900 border-primary-900 text-primary-50 font-normal'
                  : 'bg-surface border-primary-200 text-primary-650 hover:bg-primary-50 hover:text-primary-900',
              )}
            >
              {provider.label}{' '}
              <span className="text-[10px] opacity-70 tabular-nums">
                ({modelCount})
              </span>
            </button>
          )
        })}
      </div>

      {/* Models List and Details Sidepane Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 mt-6 items-start">
        {/* Model Cards List */}
        <div
          className={cn(
            'space-y-3 transition-all duration-200',
            selectedModelId
              ? 'hidden lg:block lg:col-span-7'
              : 'block lg:col-span-12',
          )}
        >
          {modelsQuery.isLoading ? (
            <div className="rounded-xl border border-primary-200 bg-surface/50 p-12 text-center text-sm text-primary-500">
              Loading synced models...
            </div>
          ) : filteredModels.length === 0 ? (
            <div className="rounded-xl border border-primary-200 bg-surface/50 p-12 text-center text-sm text-primary-500">
              No models found. Adjust your search or configure connection
              settings.
            </div>
          ) : (
            <div
              className={cn(
                'grid gap-4',
                selectedModelId ? 'grid-cols-1' : 'grid-cols-1 md:grid-cols-2',
              )}
            >
              {filteredModels.map(function renderModelCard(model) {
                const isActive = model.id === selectedModelId

                return (
                  <div
                    key={model.id}
                    className={cn(
                      'rounded-xl border border-primary-200 bg-surface overflow-hidden transition-all duration-200 self-start',
                      isActive &&
                        'ring-1 ring-primary-400 border-primary-400 bg-primary-50/10',
                    )}
                  >
                    {/* Expand trigger header */}
                    <button
                      type="button"
                      onClick={function handleToggle() {
                        setSelectedModelId(isActive ? '' : model.id)
                      }}
                      className="flex w-full items-start justify-between gap-3 p-4 text-left hover:bg-primary-50/40"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="truncate font-mono text-[10px] text-primary-600 bg-primary-100 px-1.5 py-0.5 rounded">
                            {model.id}
                          </span>
                          {defaultModelId === model.id && (
                            <span className="rounded-full bg-primary-200 px-2 py-0.5 text-[9px] font-medium tracking-tight text-primary-900 uppercase">
                              Default
                            </span>
                          )}
                        </div>
                        <h4 className="truncate text-sm font-medium text-primary-955 mt-2 tracking-tight">
                          {model.name || model.providerLabel || model.owned_by}
                        </h4>
                        {!isActive && model.description && (
                          <p className="line-clamp-1 text-xs text-primary-500 mt-1 text-pretty">
                            {model.description}
                          </p>
                        )}
                      </div>

                      <div className="shrink-0 text-right flex flex-col items-end gap-1.5">
                        <span className="text-[10px] font-medium text-primary-700 bg-primary-100 px-2 py-0.5 rounded tabular-nums">
                          {formatContextWindow(model.contextWindow)} ctx
                        </span>
                        <span className="text-[10px] text-primary-450 block truncate max-w-[120px]">
                          {model.providerLabel || model.owned_by}
                        </span>
                      </div>
                    </button>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Sticky Detail Sidepane */}
        <AnimatePresence>
          {selectedModelId && activeModel && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 10 }}
              transition={{ duration: 0.15 }}
              className="fixed inset-x-4 bottom-4 top-20 z-30 overflow-y-auto md:inset-x-8 lg:static lg:bottom-auto lg:top-auto lg:z-auto lg:inset-x-auto lg:overflow-visible lg:col-span-5 lg:sticky lg:top-20"
            >
              <div className="rounded-xl border border-primary-200 bg-surface p-5 space-y-4 shadow-xl lg:shadow-none">
                {/* Back button on mobile */}
                <div className="lg:hidden">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={function handleBack() {
                      setSelectedModelId('')
                    }}
                    className="flex items-center gap-1.5 text-primary-650 hover:text-primary-850 hover:bg-primary-50 px-2 h-8 -ml-2"
                  >
                    <HugeiconsIcon
                      icon={ArrowLeft01Icon}
                      size={20}
                      strokeWidth={1.5}
                    />
                    <span>Back to models</span>
                  </Button>
                </div>

                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-xs text-primary-600 bg-primary-100 px-1.5 py-0.5 rounded">
                        {activeModel.id}
                      </span>
                      {defaultModelId === activeModel.id && (
                        <span className="rounded-full bg-primary-200 px-2 py-0.5 text-[9px] font-medium tracking-tight text-primary-900 uppercase">
                          Default
                        </span>
                      )}
                    </div>
                    <h4 className="text-base font-medium text-primary-950 mt-2 tracking-tight text-balance">
                      {activeModel.name ||
                        activeModel.providerLabel ||
                        activeModel.owned_by}
                    </h4>
                    <div className="text-[11px] text-primary-500 mt-1">
                      Provider:{' '}
                      {activeModel.providerLabel ||
                        activeModel.owned_by ||
                        'Unknown'}
                    </div>
                  </div>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    onClick={function handleClosePane() {
                      setSelectedModelId('')
                    }}
                    className="text-primary-500 hover:bg-primary-100 h-8 w-8 shrink-0"
                  >
                    <HugeiconsIcon
                      icon={Cancel01Icon}
                      size={20}
                      strokeWidth={1.5}
                    />
                  </Button>
                </div>

                <div className="border-t border-primary-100 pt-4">
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
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {!providersQuery.data?.preferences.useSystemProviders &&
      (providersQuery.data?.providers ?? []).length === 0 ? (
        <div className="rounded-xl border border-primary-200 bg-primary-50/50 p-4 text-xs text-primary-700 mt-4 text-pretty">
          No provider connections are active. Click{' '}
          <strong>Connection Settings</strong> above to toggle default models or
          add custom keys.
        </div>
      ) : null}
    </div>
  )
}
