import { formatContextWindow, providerModelKey } from '@/lib/model-utils'
import { cn } from '@/lib/utils'

import type { ProviderModel } from '@/lib/app-api'

type ModelItemCardProps = {
  model: ProviderModel
  defaultModelId?: string
  isActive: boolean
  onToggle: () => void
}

export function ModelItemCard({
  model,
  defaultModelId,
  isActive,
  onToggle,
}: ModelItemCardProps) {
  const modelKey = providerModelKey(model)

  return (
    <div
      className={cn(
        'rounded-xl border border-primary-200 bg-surface overflow-hidden transition-all duration-200 self-start',
        isActive &&
          'ring-1 ring-primary-400 border-primary-400 bg-primary-50/10',
      )}
    >
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-start justify-between gap-3 p-4 text-left hover:bg-primary-50/40"
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="truncate font-mono text-[10px] text-primary-600 bg-primary-100 px-1.5 py-0.5 rounded">
              {model.id}
            </span>
            {defaultModelId === modelKey && (
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
}
