import type { ProviderModel } from '@/lib/app-api'
import type { ReasoningEffort } from './types'

export const reasoningEfforts: Array<ReasoningEffort> = [
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
]

export function modelReasoningEfforts(
  model?: ProviderModel | null,
): Array<ReasoningEffort> {
  const metadata = model?.catalogMetadata?.model
  if (!metadata) return reasoningEfforts
  if (metadata.reasoning === false) return []
  const option = metadata.reasoning_options?.find(function effort(option) {
    return option.type === 'effort'
  })
  return (option?.values ?? []).filter(
    function supported(value): value is ReasoningEffort {
      return reasoningEfforts.includes(value as ReasoningEffort)
    },
  )
}

export function resolveReasoningEffort(
  requested: ReasoningEffort,
  model?: ProviderModel | null,
): ReasoningEffort | null {
  const options = modelReasoningEfforts(model)
  if (options.includes(requested)) return requested
  return options.includes('medium')
    ? 'medium'
    : options.includes('low')
      ? 'low'
      : (options[0] ?? null)
}
