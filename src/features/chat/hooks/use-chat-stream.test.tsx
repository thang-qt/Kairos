// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react'
import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'
import { useChatStream } from './use-chat-stream'
import { chatQueryKeys } from '../chat-queries'
import type { ConversationEvent } from '@/lib/chat-backend'
import type { HistoryResponse } from '../types'

const transport = vi.hoisted(function createTransport() {
  return {
    receive: undefined as ((event: ConversationEvent) => void) | undefined,
  }
})
vi.mock('@/lib/chat-backend', function mockBackend() {
  return {
    getChatBackend: function getBackend() {
      return {
        subscribeToConversation: function subscribe(input: {
          onEvent: (event: ConversationEvent) => void
        }) {
          transport.receive = input.onEvent
          return function unsubscribe() {
            transport.receive = undefined
          }
        },
      }
    },
  }
})

function mountStream(
  queryClient: QueryClient,
  onEvent: (event: unknown) => void,
) {
  return renderHook(function stream() {
    return useChatStream({
      activeFriendlyId: 'friendly',
      isNewChat: false,
      isRedirecting: false,
      resolvedSessionKey: 'session',
      sessionKeyForHistory: 'session',
      queryClient,
      refreshHistory: function refresh() {},
      onChatEvent: onEvent,
    })
  })
}

describe('snapshot and live event reconciliation', function () {
  it('starts with authoritative user and assistant turns and rejects older replay', function () {
    const client = new QueryClient()
    const observed = vi.fn()
    const hook = mountStream(client, observed)
    const snapshot: HistoryResponse = {
      sessionKey: 'session',
      revision: 2,
      cursor: 10,
      messages: [
        { id: 'user', role: 'user' },
        {
          id: 'turn',
          role: 'assistant',
          runId: 'run',
          status: 'running',
          steps: [],
          content: [],
        },
      ],
    }
    act(function snapshotEvent() {
      transport.receive?.({
        state: 'reconcile',
        revision: 2,
        snapshot,
        activeRunIds: ['run'],
      })
    })
    expect(
      client.getQueryData(chatQueryKeys.history('friendly', 'session')),
    ).toEqual(snapshot)
    act(function olderEvent() {
      transport.receive?.({
        state: 'delta',
        revision: 1,
        cursor: 5,
        message: { id: 'obsolete' },
      })
    })
    expect(
      client.getQueryData(chatQueryKeys.history('friendly', 'session')),
    ).toEqual(snapshot)
    act(function liveEvent() {
      transport.receive?.({
        state: 'delta',
        revision: 2,
        cursor: 11,
        runId: 'run',
        sessionKey: 'session',
        message: {
          ...snapshot.messages[1],
          content: [{ type: 'text', text: 'new' }],
        },
      })
    })
    const history = client.getQueryData<HistoryResponse>(
      chatQueryKeys.history('friendly', 'session'),
    )
    expect(history?.messages).toHaveLength(2)
    expect(history?.messages[1].content).toEqual([
      { type: 'text', text: 'new' },
    ])
    expect(history?.cursor).toBe(11)
    hook.unmount()
  })
  it('ignores a stale snapshot without resetting active-run state', function () {
    const client = new QueryClient()
    const key = chatQueryKeys.history('friendly', 'session')
    client.setQueryData<HistoryResponse>(key, {
      sessionKey: 'session',
      revision: 2,
      cursor: 10,
      messages: [],
    })
    const observed = vi.fn()
    const hook = mountStream(client, observed)
    act(function staleSnapshot() {
      transport.receive?.({
        state: 'reconcile',
        revision: 1,
        activeRunIds: [],
        snapshot: {
          sessionKey: 'session',
          revision: 1,
          cursor: 5,
          messages: [],
        },
      })
    })
    expect(observed).not.toHaveBeenCalled()
    expect(client.getQueryData<HistoryResponse>(key)?.revision).toBe(2)
    hook.unmount()
  })
})

it('streams compact patches and rejects duplicate cursors', function () {
  const client = new QueryClient()
  const hook = mountStream(client, vi.fn())
  const key = chatQueryKeys.history('friendly', 'session')
  act(function seed() {
    transport.receive?.({
      state: 'reconcile',
      snapshot: {
        sessionKey: 'session',
        revision: 1,
        cursor: 4,
        messages: [
          {
            id: 'turn',
            role: 'assistant',
            revision: 1,
            content: [{ type: 'thinking', thinking: 'First' }],
          },
        ],
      },
    })
  })
  const patch: ConversationEvent = {
    state: 'delta',
    sessionKey: 'session',
    revision: 1,
    cursor: 5,
    turnId: 'turn',
    runId: 'run',
    turnPatch: [
      { op: 'append', path: ['content', '0', 'thinking'], value: ' next' },
    ],
  }
  act(function append() {
    transport.receive?.(patch)
  })
  act(function duplicate() {
    transport.receive?.(patch)
  })
  expect(
    client.getQueryData<HistoryResponse>(key)?.messages[0].content,
  ).toEqual([{ type: 'thinking', thinking: 'First next' }])
  expect(client.getQueryData<HistoryResponse>(key)?.cursor).toBe(5)
  hook.unmount()
})

it('keeps previous turns when another client appends a newer revision', function () {
  const client = new QueryClient()
  const hook = mountStream(client, vi.fn())
  const key = chatQueryKeys.history('friendly', 'session')
  act(function seed() {
    transport.receive?.({
      state: 'reconcile',
      snapshot: {
        sessionKey: 'session',
        revision: 1,
        cursor: 5,
        messages: [
          { id: 'old-user', role: 'user', revision: 1 },
          { id: 'old-answer', role: 'assistant', revision: 1 },
        ],
      },
    })
  })
  act(function append() {
    transport.receive?.({
      state: 'user',
      sessionKey: 'session',
      revision: 2,
      cursor: 6,
      message: { id: 'new-user', role: 'user', revision: 2 },
    })
  })
  expect(
    client.getQueryData<HistoryResponse>(key)?.messages.map(function id(turn) {
      return turn.id
    }),
  ).toEqual(['old-user', 'old-answer', 'new-user'])
  hook.unmount()
})
