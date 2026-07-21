import { describe, expect, it } from 'vitest'

import { findStreamMessageIndex } from './use-chat-stream'
import type { GatewayMessage } from '../types'

describe('findStreamMessageIndex', function () {
  it('does not replace an earlier assistant round with a different message id', function () {
    const messages: Array<GatewayMessage> = [
      {
        id: 'assistant-round-1',
        role: 'assistant',
        __streamRunId: 'run-1',
        content: [{ type: 'toolCall', id: 'call-1', name: 'web_search' }],
      },
    ]

    expect(
      findStreamMessageIndex(
        messages,
        {
          id: 'assistant-round-2',
          role: 'assistant',
          __streamRunId: 'run-1',
          content: [{ type: 'text', text: 'Starting round 2' }],
        },
        'run-1',
      ),
    ).toBe(-1)
  })

  it('updates another snapshot of the same assistant round by id', function () {
    const messages: Array<GatewayMessage> = [
      {
        id: 'assistant-round-1',
        role: 'assistant',
        __streamRunId: 'run-1',
        content: [{ type: 'text', text: 'Partial' }],
      },
    ]

    expect(
      findStreamMessageIndex(
        messages,
        {
          id: 'assistant-round-1',
          role: 'assistant',
          __streamRunId: 'run-1',
          content: [{ type: 'text', text: 'Complete' }],
        },
        'run-1',
      ),
    ).toBe(0)
  })

  it('falls back to run and role only for one id-less stream message', function () {
    const messages: Array<GatewayMessage> = [
      {
        role: 'assistant',
        __streamRunId: 'run-1',
        content: [{ type: 'text', text: 'Partial' }],
      },
    ]

    expect(
      findStreamMessageIndex(
        messages,
        {
          role: 'assistant',
          __streamRunId: 'run-1',
          content: [{ type: 'text', text: 'Complete' }],
        },
        'run-1',
      ),
    ).toBe(0)
  })

  it('does not replace an ambiguous id-less assistant round', function () {
    const messages: Array<GatewayMessage> = [
      {
        role: 'assistant',
        __streamRunId: 'run-1',
        content: [{ type: 'text', text: 'Round one' }],
      },
      {
        role: 'assistant',
        __streamRunId: 'run-1',
        content: [{ type: 'text', text: 'Round two' }],
      },
    ]

    expect(
      findStreamMessageIndex(
        messages,
        {
          role: 'assistant',
          __streamRunId: 'run-1',
          content: [{ type: 'text', text: 'Unknown round' }],
        },
        'run-1',
      ),
    ).toBe(-1)
  })
})
