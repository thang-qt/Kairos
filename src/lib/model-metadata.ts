import type { ProviderModel } from './app-api'

// Typed view of the models.dev entry the backend attaches to each model.
// Prices are USD per million tokens.

export type ModelPricing = {
  input?: number
  output?: number
  cacheRead?: number
  cacheWrite?: number
  // Context size above which a higher tier applies, when the catalog has one.
  tierAbove?: number
  // 'provider' prices belong to the connected endpoint; 'reference' prices come
  // from another provider listing the same model and may differ.
  source: 'provider' | 'reference'
  sourceProvider: string
}

export type ModelCapability = 'vision' | 'files' | 'reasoning' | 'tools'

export type ModelFacts = {
  contextWindow?: number
  maxOutput?: number
  releaseDate?: string
  knowledge?: string
  status?: 'alpha' | 'beta' | 'deprecated'
  openWeights?: boolean
  capabilities: Array<ModelCapability>
  pricing?: ModelPricing
}

type CatalogModel = {
  attachment?: boolean
  reasoning?: boolean
  tool_call?: boolean
  open_weights?: boolean
  release_date?: string
  knowledge?: string
  status?: string
  modalities?: { input?: Array<string> }
  limit?: { context?: number; output?: number }
  cost?: {
    input?: number
    output?: number
    cache_read?: number
    cache_write?: number
    tiers?: Array<{ tier?: { type?: string; size?: number } }>
  }
}

export function modelFacts(
  model: ProviderModel | null | undefined,
): ModelFacts {
  const metadata = model?.catalogMetadata
  const entry = (metadata?.model ?? {}) as CatalogModel
  const inputs = entry.modalities?.input ?? []
  const capabilities: Array<ModelCapability> = []
  if (inputs.includes('image')) capabilities.push('vision')
  if (inputs.includes('pdf') || (entry.attachment && !inputs.includes('image')))
    capabilities.push('files')
  if (entry.reasoning) capabilities.push('reasoning')
  if (entry.tool_call) capabilities.push('tools')
  const cost = entry.cost
  const hasPrice =
    cost && (isPrice(cost.input) || isPrice(cost.output)) && metadata
  const status = entry.status
  return {
    contextWindow:
      positive(model?.contextWindow) ?? positive(entry.limit?.context),
    maxOutput: positive(entry.limit?.output),
    releaseDate: entry.release_date || undefined,
    knowledge: entry.knowledge || undefined,
    status:
      status === 'alpha' || status === 'beta' || status === 'deprecated'
        ? status
        : undefined,
    openWeights: entry.open_weights,
    capabilities,
    pricing: hasPrice
      ? {
          input: price(cost.input),
          output: price(cost.output),
          cacheRead: price(cost.cache_read),
          cacheWrite: price(cost.cache_write),
          tierAbove: cost.tiers?.find((tier) => tier.tier?.type === 'context')
            ?.tier?.size,
          source: metadata.match === 'provider' ? 'provider' : 'reference',
          sourceProvider: metadata.provider,
        }
      : undefined,
  }
}

export function formatPrice(value?: number) {
  if (value === undefined) return '—'
  if (value === 0) return 'Free'
  return `$${value < 0.1 ? value.toFixed(3).replace(/0+$/, '') : value < 10 ? value.toFixed(2).replace(/\.?0+$/, '') : Math.round(value)}`
}

// "2025-10-15" or "2025-10" → "Oct 2025".
export function formatCatalogDate(value?: string) {
  if (!value) return undefined
  const [year, month] = value.split('-').map(Number)
  if (!year) return value
  if (!month) return String(year)
  return new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString(undefined, {
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

export const CAPABILITY_LABELS: Record<ModelCapability, string> = {
  vision: 'Images',
  files: 'Files',
  reasoning: 'Reasoning',
  tools: 'Tools',
}

function isPrice(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

function price(value: unknown) {
  return isPrice(value) ? value : undefined
}

function positive(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : undefined
}
