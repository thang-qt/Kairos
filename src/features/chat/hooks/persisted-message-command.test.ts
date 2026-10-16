import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'

import { chatQueryKeys } from '../chat-queries'
import { setChatBackend } from '@/lib/chat-backend'
import { ApiError } from '@/lib/api-client'
import { sendPersistedMessage } from './persisted-message-command'

import type { SetStateAction } from 'react'
import type { ChatBackend } from '@/lib/chat-backend'
import type { RetryableNetworkSend } from './persisted-message-command'

describe('sendPersistedMessage', function () {
  it('preserves retry identity and marks the optimistic turn failed on network errors', async function () {
    const sendMessage = vi
      .fn()
      .mockRejectedValue(new Error('Network unavailable'))
    setChatBackend({ sendMessage } as unknown as ChatBackend)
    const queryClient = new QueryClient()
    const retryable = { current: null as RetryableNetworkSend | null }
    const dependencies = {
      queryClient,
      resolvedConversationModel: 'model-default',
      resolvedSystemPrompt: '',
      resolvedWebSearch: false,
      resolvedMathTools: false,
      beginGeneration: vi.fn(),
      finishGeneration: vi.fn(),
      startRun: vi.fn(),
      refreshHistory: vi.fn(),
      setPinToTop: vi.fn(),
      setSending: vi.fn(),
      setStreamError: vi.fn(),
      setRetryableNetworkSend: function setRetryableNetworkSend(
        update: SetStateAction<RetryableNetworkSend | null>,
      ) {
        retryable.current =
          typeof update === 'function' ? update(retryable.current) : update
      },
    }

    sendPersistedMessage(
      {
        sessionKey: 'session-key',
        friendlyId: 'friendly-id',
        message: 'hello',
        model: 'model-custom',
      },
      dependencies,
    )
    await Promise.resolve()
    await Promise.resolve()

    const request = (
      sendMessage.mock.calls[0] as unknown as
        | [Parameters<ChatBackend['sendMessage']>[0]]
        | undefined
    )?.[0]
    const history = queryClient.getQueryData<{
      messages: Array<{ status?: string; clientId?: string }>
    }>(chatQueryKeys.history('friendly-id', 'session-key'))
    expect(retryable.current?.idempotencyKey).toBe(request?.idempotencyKey)
    expect(retryable.current?.clientId).toBe(request?.clientId)
    expect(retryable.current?.model).toBe('model-custom')
    expect(history?.messages.at(-1)).toMatchObject({
      status: 'error',
      clientId: request?.clientId,
    })
    expect(dependencies.finishGeneration).toHaveBeenCalledOnce()
    expect(dependencies.setStreamError).toHaveBeenCalledWith(
      'Network unavailable',
    )
  })

  it('does not offer a definitive API rejection as a network retry', async function () {
    const sendMessage = vi
      .fn()
      .mockRejectedValue(
        new ApiError({ message: 'Invalid request', status: 400 }),
      )
    setChatBackend({ sendMessage } as unknown as ChatBackend)
    const queryClient = new QueryClient()
    const retryable = { current: null as RetryableNetworkSend | null }
    const dependencies = {
      queryClient,
      resolvedConversationModel: 'model-default',
      resolvedSystemPrompt: '',
      resolvedWebSearch: false,
      resolvedMathTools: false,
      beginGeneration: vi.fn(),
      finishGeneration: vi.fn(),
      startRun: vi.fn(),
      refreshHistory: vi.fn(),
      setPinToTop: vi.fn(),
      setSending: vi.fn(),
      setStreamError: vi.fn(),
      setRetryableNetworkSend: function setRetryableNetworkSend(
        update: SetStateAction<RetryableNetworkSend | null>,
      ) {
        retryable.current =
          typeof update === 'function' ? update(retryable.current) : update
      },
    }

    sendPersistedMessage(
      {
        sessionKey: 'session-key',
        friendlyId: 'friendly-id',
        message: 'hello',
      },
      dependencies,
    )
    await Promise.resolve()
    await Promise.resolve()

    expect(retryable.current).toBeNull()
    expect(dependencies.setStreamError).toHaveBeenCalledWith('Invalid request')
  })
})
