import { HugeiconsIcon } from '@hugeicons/react'
import {
  Cancel01Icon,
  Loading03Icon,
  Search01Icon,
  Download01Icon,
  ArrowLeft01Icon,
} from '@hugeicons/core-free-icons'
import { AnimatePresence, motion } from 'motion/react'
import { useMutation } from '@tanstack/react-query'
import {
  createCustomModel,
  deleteCustomModel,
  syncModels,
  updateModelMetadata,
  useCapabilitiesQuery,
  useModelsQuery,
  useProvidersQuery,
} from '@/lib/app-api'
import { Button } from '@/components/ui/button'
import { TitleSettingsPopover } from './title-settings-popover'
import { ProvidersDialog } from './providers-dialog'
import { ModelMetadataEditor } from './model-metadata-editor'
import { CustomModelDialog } from './custom-model-dialog'
import { ProviderFilterPills } from './provider-filter-pills'
import { ModelItemCard } from './model-item-card'
import { useModelFilter } from '../hooks/use-model-filter'
import { mutationErrorMessage } from '@/lib/error-utils'
import { useProviderEditor } from '@/features/settings/providers/use-provider-editor'
import { providerModelKey } from '@/lib/model-utils'
import { cn } from '@/lib/utils'

export function ModelsProvidersPanel() {
  const capabilitiesQuery = useCapabilitiesQuery()
  const providersQuery = useProvidersQuery()
  const modelsQuery = useModelsQuery()

  const providers = providersQuery.data?.providers ?? []
  const preferences = providersQuery.data?.preferences
  const capabilities = capabilitiesQuery.data?.providers

  const models = modelsQuery.data?.models ?? []
  const modelPreferences = modelsQuery.data?.preferences
  const defaultModelId = modelPreferences?.defaultModelId
  const titleGenerationModelId = modelPreferences?.titleGenerationModelId

  const {
    createProviderMutation,
    deleteProviderMutation,
    draft,
    editorState,
    errorMessage,
    handleCreateProvider,
    handleSaveProvider,
    openAddEditor,
    openEditEditor,
    refreshProviderQueries: refreshQueries,
    resetEditorState,
    saveProviderMutation,
    setErrorMessage,
    toggleProviderMutation,
    updateDraft,
    updatePreferencesMutation,
  } = useProviderEditor({ canSyncModels: capabilities?.canSyncModels ?? true })

  const {
    modelSearchQuery,
    setModelSearchQuery,
    selectedModelId,
    setSelectedModelId,
    selectedProviderFilter,
    setSelectedProviderFilter,
    filteredModels,
    activeModel,
  } = useModelFilter({ models, providers })

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

  const addCustomModelMutation = useMutation({
    mutationFn: createCustomModel,
    onSuccess: async function handleSuccess() {
      setErrorMessage('')
      await refreshQueries()
    },
    onError: function handleError(error) {
      setErrorMessage(
        mutationErrorMessage(error, 'Failed to add custom model.'),
      )
    },
  })

  const deleteCustomModelMutation = useMutation({
    mutationFn: function mutate({
      providerRef,
      modelId,
    }: {
      providerRef: string
      modelId: string
    }) {
      return deleteCustomModel(providerRef, modelId)
    },
    onSuccess: async function handleSuccess() {
      setErrorMessage('')
      setSelectedModelId('')
      await refreshQueries()
    },
    onError: function handleError(error) {
      setErrorMessage(
        mutationErrorMessage(error, 'Failed to delete custom model.'),
      )
    },
  })

  function resolveInitialTitleModelId() {
    const normalizedConfiguredId = titleGenerationModelId?.trim()
    if (normalizedConfiguredId) {
      return normalizedConfiguredId
    }

    const normalizedDefaultModelId = defaultModelId?.trim()
    if (normalizedDefaultModelId) {
      return normalizedDefaultModelId
    }

    return models[0] ? providerModelKey(models[0]) : ''
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
            handleSaveProvider={handleSaveProvider}
            handleCreateProvider={handleCreateProvider}
          />

          {/* Add Custom Model Dialog */}
          <CustomModelDialog
            providers={providers}
            onAdd={async function handleAdd(payload) {
              await addCustomModelMutation.mutateAsync(payload)
            }}
            addPending={addCustomModelMutation.isPending}
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

      {errorMessage && (
        <div className="rounded-xl border border-primary-200 bg-primary-50/50 p-4 text-xs text-primary-750 flex items-center justify-between gap-3 mt-4 text-pretty">
          <span>{errorMessage}</span>
          <button
            type="button"
            onClick={function handleClear() {
              setErrorMessage('')
            }}
            className="text-primary-600 hover:text-primary-850 font-medium whitespace-nowrap"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Provider Filter Pills */}
      <ProviderFilterPills
        models={models}
        providers={providers}
        systemProvidersEnabled={capabilities?.systemProvidersEnabled}
        selectedProviderFilter={selectedProviderFilter}
        onSelectProviderFilter={setSelectedProviderFilter}
      />

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
                const modelKey = providerModelKey(model)
                const isActive = modelKey === selectedModelId

                return (
                  <ModelItemCard
                    key={modelKey}
                    model={model}
                    defaultModelId={defaultModelId}
                    isActive={isActive}
                    onToggle={function handleToggle() {
                      setSelectedModelId(isActive ? '' : modelKey)
                    }}
                  />
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
                      {defaultModelId === providerModelKey(activeModel) && (
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
                    onDelete={async function handleDelete(
                      providerRef,
                      modelId,
                    ) {
                      await deleteCustomModelMutation.mutateAsync({
                        providerRef,
                        modelId,
                      })
                    }}
                    savePending={updateModelMetadataMutation.isPending}
                    resetPending={updateModelMetadataMutation.isPending}
                    deletePending={deleteCustomModelMutation.isPending}
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
