// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import { useChatSessions } from './use-chat-sessions'
import { ApiError } from '@/lib/api-client'

const { page, summary } = vi.hoisted(function mocks() {
  return { page: vi.fn(), summary: vi.fn() }
})
vi.mock('@/lib/chat-backend', function backend() {
  return {
    getChatBackend: function getBackend() {
      return { listConversationPage: page, getConversation: summary }
    },
  }
})
afterEach(function reset() {
  cleanup()
  vi.resetAllMocks()
})

function mount(activeFriendlyId = 'new') {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  })
  return renderHook(
    function sessions() {
      return useChatSessions({
        activeFriendlyId,
        isNewChat: activeFriendlyId === 'new',
      })
    },
    {
      wrapper: function Wrapper({ children }: { children: ReactNode }) {
        return (
          <QueryClientProvider client={client}>{children}</QueryClientProvider>
        )
      },
    },
  )
}

describe('paged chat sessions', function () {
  it('loads only the requested pages and deduplicates boundary rows', async function () {
    page
      .mockResolvedValueOnce({
        sessions: [
          { key: 'a', friendlyId: 'a', title: 'Synthetic recent chat' },
        ],
        nextCursor: 'next',
      })
      .mockResolvedValueOnce({
        sessions: [
          { key: 'a', friendlyId: 'a' },
          { key: 'b', friendlyId: 'b', title: 'Synthetic older chat' },
        ],
        nextCursor: null,
      })
    const hook = mount()
    await waitFor(function firstPage() {
      expect(hook.result.current.sessions).toHaveLength(1)
    })
    expect(page).toHaveBeenCalledOnce()
    expect(hook.result.current.hasMoreSessions).toBe(true)
    act(function nextPage() {
      hook.result.current.loadMoreSessions()
    })
    await waitFor(function secondPage() {
      expect(hook.result.current.sessions).toHaveLength(2)
    })
    expect(page.mock.calls[1][0]).toBe('next')
    expect(hook.result.current.hasMoreSessions).toBe(false)
  })

  it('resolves a linked older chat without downloading all preceding pages', async function () {
    page.mockResolvedValueOnce({
      sessions: [{ key: 'a', friendlyId: 'a' }],
      nextCursor: 'next',
    })
    let resolveSummary: (value: {
      key: string
      friendlyId: string
      title: string
    }) => void = function ignore() {}
    summary.mockImplementationOnce(function pending() {
      return new Promise(function wait(resolve) {
        resolveSummary = resolve
      })
    })
    const hook = mount('older')
    await waitFor(function lookupStarted() {
      expect(summary).toHaveBeenCalledOnce()
    })
    expect(hook.result.current.activeExists).toBe(true)
    act(function resolved() {
      resolveSummary({
        key: 'old-key',
        friendlyId: 'older',
        title: 'Synthetic linked chat',
      })
    })
    await waitFor(function active() {
      expect(hook.result.current.activeSessionKey).toBe('old-key')
    })
    expect(page).toHaveBeenCalledOnce()
    expect(hook.result.current.activeTitle).toBe('Synthetic linked chat')
  })

  it('keeps loaded chats usable when a later page fails and allows retry', async function () {
    page
      .mockResolvedValueOnce({
        sessions: [{ key: 'a', friendlyId: 'a' }],
        nextCursor: 'next',
      })
      .mockRejectedValueOnce(new Error('Synthetic network failure'))
      .mockResolvedValueOnce({
        sessions: [{ key: 'b', friendlyId: 'b' }],
        nextCursor: null,
      })
    const hook = mount()
    await waitFor(function ready() {
      expect(hook.result.current.hasMoreSessions).toBe(true)
    })
    act(function load() {
      hook.result.current.loadMoreSessions()
    })
    await waitFor(function failed() {
      expect(hook.result.current.sessionLoadError).toBeTruthy()
    })
    expect(hook.result.current.sessions).toHaveLength(1)
    expect(hook.result.current.sessionsError).toBeNull()
    expect(hook.result.current.sessionsReady).toBe(true)
    act(function retry() {
      hook.result.current.loadMoreSessions()
    })
    await waitFor(function recovered() {
      expect(hook.result.current.sessions).toHaveLength(2)
    })
  })

  it('marks a direct link missing only after its lookup returns 404', async function () {
    page.mockResolvedValueOnce({ sessions: [], nextCursor: null })
    summary.mockRejectedValueOnce(
      new ApiError({ message: 'Session not found.', status: 404 }),
    )
    const hook = mount('missing')
    await waitFor(function missing() {
      expect(hook.result.current.sessionsError).toBe('Session not found.')
    })
    expect(hook.result.current.activeExists).toBe(false)
  })
})
