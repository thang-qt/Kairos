import { describe, expect, it } from 'vitest'
import {
  activeAssistantRunBounds,
  collectLinkedToolCallIds,
  isLinkedToolResultMessage,
  projectChatMessages,
  areChatMessageListEqual,
} from './chat-message-list'
import { targetVisibleCount } from '../hooks/use-chat-scroll-control'
import type { GatewayMessage } from '../types'

describe('linked tool results', function () {
  it('treats assistant rounds from one active run as one visual response', function () {
    const messages: Array<GatewayMessage> = [
      { id: 'user', role: 'user', content: [{ type: 'text', text: 'go' }] },
      {
        id: 'round-1',
        role: 'assistant',
        runId: 'run-1',
        content: [{ type: 'toolCall', id: 'call-1', name: 'math_eval' }],
      },
      {
        id: 'round-2',
        role: 'assistant',
        runId: 'run-1',
        content: [{ type: 'toolCall', id: 'call-2', name: 'web_search' }],
      },
      {
        id: 'other-run',
        role: 'assistant',
        runId: 'run-2',
        content: [{ type: 'text', text: 'unrelated' }],
      },
    ]

    expect(activeAssistantRunBounds(messages, new Set(['run-1']))).toEqual(
      new Map([['run-1', { firstIndex: 1, lastIndex: 2 }]]),
    )
  })

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

  it('groups only inactive messages with the same durable run id', function () {
    const messages: Array<GatewayMessage> = [
      {
        id: 'assistant-tool-a',
        role: 'assistant',
        runId: 'run-a',
        content: [{ type: 'toolCall', id: 'call-a', name: 'math_eval' }],
      },
      {
        id: 'tool-a',
        role: 'toolResult',
        runId: 'run-a',
        toolCallId: 'call-a',
        content: [{ type: 'text', text: '4' }],
      },
      {
        id: 'assistant-final-a',
        role: 'assistant',
        runId: 'run-a',
        content: [{ type: 'text', text: 'done' }],
      },
      {
        id: 'assistant-tool-b',
        role: 'assistant',
        runId: 'run-b',
        content: [{ type: 'toolCall', id: 'call-b', name: 'math_eval' }],
      },
      {
        id: 'assistant-final-b',
        role: 'assistant',
        runId: 'run-b',
        content: [{ type: 'text', text: 'still streaming' }],
      },
    ]

    const projected = projectChatMessages(messages, new Set(['run-b']))

    expect(projected.displayMessages.map((message) => message.id)).toEqual([
      'assistant-final-a',
      'assistant-tool-b',
      'assistant-final-b',
    ])
    expect(
      projected.toolChainsByFinalMessageID.get('assistant-final-a'),
    ).toEqual([messages[0]])
    expect(projected.toolChainsByFinalMessageID.has('assistant-final-b')).toBe(
      false,
    )
  })

  it('keeps orphan tool results as standalone messages', function () {
    const messages: Array<GatewayMessage> = [
      {
        id: 'orphan-result',
        role: 'toolResult',
        runId: 'run-a',
        toolCallId: 'missing-call',
        content: [{ type: 'text', text: 'orphan' }],
      },
    ]

    expect(projectChatMessages(messages, new Set()).displayMessages).toEqual(
      messages,
    )
  })
})

describe('target message visibility', function () {
  it('expands the rendered history through an older target message', function () {
    const messages = Array.from(
      { length: 40 },
      function createMessage(_, index) {
        return {
          id: `message-${index}`,
          role: 'user',
          content: [{ type: 'text', text: String(index) }],
        } satisfies GatewayMessage
      },
    )

    expect(targetVisibleCount(messages, 'message-4')).toBe(36)
    expect(targetVisibleCount(messages, 'missing')).toBeUndefined()
  })
})

describe('areChatMessageListEqual render boundary', function () {
  it('considers identical message list props as equal', function () {
    const messages: Array<GatewayMessage> = []
    const prevProps = { messages, loading: false, empty: true }
    const nextProps = { messages, loading: false, empty: true }
    expect(areChatMessageListEqual(prevProps as any, nextProps as any)).toBe(
      true,
    )
  })

  it('considers message list props with different message array reference as not equal', function () {
    const prevProps = { messages: [], loading: false, empty: true }
    const nextProps = { messages: [], loading: false, empty: true }
    expect(areChatMessageListEqual(prevProps as any, nextProps as any)).toBe(
      false,
    )
  })
})
