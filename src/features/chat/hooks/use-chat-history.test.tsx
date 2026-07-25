// @vitest-environment jsdom

import { renderHook } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, expect, it } from 'vitest'

import { useChatHistory } from './use-chat-history'
import { chatQueryKeys } from '../chat-queries'

import type { ReactNode } from 'react'

describe('useChatHistory', function () {
  it('reads new conversation messages from the in-memory new-chat cache', function () {
    const queryClient = new QueryClient()
    queryClient.setQueryData(chatQueryKeys.history('new', 'new'), {
      sessionKey: 'new',
      messages: [
        {
          id: 'temporary-message',
          role: 'assistant',
          content: [{ type: 'text', text: 'Not persisted' }],
        },
      ],
    })

    function Wrapper({ children }: { children: ReactNode }) {
      return (
        <QueryClientProvider client={queryClient}>
          {children}
        </QueryClientProvider>
      )
    }

    const { result } = renderHook(
      function renderHistoryHook() {
        return useChatHistory({
          activeFriendlyId: 'new',
          activeSessionKey: '',
          isNewChat: true,
          isRedirecting: false,
          activeExists: true,
          sessionsReady: true,
          queryClient,
        })
      },
      { wrapper: Wrapper },
    )

    expect(result.current.sessionKeyForHistory).toBe('new')
    expect(result.current.displayMessages).toHaveLength(1)
    expect(result.current.displayMessages[0]?.id).toBe('temporary-message')
  })
})
