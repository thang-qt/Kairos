import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  ArrowDown01Icon,
  RefreshIcon,
  Search01Icon,
  StarIcon,
  Tick02Icon,
} from '@hugeicons/core-free-icons'
import type { ProviderModel } from '@/lib/app-api'
import {
  MenuContent,
  MenuItem,
  MenuRoot,
  MenuTrigger,
} from '@/components/ui/menu'
import { modelFacts } from '@/lib/model-metadata'
import {
  formatContextWindow,
  providerModelDisplayName,
  providerModelKey,
  providerModelSearchText,
} from '@/lib/model-utils'
import { cn } from '@/lib/utils'
import { CAPABILITY_ICONS, ModelDetails, StatusBadge } from './model-details'

type ModelPickerProps = {
  open?: boolean
  onOpenChange?: (open: boolean) => void
  models: Array<ProviderModel>
  selectedModelId?: string
  onSelectModel: (modelId: string) => void
  // Accessible name for the trigger.
  label: string
  // 'ghost' blends into a toolbar; 'field' looks like a form control.
  variant?: 'ghost' | 'field'
  defaultModelId?: string
  // When set, rows offer a star to make that model the default.
  onMakeDefault?: (modelId: string) => void
  onRefresh?: () => void
  refreshing?: boolean
  error?: string
  loading?: boolean
  disabled?: boolean
  side?: 'top' | 'bottom' | 'left' | 'right'
  align?: 'start' | 'center' | 'end'
  className?: string
}

type ModelGroup = { label: string; models: Array<ProviderModel> }

// The one model menu: searchable list grouped by provider, with a preview of
// the highlighted model's limits, capabilities and price beside it.
export function ModelPicker({
  open: controlledOpen,
  onOpenChange,
  models,
  selectedModelId,
  onSelectModel,
  label,
  variant = 'field',
  defaultModelId,
  onMakeDefault,
  onRefresh,
  refreshing = false,
  error,
  loading = false,
  disabled = false,
  side = 'bottom',
  align = 'start',
  className,
}: ModelPickerProps) {
  const [internalOpen, setInternalOpen] = useState(false)
  const open = controlledOpen ?? internalOpen
  function setOpen(nextOpen: boolean) {
    setInternalOpen(nextOpen)
    onOpenChange?.(nextOpen)
  }
  const [query, setQuery] = useState('')
  // The highlighted row: moved by the arrow keys or the pointer, shown in the
  // preview, and picked with Enter.
  const [activeKey, setActiveKey] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const listId = useId()
  const selectedModel =
    models.find(
      (model) =>
        providerModelKey(model) === selectedModelId ||
        model.id === selectedModelId,
    ) ?? null
  const groups = useMemo(() => groupModels(models, query), [models, query])
  const ordered = useMemo(
    () => groups.flatMap((group) => group.models),
    [groups],
  )
  const activeIndex = Math.max(
    0,
    ordered.findIndex(
      (model) =>
        providerModelKey(model) ===
        (activeKey ?? (selectedModel ? providerModelKey(selectedModel) : '')),
    ),
  )
  const activeModel = ordered[activeIndex] ?? null
  const previewModel = activeModel ?? selectedModel

  function rowId(index: number) {
    return `${listId}-${index}`
  }

  function choose(model: ProviderModel) {
    onSelectModel(providerModelKey(model))
    setOpen(false)
    setQuery('')
    setActiveKey(null)
  }

  function moveActive(offset: number) {
    if (ordered.length === 0) return
    const next = (activeIndex + offset + ordered.length) % ordered.length
    setActiveKey(providerModelKey(ordered[next]))
    document.getElementById(rowId(next))?.scrollIntoView({ block: 'nearest' })
  }

  // Opening moves focus into the search box and brings the current model
  // into view, so typing and arrow keys work straight away.
  useEffect(
    function focusSearchOnOpen() {
      if (!open) return
      const handle = requestAnimationFrame(() => {
        inputRef.current?.focus()
        document
          .getElementById(rowId(activeIndex))
          ?.scrollIntoView({ block: 'nearest' })
      })
      return () => cancelAnimationFrame(handle)
    },
    // Only on open; later highlight moves scroll themselves.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
    [open],
  )

  return (
    <MenuRoot
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen)
        if (!nextOpen) {
          setQuery('')
          setActiveKey(null)
        }
      }}
    >
      <MenuTrigger
        type="button"
        aria-label={label}
        disabled={disabled || loading || models.length === 0}
        className={cn(
          'inline-flex min-w-0 items-center gap-1.5 text-left text-sm transition-colors disabled:opacity-60',
          variant === 'ghost'
            ? 'rounded-md px-1.5 py-1 text-primary-700 hover:bg-primary-100 hover:text-primary-900'
            : 'h-9 w-full justify-between rounded-lg border border-primary-200 bg-surface px-3 text-primary-900 hover:border-primary-300 sm:w-64',
          className,
        )}
      >
        <span className="truncate">
          {loading
            ? 'Loading models…'
            : providerModelDisplayName(selectedModel, 'Choose a model')}
        </span>
        <HugeiconsIcon
          icon={ArrowDown01Icon}
          size={16}
          strokeWidth={1.5}
          className="shrink-0 text-primary-500"
        />
      </MenuTrigger>

      <MenuContent
        side={side}
        align={align}
        className="flex w-[min(20rem,calc(100vw-2rem))] overflow-hidden bg-surface p-0 md:w-[38rem]"
      >
        <div className="flex min-w-0 flex-1 flex-col md:max-w-80 md:border-r md:border-primary-200">
          <div className="flex items-center gap-1.5 border-b border-primary-200 p-2">
            <div className="relative flex-1">
              <HugeiconsIcon
                icon={Search01Icon}
                size={16}
                strokeWidth={1.5}
                className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-primary-400"
              />
              <input
                ref={inputRef}
                type="text"
                role="combobox"
                aria-expanded
                aria-controls={listId}
                aria-autocomplete="list"
                aria-activedescendant={
                  activeModel ? rowId(activeIndex) : undefined
                }
                value={query}
                aria-label="Search models"
                placeholder="Search models"
                onChange={(event) => {
                  setQuery(event.target.value)
                  // A new search starts from its best match.
                  setActiveKey(null)
                }}
                onKeyDown={(event) => {
                  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                    event.preventDefault()
                    moveActive(event.key === 'ArrowDown' ? 1 : -1)
                  } else if (event.key === 'Enter') {
                    event.preventDefault()
                    if (activeModel) choose(activeModel)
                  }
                  // Escape and Tab still reach the menu so it can close.
                  if (event.key !== 'Escape' && event.key !== 'Tab') {
                    event.stopPropagation()
                  }
                }}
                className="h-8 w-full rounded-lg bg-primary-100/60 pl-8 pr-2 text-sm text-primary-900 outline-none placeholder:text-primary-500 focus:bg-primary-100"
              />
            </div>
            {onRefresh ? (
              <button
                type="button"
                aria-label="Refresh models"
                title="Refresh models"
                disabled={refreshing}
                onClick={(event) => {
                  event.preventDefault()
                  event.stopPropagation()
                  onRefresh()
                }}
                className="flex size-8 shrink-0 items-center justify-center rounded-lg text-primary-500 transition-colors hover:bg-primary-100 hover:text-primary-900 disabled:opacity-60"
              >
                <HugeiconsIcon
                  icon={RefreshIcon}
                  size={16}
                  strokeWidth={1.5}
                  className={cn(refreshing && 'animate-spin')}
                />
              </button>
            ) : null}
          </div>

          <div id={listId} className="max-h-80 overflow-y-auto p-1">
            {error ? (
              <div className="m-1 rounded-md bg-red-50 px-2.5 py-1.5 text-xs text-red-700">
                {error}
              </div>
            ) : null}
            {groups.length === 0 ? (
              <div className="px-3 py-6 text-center text-sm text-primary-500">
                No models match this search.
              </div>
            ) : (
              groups.map((group) => (
                <div key={group.label} className="pb-1">
                  <div className="px-2 pb-0.5 pt-1.5 text-xs text-primary-500 select-none">
                    {group.label}
                  </div>
                  {group.models.map((model) => {
                    const modelKey = providerModelKey(model)
                    const index = ordered.indexOf(model)
                    const isSelected =
                      !!selectedModel &&
                      modelKey === providerModelKey(selectedModel)
                    return (
                      <ModelRow
                        key={modelKey}
                        id={rowId(index)}
                        model={model}
                        selected={isSelected}
                        active={index === activeIndex}
                        isDefault={modelKey === defaultModelId?.trim()}
                        onPreview={() => setActiveKey(modelKey)}
                        onSelect={() => choose(model)}
                        onMakeDefault={
                          onMakeDefault
                            ? () => onMakeDefault(modelKey)
                            : undefined
                        }
                      />
                    )
                  })}
                </div>
              ))
            )}
          </div>
        </div>

        <div className="hidden w-72 shrink-0 overflow-y-auto bg-primary-50/50 p-4 md:block">
          {previewModel ? <ModelDetails model={previewModel} /> : null}
        </div>
      </MenuContent>
    </MenuRoot>
  )
}

function ModelRow({
  id,
  model,
  selected,
  active,
  isDefault,
  onPreview,
  onSelect,
  onMakeDefault,
}: {
  id: string
  model: ProviderModel
  selected: boolean
  active: boolean
  isDefault: boolean
  onPreview: () => void
  onSelect: () => void
  onMakeDefault?: () => void
}) {
  const facts = modelFacts(model)
  const name = providerModelDisplayName(model)
  return (
    <MenuItem
      id={id}
      aria-selected={selected}
      onClick={onSelect}
      onMouseEnter={onPreview}
      onFocus={onPreview}
      className={cn(
        'group/model-row items-center gap-2 py-1.5 hover:bg-transparent data-highlighted:bg-transparent',
        active &&
          'bg-primary-100 hover:bg-primary-100 data-highlighted:bg-primary-100',
      )}
    >
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="truncate text-sm text-primary-900">{name}</span>
          {facts.status ? <StatusBadge status={facts.status} /> : null}
        </span>
        <span className="flex items-center gap-1.5 text-xs text-primary-500">
          {facts.contextWindow ? (
            <span className="tabular-nums">
              {formatContextWindow(facts.contextWindow)}
            </span>
          ) : null}
          {facts.capabilities.map((capability) => (
            <HugeiconsIcon
              key={capability}
              icon={CAPABILITY_ICONS[capability]}
              size={12}
              strokeWidth={1.5}
              aria-label={capability}
            />
          ))}
        </span>
      </span>
      {selected ? (
        <HugeiconsIcon
          icon={Tick02Icon}
          size={16}
          strokeWidth={1.5}
          aria-label="Current model"
          className="shrink-0 text-primary-700"
        />
      ) : null}
      {isDefault ? (
        <HugeiconsIcon
          icon={StarIcon}
          size={16}
          strokeWidth={1.5}
          aria-label="Default model"
          className="shrink-0 fill-primary-600/20 text-primary-600"
        />
      ) : onMakeDefault ? (
        <button
          type="button"
          aria-label={`Make ${name} default`}
          title="Make default"
          onClick={(event) => {
            event.preventDefault()
            event.stopPropagation()
            onMakeDefault()
          }}
          className="shrink-0 rounded-md p-1 text-primary-400 opacity-0 transition-opacity hover:bg-primary-200 hover:text-primary-700 focus-visible:opacity-100 group-hover/model-row:opacity-100"
        >
          <HugeiconsIcon icon={StarIcon} size={16} strokeWidth={1.5} />
        </button>
      ) : null}
    </MenuItem>
  )
}

function groupModels(
  models: Array<ProviderModel>,
  query: string,
): Array<ModelGroup> {
  const needle = query.trim().toLowerCase()
  const groups = new Map<string, Array<ProviderModel>>()
  for (const model of models) {
    if (needle && !providerModelSearchText(model).includes(needle)) continue
    const provider =
      model.providerLabel?.trim() || model.owned_by?.trim() || 'Other'
    const label = provider.charAt(0).toUpperCase() + provider.slice(1)
    groups.set(label, [...(groups.get(label) ?? []), model])
  }
  return [...groups.entries()]
    .sort(([left], [right]) =>
      left === 'Other' ? 1 : right === 'Other' ? -1 : left.localeCompare(right),
    )
    .map(([label, items]) => ({
      label,
      models: items.sort((left, right) =>
        providerModelDisplayName(left).localeCompare(
          providerModelDisplayName(right),
        ),
      ),
    }))
}
