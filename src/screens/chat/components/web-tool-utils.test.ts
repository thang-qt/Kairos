import { describe, expect, it } from 'vitest'
import type { GatewayMessage } from '../types'
import {
  searchSourceCardsFromMessage,
  webToolEventCardsFromMessage,
} from './web-tool-utils'

describe('linked web tool results', function () {
  it('uses completed toolResult details rather than leaving the call running', function () {
    const result: GatewayMessage = {
      role: 'toolResult',
      toolCallId: 'call-1',
      toolName: 'web_search',
      details: {
        webTools: [
          {
            id: 'call-1',
            name: 'web_search',
            arguments: { query: 'Kairos' },
            result: {
              results: [
                {
                  title: 'Kairos',
                  url: 'https://example.com/kairos',
                  snippet: 'A result',
                },
              ],
            },
          },
        ],
      },
    }

    expect(webToolEventCardsFromMessage(result, ['call-1'])).toEqual([
      {
        id: 'call-1',
        name: 'web_search',
        query: 'Kairos',
        url: undefined,
        error: undefined,
        durationMs: undefined,
        state: 'complete',
      },
    ])
    expect(searchSourceCardsFromMessage(result, ['call-1'])).toEqual([
      {
        title: 'Kairos',
        url: 'https://example.com/kairos',
        content: 'A result',
      },
    ])
  })
})
