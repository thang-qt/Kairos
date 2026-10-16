// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { chatQueryKeys } from '../chat-queries'
import { setChatBackend } from '@/lib/chat-backend'
import { useChatEphemeralGeneration } from './use-chat-ephemeral-generation'

import type { ChatBackend } from '@/lib/chat-backend'
import type { ReactNode } from 'react'

afterEach(function resetBackend() {
  setChatBackend(null as unknown as ChatBackend)
})

function createInput(queryClient: QueryClient) {
  return {
    activeFriendlyId: 'new',
    isNewChat: true,
    throwawayMode: true,
    queryClient,
    displayMessages: [],
    resolvedConversationModel: 'test-model',
    resolvedSystemPrompt: '',
    resolvedWebSearch: false,
    resolvedMathTools: false,
    beginGeneration: vi.fn(),
    finishGeneration: vi.fn(),
    setSending: vi.fn(),
    setStreamError: vi.fn(),
    setPinToTop: vi.fn(),
  }
}

describe('useChatEphemeralGeneration', function () {
  it('restores the draft and removes optimism when streaming fails before an event', async function () {
    const streamEphemeralMessage = vi
      .fn()
      .mockRejectedValue(new Error('Stream unavailable'))
    setChatBackend({ streamEphemeralMessage } as unknown as ChatBackend)
    const queryClient = new QueryClient()

    function Wrapper({ children }: { children: ReactNode }) {
      return (
        <QueryClientProvider client={queryClient}>
          {children}
        </QueryClientProvider>
      )
    }

    const input = createInput(queryClient)
    const { result } = renderHook(() => useChatEphemeralGeneration(input), {
      wrapper: Wrapper,
    })
    const helpers = {
      attachments: [],
      reset: vi.fn(),
      setValue: vi.fn(),
    }

    await act(async function sendAndWait() {
      result.current.sendEphemeralMessage('draft text', helpers)
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(helpers.setValue).toHaveBeenCalledWith('draft text')
    expect(
      queryClient.getQueryData(chatQueryKeys.history('new', 'new')),
    ).toMatchObject({ messages: [] })
    expect(input.setStreamError).toHaveBeenCalledWith('Stream unavailable')
    expect(input.finishGeneration).toHaveBeenCalledOnce()
  })

  it('keeps accepted content when a stream fails after emitting an event', async function () {
    const streamEphemeralMessage = vi
      .fn()
      .mockImplementation(async function emitThenFail(request, onEvent) {
        void request
        onEvent({ state: 'delta' })
        throw new Error('Connection lost')
      })
    setChatBackend({ streamEphemeralMessage } as unknown as ChatBackend)
    const queryClient = new QueryClient()

    function Wrapper({ children }: { children: ReactNode }) {
      return (
        <QueryClientProvider client={queryClient}>
          {children}
        </QueryClientProvider>
      )
    }

    const input = createInput(queryClient)
    const { result } = renderHook(() => useChatEphemeralGeneration(input), {
      wrapper: Wrapper,
    })
    const helpers = {
      attachments: [],
      reset: vi.fn(),
      setValue: vi.fn(),
    }

    await act(async function sendAndWait() {
      result.current.sendEphemeralMessage('draft text', helpers)
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })

    const history = queryClient.getQueryData<{
      messages: Array<{ clientId?: string; status?: string }>
    }>(chatQueryKeys.history('new', 'new'))
    expect(helpers.setValue).not.toHaveBeenCalled()
    expect(history?.messages).toHaveLength(1)
    expect(history?.messages[0]?.status).toBeUndefined()
    expect(input.setStreamError).toHaveBeenCalledWith('Connection lost')
  })
})
