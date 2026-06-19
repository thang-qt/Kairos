import type { ProviderModel } from './app-api'

export function providerModelDisplayName(
  model: ProviderModel | null | undefined,
  fallback = 'Select a model',
) {
  if (!model) return fallback
  const normalizedName = model.name?.trim()
  return normalizedName || model.id
}

export function providerModelKey(model: ProviderModel) {
  return model.modelRef?.trim() || model.id
}

export function providerModelMetaLine(model: ProviderModel) {
  if (model.providerLabel && model.providerLabel !== model.id) {
    return `${model.providerLabel} · ${model.id}`
  }
  if (model.owned_by && model.owned_by !== model.id) {
    return `${model.owned_by} · ${model.id}`
  }
  return model.id
}

export function providerModelSearchText(model: ProviderModel) {
  return [
    model.modelRef,
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

export function formatContextWindow(value?: number) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return 'Unknown'
  }
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(value % 1_000_000 === 0 ? 0 : 1)}M`
  }
  if (value >= 1_000) {
    return `${Math.round(value / 1_000)}K`
  }
  return String(value)
}
