import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  ArrowDown01Icon,
  StarIcon,
  Search01Icon,
  RefreshIcon,
} from '@hugeicons/core-free-icons'
import type {
  ModelsPayload,
  ProviderModel,
  ProviderPayload,
  UserPreferences,
} from '@/lib/app-api'
import { appQueryKeys, syncModels, updatePreferences } from '@/lib/app-api'
import { MenuContent, MenuRoot, MenuTrigger } from '@/components/ui/menu'
import { mutationErrorMessage } from '@/lib/error-utils'
import {
  providerModelDisplayName,
  providerModelKey,
  providerModelMetaLine,
  providerModelSearchText,
} from '@/lib/model-utils'
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
  const selectedRef = useRef<HTMLDivElement | null>(null)

  useEffect(
    function scrollSelectedIntoView() {
      if (open) {
        const handle = requestAnimationFrame(function scroll() {
          selectedRef.current?.scrollIntoView({ block: 'nearest' })
        })
        return function cleanup() {
          cancelAnimationFrame(handle)
        }
      }
    },
    [open],
  )

  const selectedModel =
    models.find(function matchModel(model) {
      return (
        providerModelKey(model) === selectedModelId ||
        model.id === selectedModelId
      )
    }) ?? null

  const normalizedDefaultModelId = defaultModelId?.trim()

  const filteredModels = useMemo(
    function filterModels() {
      const normalizedQuery = query.trim().toLowerCase()
      if (!normalizedQuery) return models
      return models.filter(function includeModel(model) {
        return providerModelSearchText(model).includes(normalizedQuery)
      })
    },
    [models, query],
  )

  const sortedGroupedModels = useMemo(
    function groupModels() {
      const groups: Record<string, Array<ProviderModel>> = {}
      for (const model of filteredModels) {
        const provider =
          model.providerLabel?.trim() || model.owned_by?.trim() || 'Other'
        const normalizedProvider =
          provider.charAt(0).toUpperCase() + provider.slice(1)
        if (!groups[normalizedProvider]) {
          groups[normalizedProvider] = []
        }
        groups[normalizedProvider].push(model)
      }

      for (const key of Object.keys(groups)) {
        groups[key].sort(function compareNames(a, b) {
          const nameA = providerModelDisplayName(a).toLowerCase()
          const nameB = providerModelDisplayName(b).toLowerCase()
          return nameA.localeCompare(nameB)
        })
      }

      return Object.entries(groups).sort(function compareGroups(
        [keyA],
        [keyB],
      ) {
        if (keyA === 'Other') return 1
        if (keyB === 'Other') return -1
        return keyA.localeCompare(keyB)
      })
    },
    [filteredModels],
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
          {loading
            ? 'Loading models...'
            : providerModelDisplayName(selectedModel ?? undefined)}
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
        className="w-80 max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl p-0 border border-primary-200/60 shadow-lg bg-surface"
      >
        <div className="border-b border-primary-200/60 bg-primary-50/15 px-3 py-2 flex items-center gap-2">
          <div className="relative flex-1 flex items-center">
            <span className="absolute left-2.5 flex items-center pointer-events-none">
              <HugeiconsIcon
                icon={Search01Icon}
                size={20}
                strokeWidth={1.5}
                className="text-primary-400"
              />
            </span>
            <input
              type="text"
              value={query}
              onChange={function handleChange(
                event: React.ChangeEvent<HTMLInputElement>,
              ) {
                setQuery(event.target.value)
              }}
              onKeyDown={function handleKeyDown(event) {
                event.stopPropagation()
              }}
              placeholder="Search models..."
              className="w-full h-8 pl-8 pr-3 text-xs bg-primary-100/30 border border-primary-200 rounded-lg outline-none placeholder:text-primary-400/80 focus:border-primary-500/80 focus:bg-surface focus:ring-2 focus:ring-primary-500/20 transition-all text-primary-900"
            />
          </div>
          <button
            type="button"
            disabled={syncModelsMutation.isPending}
            onClick={function handleClick(event) {
              event.preventDefault()
              event.stopPropagation()
              handleRefreshModels()
            }}
            className={cn(
              'flex size-8 shrink-0 items-center justify-center rounded-lg border border-primary-200 bg-primary-100/10 text-primary-600 hover:bg-primary-100 hover:text-primary-900 transition-colors',
              syncModelsMutation.isPending && 'opacity-60 pointer-events-none',
            )}
            aria-label="Sync models"
            title="Sync models"
          >
            <HugeiconsIcon
              icon={RefreshIcon}
              size={20}
              strokeWidth={1.5}
              className={cn(syncModelsMutation.isPending && 'animate-spin')}
            />
          </button>
        </div>

        <div className="max-h-64 overflow-y-auto p-1.5 space-y-2">
          {(defaultErrorMessage || syncErrorMessage) && (
            <div className="px-2.5 py-1.5 text-xs text-red-600 bg-red-500/10 rounded-lg border border-red-200/20">
              {defaultErrorMessage || syncErrorMessage}
            </div>
          )}
          {sortedGroupedModels.length === 0 ? (
            <div className="rounded-lg border border-primary-100 bg-surface px-3 py-5 text-center text-xs text-primary-500">
              {loading ? 'Loading models...' : 'No models match this search.'}
            </div>
          ) : (
            sortedGroupedModels.map(function renderGroup([
              provider,
              providerModels,
            ]) {
              return (
                <div key={provider} className="space-y-0.5">
                  <div className="px-2.5 py-1 text-[10px] font-medium tracking-wider text-primary-400 uppercase select-none">
                    {provider}
                  </div>
                  {providerModels.map(function renderModel(model) {
                    const modelKey = providerModelKey(model)
                    const isSelected =
                      !!selectedModel &&
                      modelKey === providerModelKey(selectedModel)
                    const isDefault =
                      !!normalizedDefaultModelId &&
                      modelKey === normalizedDefaultModelId

                    return (
                      <div
                        key={modelKey}
                        ref={isSelected ? selectedRef : undefined}
                        className={cn(
                          'group/model-row flex items-center justify-between gap-2.5 rounded-lg px-2.5 py-1.5 text-left transition-all duration-150 cursor-pointer hover:bg-primary-100/70',
                          isSelected && 'bg-primary-100 text-primary-950',
                        )}
                        onClick={function handleClick() {
                          handleSelectModel(modelKey)
                        }}
                      >
                        <div className="min-w-0 flex-1 px-1">
                          <div className="flex items-center gap-1.5">
                            <div className="truncate text-xs font-medium text-primary-900">
                              {providerModelDisplayName(model)}
                            </div>
                          </div>
                          <div className="truncate text-[10px] text-primary-500 tabular-nums">
                            {providerModelMetaLine(model)}
                          </div>
                        </div>

                        <div className="shrink-0">
                          {isDefault ? (
                            <HugeiconsIcon
                              icon={StarIcon}
                              size={20}
                              strokeWidth={1.5}
                              className="text-primary-600 fill-primary-600/20"
                            />
                          ) : !defaultModelLocked ? (
                            <button
                              type="button"
                              disabled={updatePreferencesMutation.isPending}
                              onClick={function handleClick(event) {
                                event.preventDefault()
                                event.stopPropagation()
                                handleMakeDefault(modelKey)
                              }}
                              className="opacity-0 group-hover/model-row:opacity-100 rounded-md p-1 text-primary-400 hover:bg-primary-200 hover:text-primary-600 transition-all duration-150"
                              aria-label={`Make ${providerModelDisplayName(model)} default`}
                              title="Make default"
                            >
                              <HugeiconsIcon
                                icon={StarIcon}
                                size={20}
                                strokeWidth={1.5}
                              />
                            </button>
                          ) : null}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )
            })
          )}
        </div>
      </MenuContent>
    </MenuRoot>
  )
}
