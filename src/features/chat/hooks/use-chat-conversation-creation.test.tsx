// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  defaultConversationSettings,
  useConversationSettingsStore,
} from '../conversation-settings'
import { setChatBackend } from '@/lib/chat-backend'
import { useChatConversationCreation } from './use-chat-conversation-creation'

import type { ChatBackend } from '@/lib/chat-backend'
import type { ReactNode } from 'react'

vi.mock('@tanstack/react-router', function () {
  return { useNavigate: () => vi.fn(() => Promise.resolve()) }
})

afterEach(function resetBackend() {
  setChatBackend(null as unknown as ChatBackend)
})

describe('useChatConversationCreation', function () {
  it('reuses the original idempotency key and attachments after an uncertain failure', async function () {
    const createConversation = vi
      .fn()
      .mockRejectedValueOnce(new Error('Network unavailable'))
      .mockResolvedValueOnce({
        key: 'session-key',
        sessionKey: 'session-key',
        friendlyId: 'friendly-id',
      })
    setChatBackend({ createConversation } as unknown as ChatBackend)
    const queryClient = new QueryClient()
    const newChatGeneration = useConversationSettingsStore.getState().generation

    function Wrapper({ children }: { children: ReactNode }) {
      return (
        <QueryClientProvider client={queryClient}>
          {children}
        </QueryClientProvider>
      )
    }

    const { result } = renderHook(
      () =>
        useChatConversationCreation({
          queryClient,
          newChatGeneration,
          conversationSettings: defaultConversationSettings,

          beginGeneration: vi.fn(),
          finishGeneration: vi.fn(),
          startRun: vi.fn(),
          setSending: vi.fn(),
          setCreatingSession: vi.fn(),
          setStreamError: vi.fn(),
          setPinToTop: vi.fn(),
        }),
      { wrapper: Wrapper },
    )
    const attachment = {
      id: 'attachment-1',
      file: new File([], 'image.png', { type: 'image/png' }),
      preview: null,
      type: 'image' as const,
      base64: 'image-bytes',
    }

    await act(async function failFirstAttempt() {
      result.current.createConversation('hello', [attachment], {
        reset: vi.fn(),
        setValue: vi.fn(),
      })
      await Promise.resolve()
      await Promise.resolve()
    })
    await act(async function retryAndWait() {
      result.current.createConversation('hello', undefined, {
        reset: vi.fn(),
        setValue: vi.fn(),
      })
      await Promise.resolve()
      await Promise.resolve()
    })

    const firstRequest = createConversation.mock.calls[0]?.[0]
    const retriedRequest = createConversation.mock.calls[1]?.[0]
    expect(firstRequest?.settings).toEqual(defaultConversationSettings)
    expect(firstRequest?.model).toBeUndefined()
    expect(firstRequest?.advanced).toBeUndefined()
    expect(retriedRequest?.idempotencyKey).toBe(firstRequest?.idempotencyKey)
    expect(retriedRequest?.clientId).toBe(firstRequest?.clientId)
    expect(retriedRequest?.attachments).toEqual([
      { mimeType: 'image/png', content: 'image-bytes' },
    ])
  })
})
