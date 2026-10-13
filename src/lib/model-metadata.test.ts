import { describe, expect, it } from 'vitest'
import { formatCatalogDate, formatPrice, modelFacts } from './model-metadata'
import type { ProviderModel } from './app-api'

function catalogModel(
  entry: Record<string, unknown>,
  match: 'provider' | 'exact' = 'provider',
): ProviderModel {
  return {
    id: 'claude-haiku-4-5',
    object: 'model',
    created: 0,
    owned_by: 'anthropic',
    catalogMetadata: {
      source: 'https://models.dev',
      provider: 'anthropic',
      match,
      model: { id: 'claude-haiku-4-5', ...entry },
    },
  }
}

describe('modelFacts', function () {
  it('reads limits, dates, capabilities and provider pricing', function () {
    const facts = modelFacts(
      catalogModel({
        attachment: true,
        reasoning: true,
        tool_call: true,
        knowledge: '2025-02-28',
        release_date: '2025-10-15',
        modalities: { input: ['text', 'image', 'pdf'], output: ['text'] },
        limit: { context: 200000, output: 64000 },
        cost: { input: 1, output: 5, cache_read: 0.1, cache_write: 1.25 },
        status: 'beta',
      }),
    )
    expect(facts).toMatchObject({
      contextWindow: 200000,
      maxOutput: 64000,
      releaseDate: '2025-10-15',
      knowledge: '2025-02-28',
      status: 'beta',
      capabilities: ['vision', 'files', 'reasoning', 'tools'],
      pricing: {
        input: 1,
        output: 5,
        cacheRead: 0.1,
        cacheWrite: 1.25,
        source: 'provider',
      },
    })
  })

  it('marks prices from another provider listing as reference only', function () {
    const facts = modelFacts(
      catalogModel(
        {
          cost: {
            input: 2,
            output: 12,
            tiers: [{ input: 4, tier: { type: 'context', size: 200000 } }],
          },
        },
        'exact',
      ),
    )
    expect(facts.pricing).toMatchObject({
      source: 'reference',
      sourceProvider: 'anthropic',
      tierAbove: 200000,
    })
  })

  it('returns no facts for models outside the catalog', function () {
    expect(
      modelFacts({ id: 'local', object: 'model', created: 0, owned_by: 'me' }),
    ).toEqual({
      contextWindow: undefined,
      maxOutput: undefined,
      releaseDate: undefined,
      knowledge: undefined,
      status: undefined,
      openWeights: undefined,
      capabilities: [],
      pricing: undefined,
    })
  })
})

describe('formatting', function () {
  it('formats per-million prices and catalog dates', function () {
    expect(formatPrice(0)).toBe('Free')
    expect(formatPrice(1)).toBe('$1')
    expect(formatPrice(1.25)).toBe('$1.25')
    expect(formatPrice(0.075)).toBe('$0.075')
    expect(formatPrice(15)).toBe('$15')
    expect(formatPrice(undefined)).toBe('—')
    expect(formatCatalogDate('2025-10-15')).toMatch(/2025/)
    expect(formatCatalogDate('2024')).toBe('2024')
    expect(formatCatalogDate(undefined)).toBeUndefined()
  })
})
