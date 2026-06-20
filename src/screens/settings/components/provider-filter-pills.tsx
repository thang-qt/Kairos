import { cn } from '@/lib/utils'

import type { ProviderModel, ProviderRecord } from '@/lib/app-api'

type ProviderFilterPillsProps = {
  models: Array<ProviderModel>
  providers: Array<ProviderRecord>
  systemProvidersEnabled?: boolean
  selectedProviderFilter: string
  onSelectProviderFilter: (filter: string) => void
}

export function ProviderFilterPills({
  models,
  providers,
  systemProvidersEnabled = false,
  selectedProviderFilter,
  onSelectProviderFilter,
}: ProviderFilterPillsProps) {
  return (
    <div className="flex items-center gap-1.5 overflow-x-auto pb-1 mt-3 scrollbar-none">
      <button
        type="button"
        onClick={function handleSelectAll() {
          onSelectProviderFilter('all')
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

      {systemProvidersEnabled && (
        <button
          type="button"
          onClick={function handleSelectSystem() {
            onSelectProviderFilter('system')
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
            m.providerLabel === provider.label || m.owned_by === provider.label
          )
        }).length

        if (modelCount === 0 && !provider.enabled) return null

        return (
          <button
            key={provider.id}
            type="button"
            onClick={function handleSelectProvider() {
              onSelectProviderFilter(provider.id)
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
  )
}
