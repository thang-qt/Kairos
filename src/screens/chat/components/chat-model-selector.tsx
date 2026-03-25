import { useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  ArrowDown01Icon,
  StarIcon,
} from '@hugeicons/core-free-icons'
import type {
  ModelsPayload,
  ProviderModel,
  ProviderPayload,
  UserPreferences,
} from '@/lib/app-api'
import {
  ApiError,
  appQueryKeys,
  syncModels,
  updatePreferences,
} from '@/lib/app-api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { MenuContent, MenuRoot, MenuTrigger } from '@/components/ui/menu'
import { cn } from '@/lib/utils'

type ChatModelSelectorProps = {
  models: Array<ProviderModel>
  selectedModelId: string
  defaultModelId?: string
  loading?: boolean
  canSelectModel?: boolean
  defaultModelLocked?: boolean
  onSelectModel: (modelId: string) => void
  className?: string
  side?: 'top' | 'bottom' | 'left' | 'right'
  align?: 'start' | 'center' | 'end'
}

function mutationErrorMessage(error: unknown, fallback: string) {
  if (error instanceof ApiError) {
    return error.message
  }
  if (error instanceof Error) {
    return error.message
  }
  return fallback
}

function updatePayloadPreferences<T extends { preferences: UserPreferences }>(
  current: T | undefined,
  preferences: UserPreferences,
) {
  if (!current) return current
  return {
    ...current,
    preferences,
  }
}

function modelDisplayName(model?: ProviderModel) {
  if (!model) return 'Select a model'
  const normalizedName = model.name?.trim()
  return normalizedName || model.id
}

function modelSecondaryLabel(model?: ProviderModel) {
  if (!model) return 'No model selected'
  return model.providerLabel || model.owned_by || model.id
}

function modelMetaLine(model: ProviderModel) {
  if (model.providerLabel && model.providerLabel !== model.id) {
    return `${model.providerLabel} · ${model.id}`
  }
  if (model.owned_by && model.owned_by !== model.id) {
    return `${model.owned_by} · ${model.id}`
  }
  return model.id
}

function modelSearchText(model: ProviderModel) {
  return [
    model.id,
    model.name,
    model.description,
    model.providerLabel,
    model.owned_by,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
}

export function ChatModelSelector({
  models,
  selectedModelId,
  defaultModelId,
  loading = false,
  canSelectModel = true,
  defaultModelLocked = false,
  onSelectModel,
  className,
  side = 'bottom',
  align = 'start',
}: ChatModelSelectorProps) {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [defaultErrorMessage, setDefaultErrorMessage] = useState('')
  const [syncErrorMessage, setSyncErrorMessage] = useState('')

  const selectedModel =
    models.find(function matchModel(model) {
      return model.id === selectedModelId
    }) ?? null

  const normalizedDefaultModelId = defaultModelId?.trim()
  const isSelectedModelDefault =
    !!selectedModel &&
    !!normalizedDefaultModelId &&
    selectedModel.id === normalizedDefaultModelId

  const filteredModels = useMemo(
    function filterModels() {
      const normalizedQuery = query.trim().toLowerCase()
      if (!normalizedQuery) return models
      return models.filter(function includeModel(model) {
        return modelSearchText(model).includes(normalizedQuery)
      })
    },
    [models, query],
  )

  const updatePreferencesMutation = useMutation({
    mutationFn: updatePreferences,
    onSuccess: async function handleSuccess(preferences) {
      setDefaultErrorMessage('')
      setSyncErrorMessage('')
      queryClient.setQueryData(appQueryKeys.preferences, preferences)
      queryClient.setQueryData(
        appQueryKeys.models,
        function updateModels(current: ModelsPayload | undefined) {
          return updatePayloadPreferences(current, preferences)
        },
      )
      queryClient.setQueryData(
        appQueryKeys.providers,
        function updateProviders(current: ProviderPayload | undefined) {
          return updatePayloadPreferences(current, preferences)
        },
      )
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: appQueryKeys.preferences }),
        queryClient.invalidateQueries({ queryKey: appQueryKeys.models }),
        queryClient.invalidateQueries({ queryKey: appQueryKeys.providers }),
      ])
    },
    onError: function handleError(error) {
      setDefaultErrorMessage(
        mutationErrorMessage(error, 'Failed to update default model.'),
      )
    },
  })

  const syncModelsMutation = useMutation({
    mutationFn: syncModels,
    onSuccess: function handleSuccess(payload) {
      setSyncErrorMessage('')
      queryClient.setQueryData(appQueryKeys.models, payload)
      queryClient.setQueryData(appQueryKeys.preferences, payload.preferences)
    },
    onError: function handleError(error) {
      setSyncErrorMessage(
        mutationErrorMessage(error, 'Failed to refresh models.'),
      )
    },
  })

  function handleOpenChange(nextOpen: boolean) {
    setOpen(nextOpen)
    if (!nextOpen) {
      setQuery('')
      setDefaultErrorMessage('')
      setSyncErrorMessage('')
    }
  }

  function handleSelectModel(modelId: string) {
    onSelectModel(modelId)
    setDefaultErrorMessage('')
    setOpen(false)
    setQuery('')
  }

  function handleMakeDefault(modelId: string) {
    setDefaultErrorMessage('')
    void updatePreferencesMutation.mutateAsync({
      defaultModelId: modelId,
    })
  }

  function handleRefreshModels() {
    setSyncErrorMessage('')
    void syncModelsMutation.mutateAsync()
  }

  const triggerDisabled = loading || !canSelectModel || models.length === 0

  return (
    <MenuRoot open={open} onOpenChange={handleOpenChange}>
      <MenuTrigger
        type="button"
        disabled={triggerDisabled}
        className={cn(
          'inline-flex min-w-0 items-center gap-1 rounded-md border border-transparent bg-transparent px-1.5 py-1 text-left text-primary-700 transition-colors hover:bg-primary-100 hover:text-primary-900 disabled:opacity-60',
          className,
        )}
      >
        <span className="truncate text-sm">
          {loading ? 'Loading models...' : modelDisplayName(selectedModel)}
        </span>
        <HugeiconsIcon
          icon={ArrowDown01Icon}
          size={20}
          strokeWidth={1.5}
          className="shrink-0 text-primary-600"
        />
      </MenuTrigger>

      <MenuContent
        side={side}
        align={align}
        className="w-88 max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl p-0"
      >
        <div className="border-b border-primary-200 px-3 py-3">
          <div>
            <Input
              nativeInput
              value={query}
              onChange={function handleChange(
                event: React.ChangeEvent<HTMLInputElement>,
              ) {
                setQuery(event.target.value)
              }}
              onKeyDown={function handleKeyDown(event) {
                event.stopPropagation()
              }}
              placeholder="Search a model"
            />
          </div>
        </div>

        <div className="max-h-80 overflow-y-auto px-2 py-2">
          {filteredModels.length === 0 ? (
            <div className="rounded-lg border border-primary-200 bg-surface px-3 py-6 text-center text-sm text-primary-500">
              {loading ? 'Loading models...' : 'No models match this search.'}
            </div>
          ) : (
            <div className="space-y-1">
              {filteredModels.map(function renderModel(model) {
                const isSelected = model.id === selectedModel?.id
                const isDefault =
                  !!normalizedDefaultModelId &&
                  model.id === normalizedDefaultModelId

                return (
                  <div
                    key={model.id}
                    className={cn(
                      'flex w-full items-start justify-between gap-3 rounded-lg px-3 py-2 text-left transition-colors hover:bg-primary-100',
                      isSelected && 'bg-primary-100 text-primary-950',
                    )}
                  >
                    <button
                      type="button"
                      onClick={function handleClick() {
                        handleSelectModel(model.id)
                      }}
                      className="min-w-0 flex-1 text-left"
                    >
                      <div className="flex min-w-0 items-center gap-2">
                        <div className="truncate text-sm text-primary-900">
                          {modelDisplayName(model)}
                        </div>
                        {isSelected ? (
                          <span className="shrink-0 text-[11px] text-primary-700">
                            Current
                          </span>
                        ) : null}
                        {isDefault ? (
                          <span className="shrink-0 text-[11px] text-primary-500">
                            Default
                          </span>
                        ) : null}
                      </div>
                      <div className="truncate text-xs text-primary-500 tabular-nums">
                        {modelMetaLine(model)}
                      </div>
                      {model.description ? (
                        <div className="line-clamp-1 text-xs text-primary-500">
                          {model.description}
                        </div>
                      ) : null}
                    </button>
                    <div className="shrink-0">
                      {isDefault ? (
                        <span className="text-[11px] text-primary-500">
                          Default
                        </span>
                      ) : !defaultModelLocked ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={updatePreferencesMutation.isPending}
                          onClick={function handleClick(event) {
                            event.preventDefault()
                            event.stopPropagation()
                            handleMakeDefault(model.id)
                          }}
                          className="rounded-md px-2 text-primary-500 hover:text-primary-900"
                          aria-label={`Make ${modelDisplayName(model)} default`}
                          title="Make default"
                        >
                          <HugeiconsIcon
                            icon={StarIcon}
                            size={20}
                            strokeWidth={1.5}
                          />
                        </Button>
                      ) : null}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        <div className="border-t border-primary-200 px-3 py-2.5">
          {defaultErrorMessage ? (
            <div className="mb-2 text-xs text-red-600">
              {defaultErrorMessage}
            </div>
          ) : syncErrorMessage ? (
            <div className="mb-2 text-xs text-red-600">{syncErrorMessage}</div>
          ) : null}
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0 text-xs text-primary-500">
              {defaultModelLocked
                ? 'Default model is locked by server policy.'
                : isSelectedModelDefault
                  ? 'Used by default for new chats.'
                  : 'Selection applies to this chat only.'}
            </div>
            <div className="flex items-center gap-1.5">
              <Button
                size="sm"
                variant="ghost"
                disabled={syncModelsMutation.isPending}
                onClick={function handleClick(event) {
                  event.preventDefault()
                  event.stopPropagation()
                  handleRefreshModels()
                }}
                className="shrink-0 rounded-md px-2.5"
              >
                {syncModelsMutation.isPending ? 'Refreshing...' : 'Refresh'}
              </Button>
              {selectedModel &&
              !isSelectedModelDefault &&
              !defaultModelLocked ? (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={updatePreferencesMutation.isPending}
                  onClick={function handleClick(event) {
                    event.preventDefault()
                    event.stopPropagation()
                    handleMakeDefault(selectedModel.id)
                  }}
                  className="shrink-0 rounded-md px-2.5"
                >
                  {updatePreferencesMutation.isPending
                    ? 'Saving...'
                    : 'Make Default'}
                </Button>
              ) : null}
            </div>
          </div>
        </div>
      </MenuContent>
    </MenuRoot>
  )
}
