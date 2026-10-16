import { describe, expect, it } from 'vitest'
import {
  modelReasoningEfforts,
  resolveReasoningEffort,
} from './reasoning-options'
import type { ProviderModel } from '@/lib/app-api'

function model(values: Array<string>): ProviderModel {
  return {
    id: 'deepseek',
    object: 'model',
    created: 0,
    owned_by: 'hyper',
    catalogMetadata: {
      source: 'https://models.dev',
      provider: 'hyper',
      match: 'provider',
      model: {
        id: 'deepseek',
        reasoning: true,
        reasoning_options: [{ type: 'effort', values }],
      },
    },
  }
}
describe('per-model reasoning controls', function () {
  it('offers provider-specific levels and keeps extra high unchanged', function () {
    const target = model(['low', 'high', 'xhigh'])
    expect(modelReasoningEfforts(target)).toEqual(['low', 'high', 'xhigh'])
    expect(resolveReasoningEffort('medium', target)).toBe('low')
  })
  it('omits effort for models that only advertise a thinking toggle', function () {
    const target = model([])
    target.catalogMetadata!.model.reasoning_options = [{ type: 'toggle' }]
    expect(modelReasoningEfforts(target)).toEqual([])
  })
})
