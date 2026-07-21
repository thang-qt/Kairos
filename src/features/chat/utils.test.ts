import { describe, expect, it } from 'vitest'

import { normalizeSessions } from './utils'

describe('normalizeSessions', function () {
  it('keeps persisted conversation settings from the sessions API', function () {
    const settings = {
      model: 'provider/model-a',
      systemPrompt: 'Be concise.',
      webSearch: false,
      mathTools: true,
      advanced: {
        reasoning: true,
        reasoningEffort: 'high' as const,
        sampling: false,
        temperature: 0.7,
        topP: 1,
        topK: 0,
        penalties: false,
        frequencyPenalty: 0,
        presencePenalty: 0,
        maxTokens: false,
        maxTokensValue: 4096,
      },
    }

    const sessions = normalizeSessions([
      { key: 'session-1', friendlyId: 'friendly-1', settings },
    ])

    expect(sessions[0]?.settings).toEqual(settings)
  })
})
