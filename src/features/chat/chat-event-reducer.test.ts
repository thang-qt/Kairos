import { describe, expect, it } from 'vitest'

import { reduceChatEventMessages } from './chat-event-reducer'

import type { GatewayMessage } from './types'

describe('reduceChatEventMessages', function () {
  it('replaces streaming snapshots and freezes the terminal message', function () {
    const initial: Array<GatewayMessage> = []
    const partial = reduceChatEventMessages(initial, {
      runId: 'run-1',
      state: 'delta',
      message: {
        id: 'assistant-1',
        role: 'assistant',
        content: [{ type: 'text', text: 'Hel' }],
      },
    })
    const nextPartial = reduceChatEventMessages(partial, {
      runId: 'run-1',
      state: 'delta',
      message: {
        id: 'assistant-1',
        role: 'assistant',
        content: [{ type: 'text', text: 'Hello' }],
      },
    })
    const complete = reduceChatEventMessages(nextPartial, {
      runId: 'run-1',
      state: 'final',
      message: {
        id: 'assistant-1',
        role: 'assistant',
        content: [{ type: 'text', text: 'Hello there' }],
      },
    })

    expect(complete).toHaveLength(1)
    expect(complete[0].content).toEqual([{ type: 'text', text: 'Hello there' }])
    expect(complete[0].__streamRunId).toBeNull()
  })

  it('removes unfinished snapshots for a terminal error event', function () {
    const messages: Array<GatewayMessage> = [
      {
        id: 'assistant-1',
        role: 'assistant',
        runId: 'run-1',
        __streamRunId: 'run-1',
        content: [{ type: 'text', text: 'Partial' }],
      },
    ]

    expect(
      reduceChatEventMessages(messages, {
        runId: 'run-1',
        state: 'error',
        error: 'failed',
      }),
    ).toEqual([])
  })

  it('freezes throwaway tool rounds instead of discarding them', function () {
    const messages: Array<GatewayMessage> = [
      {
        id: 'assistant-tool',
        role: 'assistant',
        runId: 'run-1',
        __streamRunId: 'run-1',
        content: [{ type: 'toolCall', id: 'call-1', name: 'math_eval' }],
      },
      {
        id: 'tool-result',
        role: 'toolResult',
        runId: 'run-1',
        __streamRunId: 'run-1',
        toolCallId: 'call-1',
        content: [{ type: 'text', text: '4' }],
      },
    ]

    const complete = reduceChatEventMessages(
      messages,
      {
        runId: 'run-1',
        state: 'final',
        message: {
          id: 'assistant-final',
          role: 'assistant',
          content: [{ type: 'text', text: 'The answer is 4.' }],
        },
      },
      { retainRunMessagesOnTerminal: true },
    )

    expect(complete.map((message) => message.id)).toEqual([
      'assistant-tool',
      'tool-result',
      'assistant-final',
    ])
    expect(complete.every((message) => message.__streamRunId === null)).toBe(
      true,
    )
  })
})
