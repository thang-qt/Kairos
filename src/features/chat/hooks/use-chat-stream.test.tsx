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
