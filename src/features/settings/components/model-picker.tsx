import { useMemo, useState } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import { ArrowDown01Icon, Tick02Icon } from '@hugeicons/core-free-icons'
import type { ProviderModel } from '@/lib/app-api'
import { Input } from '@/components/ui/input'
import {
  MenuContent,
  MenuItem,
  MenuRoot,
  MenuTrigger,
} from '@/components/ui/menu'
import {
  providerModelDisplayName,
  providerModelKey,
  providerModelSearchText,
} from '@/lib/model-utils'

type ModelPickerProps = {
  label: string
  models: Array<ProviderModel>
  selectedModelId?: string
  disabled?: boolean
  loading?: boolean
  onSelectModel: (modelId: string) => void
}

// Searchable model menu used by settings rows.
export function ModelPicker({
  label,
  models,
  selectedModelId,
  disabled = false,
  loading = false,
  onSelectModel,
}: ModelPickerProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const selectedModel =
    models.find(
      (model) =>
        providerModelKey(model) === selectedModelId ||
        model.id === selectedModelId,
    ) ?? null
  const filteredModels = useMemo(
    function filterModels() {
      const normalizedQuery = query.trim().toLowerCase()
      if (!normalizedQuery) return models
      return models.filter((model) =>
        providerModelSearchText(model).includes(normalizedQuery),
      )
    },
    [models, query],
  )

  return (
    <MenuRoot
      open={open}
      onOpenChange={function handleOpenChange(nextOpen) {
        setOpen(nextOpen)
        if (!nextOpen) setQuery('')
      }}
    >
      <MenuTrigger
        type="button"
        aria-label={label}
        disabled={disabled || loading || models.length === 0}
        className="flex h-9 w-full min-w-0 items-center justify-between gap-2 rounded-lg border border-primary-200 bg-surface px-3 text-left text-sm text-primary-900 transition-colors hover:border-primary-300 disabled:opacity-60 sm:w-64"
      >
        <span className="truncate">
          {loading
            ? 'Loading models…'
            : selectedModel
              ? providerModelDisplayName(selectedModel)
              : 'Choose a model'}
        </span>
        <HugeiconsIcon
          icon={ArrowDown01Icon}
          size={16}
          strokeWidth={1.5}
          className="shrink-0 text-primary-500"
        />
      </MenuTrigger>
      <MenuContent align="end" className="w-[min(24rem,calc(100vw-2rem))] p-0">
        <div className="border-b border-primary-200 p-2">
          <Input
            nativeInput
            value={query}
            aria-label="Search models"
            onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
              setQuery(event.target.value)
            }
            onKeyDown={(event) => event.stopPropagation()}
            placeholder="Search models"
          />
        </div>
        <div className="max-h-72 overflow-y-auto p-1">
          {filteredModels.length === 0 ? (
            <div className="px-3 py-6 text-center text-sm text-primary-500">
              No models match this search.
            </div>
          ) : (
            filteredModels.map((model) => {
              const modelKey = providerModelKey(model)
              const isSelected =
                !!selectedModel && modelKey === providerModelKey(selectedModel)
              return (
                <MenuItem
                  key={modelKey}
                  onClick={() => {
                    onSelectModel(modelKey)
                    setOpen(false)
                    setQuery('')
                  }}
                  className="items-start justify-between gap-3"
                >
                  <span className="min-w-0">
                    <span className="block truncate">
                      {providerModelDisplayName(model)}
                    </span>
                    <span className="block truncate text-xs text-primary-500">
                      {model.providerLabel || model.owned_by}
                    </span>
                  </span>
                  {isSelected ? (
                    <HugeiconsIcon
                      icon={Tick02Icon}
                      size={16}
                      strokeWidth={1.5}
                      className="mt-0.5 shrink-0 text-primary-700"
                    />
                  ) : null}
                </MenuItem>
              )
            })
          )}
        </div>
      </MenuContent>
    </MenuRoot>
  )
}
