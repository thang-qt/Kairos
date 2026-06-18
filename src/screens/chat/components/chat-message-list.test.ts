import { describe, expect, it } from 'vitest'
import {
  collectLinkedToolCallIds,
  isLinkedToolResultMessage,
} from './chat-message-list'
import type { GatewayMessage } from '../types'

describe('linked tool results', function () {
  it('identifies tool results that belong to assistant tool calls', function () {
    const messages: Array<GatewayMessage> = [
      {
        role: 'assistant',
        content: [
          {
            type: 'toolCall',
            id: 'call-1',
            name: 'read_file',
          },
        ],
      },
      {
        role: 'toolResult',
        toolCallId: 'call-1',
        content: [{ type: 'text', text: 'result' }],
      },
      {
        role: 'toolResult',
        toolCallId: 'standalone',
        content: [{ type: 'text', text: 'standalone' }],
      },
    ]

    const linkedIds = collectLinkedToolCallIds(messages)

    expect(isLinkedToolResultMessage(messages[1], linkedIds)).toBe(true)
    expect(isLinkedToolResultMessage(messages[2], linkedIds)).toBe(false)
  })
})
