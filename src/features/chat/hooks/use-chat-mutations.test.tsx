// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { defaultConversationSettings } from '../conversation-settings'
import { useChatMutations } from './use-chat-mutations'
import { setChatBackend } from '@/lib/chat-backend'

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
    resolvedSystemPrompt: '',
    resolvedWebSearch: false,
    resolvedMathTools: false,
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
      result.current.sendMessage('session-key', 'friendly-id', 'hello')
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(result.current.streamError).toBe('Network unavailable')
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
