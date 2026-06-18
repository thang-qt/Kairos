import { useMemo, useState } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import { PencilEdit02Icon, ArrowDown01Icon } from '@hugeicons/core-free-icons'
import type { ProviderModel } from '@/lib/app-api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import {
  MenuContent,
  MenuItem,
  MenuRoot,
  MenuTrigger,
} from '@/components/ui/menu'
import {
  providerModelDisplayName,
  providerModelSearchText,
} from '@/lib/model-utils'
import { cn } from '@/lib/utils'

type TitleModelPickerProps = {
  models: Array<ProviderModel>
  selectedModelId?: string
  disabled?: boolean
  loading?: boolean
  onSelectModel: (modelId: string) => void
}

function TitleModelPicker({
  models,
  selectedModelId,
  disabled = false,
  loading = false,
  onSelectModel,
}: TitleModelPickerProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')

  const selectedModel =
    models.find(function matchModel(model) {
      return model.id === selectedModelId
    }) ?? null

  const filteredModels = useMemo(
    function filterModels() {
      const normalizedQuery = query.trim().toLowerCase()
      if (!normalizedQuery) return models
      return models.filter(function matchesModel(model) {
        return providerModelSearchText(model).includes(normalizedQuery)
      })
    },
    [models, query],
  )

  return (
    <MenuRoot
      open={open}
      onOpenChange={function handleOpenChange(nextOpen) {
        setOpen(nextOpen)
        if (!nextOpen) {
          setQuery('')
        }
      }}
    >
      <MenuTrigger
        type="button"
        disabled={disabled || loading || models.length === 0}
        className={cn(
          'flex w-full items-center justify-between gap-2 rounded-lg border border-primary-200 bg-surface px-3 py-2 text-left text-sm text-primary-900 transition-colors hover:bg-primary-50 disabled:opacity-50',
        )}
      >
        <span className="min-w-0">
          <span className="block truncate font-medium">
            {loading
              ? 'Loading models...'
              : providerModelDisplayName(selectedModel ?? undefined)}
          </span>
          <span className="block truncate text-[11px] text-primary-500 tabular-nums">
            {selectedModel
              ? selectedModel.providerLabel ||
                selectedModel.owned_by ||
                selectedModel.id
              : 'No model selected'}
          </span>
        </span>
        <HugeiconsIcon
          icon={ArrowDown01Icon}
          size={20}
          strokeWidth={1.5}
          className="shrink-0 text-primary-600"
        />
      </MenuTrigger>

      <MenuContent
        align="start"
        className="w-[min(28rem,calc(100vw-2rem))] rounded-xl p-0 border border-primary-200 bg-surface shadow-md z-50"
      >
        <div className="border-b border-primary-200 px-3 py-3">
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
            placeholder="Search models"
          />
        </div>

        <div className="max-h-72 overflow-y-auto px-2 py-2">
          {filteredModels.length === 0 ? (
            <div className="rounded-lg border border-primary-200 px-3 py-6 text-center text-sm text-primary-500">
              No models match this search.
            </div>
          ) : (
            <div className="space-y-1">
              {filteredModels.map(function renderModel(model) {
                const isSelected = model.id === selectedModel?.id
                return (
                  <MenuItem
                    key={model.id}
                    onClick={function handleClick() {
                      onSelectModel(model.id)
                      setOpen(false)
                      setQuery('')
                    }}
                    className={cn(
                      'flex items-start justify-between gap-3 rounded-lg px-3 py-2 text-left transition-colors hover:bg-primary-50 cursor-pointer',
                      isSelected && 'bg-primary-100 hover:bg-primary-100',
                    )}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium text-primary-900">
                        {providerModelDisplayName(model)}
                      </div>
                      <div className="truncate text-xs text-primary-500 tabular-nums">
                        {model.providerLabel || model.owned_by || model.id}
                        {' · '}
                        {model.id}
                      </div>
                      {model.description ? (
                        <div className="line-clamp-1 text-xs text-primary-505 mt-0.5">
                          {model.description}
                        </div>
                      ) : null}
                    </div>
                    {isSelected ? (
                      <span className="shrink-0 text-[11px] font-medium text-primary-700 bg-primary-200 px-2 py-0.5 rounded">
                        Selected
                      </span>
                    ) : null}
                  </MenuItem>
                )
              })}
            </div>
          )}
        </div>
      </MenuContent>
    </MenuRoot>
  )
}

type TitleSettingsPopoverProps = {
  preferences: Record<string, any> | undefined
  models: Array<ProviderModel>
  titleGenerationModelId: string | undefined
  modelsQuery: any
  updatePreferencesMutation: any
  handleAutoGenerateTitleChange: (checked: boolean) => void
  handleUseSeparateTitleModelChange: (checked: boolean) => void
  handleTitleGenerationModelChange: (modelId: string) => void
}

export function TitleSettingsPopover({
  preferences,
  models,
  titleGenerationModelId,
  modelsQuery,
  updatePreferencesMutation,
  handleAutoGenerateTitleChange,
  handleUseSeparateTitleModelChange,
  handleTitleGenerationModelChange,
}: TitleSettingsPopoverProps) {
  const [open, setOpen] = useState(false)

  return (
    <div className="relative">
      <Button
        size="sm"
        variant="outline"
        onClick={function handleToggle() {
          setOpen(!open)
        }}
        className={cn(
          'h-9 gap-2 bg-surface hover:bg-primary-50 border-primary-200',
          open && 'bg-primary-50 border-primary-300',
        )}
      >
        <HugeiconsIcon
          icon={PencilEdit02Icon}
          size={20}
          strokeWidth={1.5}
          className="text-primary-600"
        />
        <span>Title Settings</span>
      </Button>

      {open && (
        <>
          <div
            className="fixed inset-0 z-40 cursor-default"
            onClick={function handleClose() {
              setOpen(false)
            }}
          />
          <div className="absolute right-0 mt-2 w-80 rounded-xl border border-primary-200 bg-surface p-4 shadow-lg z-50 space-y-4 text-left">
            <h4 className="text-sm font-medium text-primary-955 tracking-tight">
              Title Generation
            </h4>
            <p className="text-[11px] text-primary-500 leading-relaxed text-pretty">
              Customize title generation running at the start of new
              conversations.
            </p>

            <div className="space-y-3 pt-2 border-t border-primary-100">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-medium text-primary-900">
                    Auto-generate titles
                  </div>
                </div>
                <Switch
                  checked={preferences?.autoGenerateTitle ?? false}
                  disabled={updatePreferencesMutation.isPending}
                  onCheckedChange={handleAutoGenerateTitleChange}
                />
              </div>

              <div className="space-y-2 pt-2 border-t border-primary-100">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-medium text-primary-900">
                      Use separate title model
                    </div>
                  </div>
                  <Switch
                    checked={preferences?.useSeparateTitleModel ?? false}
                    disabled={
                      updatePreferencesMutation.isPending ||
                      !(preferences?.autoGenerateTitle ?? false) ||
                      models.length === 0
                    }
                    onCheckedChange={handleUseSeparateTitleModelChange}
                  />
                </div>

                {(preferences?.useSeparateTitleModel ?? false) ? (
                  <div className="space-y-1.5 pt-1.5 pl-2 border-l border-primary-200">
                    <label className="text-[10px] text-primary-600 font-medium">
                      Title generation model
                    </label>
                    <TitleModelPicker
                      models={models}
                      selectedModelId={titleGenerationModelId}
                      disabled={updatePreferencesMutation.isPending}
                      loading={modelsQuery.isLoading}
                      onSelectModel={handleTitleGenerationModelChange}
                    />
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
