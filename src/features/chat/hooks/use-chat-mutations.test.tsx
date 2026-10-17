// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  beginFreshNewChat,
  defaultConversationSettings,
  useConversationSettingsStore,
} from '../conversation-settings'
import { chatQueryKeys } from '../chat-queries'
import { useChatMutations } from './use-chat-mutations'
import { setChatBackend } from '@/lib/chat-backend'
import { ApiError } from '@/lib/api-client'

import type { ChatBackend } from '@/lib/chat-backend'
import type { ReactNode } from 'react'

vi.mock('@tanstack/react-router', function () {
  return { useNavigate: () => vi.fn(() => Promise.resolve()) }
})

afterEach(function resetBackend() {
  setChatBackend(null as unknown as ChatBackend)
})

function createInput() {
  return {
    activeFriendlyId: 'new',
    isNewChat: true,
    resolvedConversationModel: 'test-model',

    conversationSettings: defaultConversationSettings,
    beginGeneration: vi.fn(),
    finishGeneration: vi.fn(),
    startRun: vi.fn(),
    refreshHistory: vi.fn(),
    setPinToTop: vi.fn(),
    storeCloneScrollRestore: vi.fn(),
    stashCloneComposerDraft: vi.fn(),
    activeRunIds: new Set<string>(),
    displayMessages: [],
    throwawayMode: false,
  }
}

function createDeferred<T>() {
  let resolve: (value: T) => void = function ignoreResolve() {}
  let reject: (reason?: unknown) => void = function ignoreReject() {}
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

describe('useChatMutations', function () {
  it('handles a failed send without leaving a rejected fire-and-forget promise', async function () {
    setChatBackend({
      sendMessage: vi.fn().mockRejectedValue(new Error('Network unavailable')),
    } as unknown as ChatBackend)
    const queryClient = new QueryClient()

    function Wrapper({ children }: { children: ReactNode }) {
      return (
        <QueryClientProvider client={queryClient}>
          {children}
        </QueryClientProvider>
      )
    }

    const { result } = renderHook(() => useChatMutations(createInput()), {
      wrapper: Wrapper,
    })

    await act(async function sendAndWait() {
      result.current.sendMessage({
        sessionKey: 'session-key',
        friendlyId: 'friendly-id',
        message: 'hello',
      })
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(result.current.streamError).toBe('Network unavailable')
  })

  it.each([
    ['a lost network response', new Error('Network unavailable')],
    ['a server error', new ApiError({ message: 'Server failed', status: 500 })],
    ['a gateway timeout', new ApiError({ message: 'Timed out', status: 408 })],
  ])(
    'reuses the original creation request after %s',
    async function (_, failure) {
      const createConversation = vi
        .fn()
        .mockRejectedValueOnce(failure)
        .mockResolvedValueOnce({
          key: 'session-key',
          sessionKey: 'session-key',
          friendlyId: 'friendly-id',
        })
      setChatBackend({ createConversation } as unknown as ChatBackend)
      const queryClient = new QueryClient()

      function Wrapper({ children }: { children: ReactNode }) {
        return (
          <QueryClientProvider client={queryClient}>
            {children}
          </QueryClientProvider>
        )
      }

      const { result } = renderHook(() => useChatMutations(createInput()), {
        wrapper: Wrapper,
      })
      const attachment = {
        id: 'attachment-1',
        file: new File([], 'image.png', { type: 'image/png' }),
        preview: null,
        type: 'image' as const,
        base64: 'original-image-bytes',
      }

      await act(async function failFirstAttempt() {
        result.current.send('hello', {
          reset: vi.fn(),
          setValue: vi.fn(),
          attachments: [attachment],
        })
        await Promise.resolve()
        await Promise.resolve()
      })
      await act(async function retryAndWait() {
        result.current.send('hello', { reset: vi.fn(), setValue: vi.fn() })
        await Promise.resolve()
        await Promise.resolve()
      })

      const firstRequest = createConversation.mock.calls[0]?.[0]
      const retriedRequest = createConversation.mock.calls[1]?.[0]
      expect(createConversation).toHaveBeenCalledTimes(2)
      expect(retriedRequest?.idempotencyKey).toBe(firstRequest?.idempotencyKey)
      expect(retriedRequest?.clientId).toBe(firstRequest?.clientId)
      expect(retriedRequest?.attachments).toEqual([
        { mimeType: 'image/png', content: 'original-image-bytes' },
      ])
    },
  )

  it('uses a fresh key for a new submission after a definitive rejection', async function () {
    const createConversation = vi
      .fn()
      .mockRejectedValueOnce(
        new ApiError({ message: 'Invalid request', status: 400 }),
      )
      .mockRejectedValueOnce(
        new ApiError({ message: 'Invalid request', status: 400 }),
      )
      .mockResolvedValueOnce({
        key: 'session-key',
        sessionKey: 'session-key',
        friendlyId: 'friendly-id',
      })
    setChatBackend({ createConversation } as unknown as ChatBackend)
    const queryClient = new QueryClient()

    function Wrapper({ children }: { children: ReactNode }) {
      return (
        <QueryClientProvider client={queryClient}>
          {children}
        </QueryClientProvider>
      )
    }

    const { result } = renderHook(() => useChatMutations(createInput()), {
      wrapper: Wrapper,
    })

    await act(async function rejectFirstAttempt() {
      result.current.send('hello', { reset: vi.fn(), setValue: vi.fn() })
      await Promise.resolve()
      await Promise.resolve()
    })
    await act(async function submitNewDraft() {
      result.current.send('hello', { reset: vi.fn(), setValue: vi.fn() })
      await Promise.resolve()
      await Promise.resolve()
    })
    await act(async function retryRejectedDraft() {
      result.current.handleRetryLastMessage()
      await Promise.resolve()
      await Promise.resolve()
    })

    const firstRequest = createConversation.mock.calls[0]?.[0]
    const secondRequest = createConversation.mock.calls[1]?.[0]
    const retriedRequest = createConversation.mock.calls[2]?.[0]
    expect(secondRequest?.idempotencyKey).not.toBe(firstRequest?.idempotencyKey)
    expect(secondRequest?.clientId).not.toBe(firstRequest?.clientId)
    expect(retriedRequest?.idempotencyKey).not.toBe(
      secondRequest?.idempotencyKey,
    )
    expect(retriedRequest?.message).toBe(firstRequest?.message)
  })

  it('restores original attachments on the optimistic retry message', async function () {
    const queryClient = new QueryClient()
    const retryImages: Array<unknown> = []
    const createConversation = vi
      .fn()
      .mockRejectedValueOnce(new Error('Network unavailable'))
      .mockImplementationOnce(function inspectRetry() {
        const history = queryClient.getQueryData<{
          messages: Array<{
            content: Array<{ type: string; source?: unknown }>
          }>
        }>(chatQueryKeys.history('new', 'new'))
        retryImages.push(history?.messages.at(-1)?.content[0]?.source)
        return Promise.resolve({
          key: 'session-key',
          sessionKey: 'session-key',
          friendlyId: 'friendly-id',
        })
      })
    setChatBackend({ createConversation } as unknown as ChatBackend)

    function Wrapper({ children }: { children: ReactNode }) {
      return (
        <QueryClientProvider client={queryClient}>
          {children}
        </QueryClientProvider>
      )
    }

    const { result } = renderHook(() => useChatMutations(createInput()), {
      wrapper: Wrapper,
    })
    const attachment = {
      id: 'attachment-1',
      file: new File([], 'image.png', { type: 'image/png' }),
      preview: null,
      type: 'image' as const,
      base64: 'original-image-bytes',
    }

    await act(async function failFirstAttempt() {
      result.current.send('hello', {
        reset: vi.fn(),
        setValue: vi.fn(),
        attachments: [attachment],
      })
      await Promise.resolve()
      await Promise.resolve()
    })
    await act(async function retryAndWait() {
      result.current.handleRetryLastMessage()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(retryImages).toEqual([
      { type: 'base64', media_type: 'image/png', data: 'original-image-bytes' },
    ])
  })

  it('ignores stale creation success and finalization after starting a fresh chat', async function () {
    const first = createDeferred<{
      key: string
      sessionKey: string
      friendlyId: string
    }>()
    const second = createDeferred<{
      key: string
      sessionKey: string
      friendlyId: string
    }>()
    const createConversation = vi
      .fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)
    setChatBackend({ createConversation } as unknown as ChatBackend)
    const queryClient = new QueryClient()
    const onSessionResolved = vi.fn()

    function Wrapper({ children }: { children: ReactNode }) {
      return (
        <QueryClientProvider client={queryClient}>
          {children}
        </QueryClientProvider>
      )
    }

    const { result } = renderHook(
      () => useChatMutations({ ...createInput(), onSessionResolved }),
      { wrapper: Wrapper },
    )
    const firstGeneration = useConversationSettingsStore.getState().generation

    act(function beginFirstCreation() {
      result.current.send('abandoned', {
        reset: vi.fn(),
        setValue: vi.fn(),
      })
    })
    act(function startFreshChat() {
      beginFreshNewChat()
    })
    act(function beginCurrentCreation() {
      result.current.send('current', { reset: vi.fn(), setValue: vi.fn() })
    })

    await act(async function resolveAbandonedCreation() {
      first.resolve({
        key: 'old-key',
        sessionKey: 'old-key',
        friendlyId: 'old-friendly-id',
      })
      await first.promise
      await Promise.resolve()
    })

    expect(onSessionResolved).not.toHaveBeenCalled()
    expect(result.current.creatingSession).toBe(true)
    expect(useConversationSettingsStore.getState().generation).toBe(
      firstGeneration + 1,
    )

    await act(async function resolveCurrentCreation() {
      second.resolve({
        key: 'current-key',
        sessionKey: 'current-key',
        friendlyId: 'current-friendly-id',
      })
      await second.promise
      await Promise.resolve()
    })

    expect(onSessionResolved).toHaveBeenCalledTimes(1)
    expect(onSessionResolved).toHaveBeenCalledWith({
      sessionKey: 'current-key',
      friendlyId: 'current-friendly-id',
    })
    expect(result.current.creatingSession).toBe(false)
  })

  it('ignores stale creation failure after starting a fresh chat', async function () {
    const pending = createDeferred<never>()
    const createConversation = vi.fn().mockReturnValue(pending.promise)
    setChatBackend({ createConversation } as unknown as ChatBackend)
    const queryClient = new QueryClient()

    function Wrapper({ children }: { children: ReactNode }) {
      return (
        <QueryClientProvider client={queryClient}>
          {children}
        </QueryClientProvider>
      )
    }

    const setValue = vi.fn()
    const finishGeneration = vi.fn()
    const input = createInput()
    input.finishGeneration = finishGeneration
    const { result } = renderHook(() => useChatMutations(input), {
      wrapper: Wrapper,
    })

    act(function beginCreation() {
      result.current.send('abandoned', { reset: vi.fn(), setValue })
    })
    act(function startFreshChat() {
      beginFreshNewChat()
    })

    await act(async function rejectAbandonedCreation() {
      pending.reject(new Error('Old request failed'))
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(setValue).not.toHaveBeenCalled()
    expect(result.current.streamError).toBeNull()
    expect(result.current.creatingSession).toBe(false)
    expect(finishGeneration).not.toHaveBeenCalled()
  })

  it('shows a conversation creation failure and restores the draft', async function () {
    const createConversation = vi
      .fn()
      .mockRejectedValue(new Error('Creation failed'))
    setChatBackend({ createConversation } as unknown as ChatBackend)
    const queryClient = new QueryClient()

    function Wrapper({ children }: { children: ReactNode }) {
      return (
        <QueryClientProvider client={queryClient}>
          {children}
        </QueryClientProvider>
      )
    }

    const { result } = renderHook(() => useChatMutations(createInput()), {
      wrapper: Wrapper,
    })
    const setValue = vi.fn()

    await act(async function submitAndWait() {
      result.current.send('hello', { reset: vi.fn(), setValue })
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(setValue).toHaveBeenCalledWith('hello')
    expect(result.current.streamError).toBe('Creation failed')
    expect(result.current.creatingSession).toBe(false)
  })
})
