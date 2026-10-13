import { HugeiconsIcon } from '@hugeicons/react'
import type { IconSvgElement } from '@hugeicons/react'
import {
  Brain01Icon,
  File01Icon,
  Image01Icon,
  ToolsIcon,
} from '@hugeicons/core-free-icons'
import type { ProviderModel } from '@/lib/app-api'
import {
  CAPABILITY_LABELS,
  formatCatalogDate,
  formatPrice,
  modelFacts,
} from '@/lib/model-metadata'
import type { ModelCapability } from '@/lib/model-metadata'
import {
  formatContextWindow,
  providerModelDisplayName,
} from '@/lib/model-utils'
import { cn } from '@/lib/utils'

export const CAPABILITY_ICONS: Record<ModelCapability, IconSvgElement> = {
  vision: Image01Icon,
  files: File01Icon,
  reasoning: Brain01Icon,
  tools: ToolsIcon,
}

// What we know about a model: limits, dates, capabilities and price. Shared by
// the model picker preview, the chat sidebar and settings.
export function ModelDetails({
  model,
  showHeader = true,
  className,
}: {
  model: ProviderModel
  showHeader?: boolean
  className?: string
}) {
  const facts = modelFacts(model)
  const pricing = facts.pricing
  const rows: Array<[string, string]> = []
  if (facts.contextWindow) {
    rows.push(['Context', `${formatContextWindow(facts.contextWindow)} tokens`])
  }
  if (facts.maxOutput) {
    rows.push(['Max output', `${formatContextWindow(facts.maxOutput)} tokens`])
  }
  const released = formatCatalogDate(facts.releaseDate)
  if (released) rows.push(['Released', released])
  const knowledge = formatCatalogDate(facts.knowledge)
  if (knowledge) rows.push(['Knowledge', knowledge])

  return (
    <div className={cn('flex min-w-0 flex-col gap-3', className)}>
      {showHeader ? (
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-balance text-sm font-medium text-primary-950">
              {providerModelDisplayName(model)}
            </span>
            {facts.status ? <StatusBadge status={facts.status} /> : null}
          </div>
          <div className="truncate text-xs text-primary-500">
            {model.providerLabel || model.owned_by} ·{' '}
            <span className="font-mono">{model.id}</span>
          </div>
        </div>
      ) : null}

      {model.description ? (
        <p className="line-clamp-3 text-pretty text-xs leading-relaxed text-primary-700">
          {model.description}
        </p>
      ) : null}

      {facts.capabilities.length > 0 || facts.openWeights ? (
        <div className="flex flex-wrap gap-1">
          {facts.capabilities.map((capability) => (
            <span
              key={capability}
              className="inline-flex items-center gap-1 rounded-md bg-primary-100 px-1.5 py-0.5 text-xs text-primary-700"
            >
              <HugeiconsIcon
                icon={CAPABILITY_ICONS[capability]}
                size={12}
                strokeWidth={1.5}
              />
              {CAPABILITY_LABELS[capability]}
            </span>
          ))}
          {facts.openWeights ? (
            <span className="inline-flex items-center rounded-md bg-primary-100 px-1.5 py-0.5 text-xs text-primary-700">
              Open weights
            </span>
          ) : null}
        </div>
      ) : null}

      {rows.length > 0 ? (
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-xs">
          {rows.map(([label, value]) => (
            <div key={label} className="contents">
              <dt className="text-primary-500">{label}</dt>
              <dd className="tabular-nums text-primary-800">{value}</dd>
            </div>
          ))}
        </dl>
      ) : null}

      {pricing ? (
        <div className="rounded-lg bg-primary-50 p-2.5 ring-1 ring-primary-200">
          <div className="mb-1.5 text-xs text-primary-500">
            Price per 1M tokens
          </div>
          <dl className="flex flex-col gap-1 text-xs tabular-nums">
            <PriceCell label="Input" value={pricing.input} />
            <PriceCell label="Output" value={pricing.output} />
            {pricing.cacheRead !== undefined ? (
              <PriceCell label="Cached input" value={pricing.cacheRead} />
            ) : null}
            {pricing.cacheWrite !== undefined ? (
              <PriceCell label="Cache write" value={pricing.cacheWrite} />
            ) : null}
          </dl>
          {pricing.tierAbove || pricing.source === 'reference' ? (
            <p className="mt-1.5 text-pretty text-xs text-primary-500">
              {pricing.tierAbove
                ? `Higher above ${formatContextWindow(pricing.tierAbove)} context. `
                : ''}
              {pricing.source === 'reference'
                ? `Reference price from ${pricing.sourceProvider}; your provider may charge differently.`
                : ''}
            </p>
          ) : null}
        </div>
      ) : null}

      {!model.catalogMetadata ? (
        <p className="text-pretty text-xs text-primary-500">
          No catalog details for this model.
        </p>
      ) : null}
    </div>
  )
}

export function StatusBadge({ status }: { status: string }) {
  return (
    <span className="inline-flex shrink-0 items-center rounded-md bg-primary-100 px-1.5 py-0.5 text-xs capitalize text-primary-700">
      {status}
    </span>
  )
}

function PriceCell({ label, value }: { label: string; value?: number }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="whitespace-nowrap text-primary-500">{label}</dt>
      <dd className="text-primary-900">{formatPrice(value)}</dd>
    </div>
  )
}
