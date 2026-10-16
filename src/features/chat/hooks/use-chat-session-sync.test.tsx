// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import {
  ChatSessionSync,
  createSessionListRefreshScheduler,
} from './use-chat-session-sync'
import { appQueryKeys } from '@/lib/app-api'

afterEach(function reset() {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  delete window.kairosDesktop
})

describe('session list refresh scheduling', function () {
  it('coalesces bursts and serializes invalidation while a refresh is active', async function () {
    vi.useFakeTimers()
    let finishFirstRefresh: () => void = function ignore() {}
    const firstRefresh = new Promise<void>(function pending(resolve) {
      finishFirstRefresh = resolve
    })
    const refresh = vi
      .fn<() => Promise<unknown>>()
      .mockReturnValueOnce(firstRefresh)
      .mockResolvedValue(undefined)
    const scheduler = createSessionListRefreshScheduler(refresh)

    act(function signalBurst() {
      scheduler.scheduleRefresh()
      scheduler.scheduleRefresh()
      scheduler.scheduleRefresh()
    })
    await act(async function waitForDebounce() {
      await vi.advanceTimersByTimeAsync(200)
    })
    expect(refresh).toHaveBeenCalledTimes(1)

    act(function signalWhileRefreshing() {
      scheduler.scheduleRefresh()
      scheduler.scheduleRefresh()
    })
    await act(async function finishRefresh() {
      finishFirstRefresh()
      await firstRefresh
      await Promise.resolve()
    })
    expect(refresh).toHaveBeenCalledTimes(1)

    await act(async function refreshDirtyState() {
      await vi.advanceTimersByTimeAsync(200)
    })
    expect(refresh).toHaveBeenCalledTimes(2)
    scheduler.dispose()
  })

  it('cancels a pending refresh when the subscription is disposed', async function () {
    vi.useFakeTimers()
    const refresh = vi.fn().mockResolvedValue(undefined)
    const scheduler = createSessionListRefreshScheduler(refresh)

    act(function scheduleAndDispose() {
      scheduler.scheduleRefresh()
      scheduler.dispose()
    })
    await act(async function advanceClock() {
      await vi.advanceTimersByTimeAsync(200)
    })

    expect(refresh).not.toHaveBeenCalled()
  })

  it('does not start a refresh after disposal between the timer and its microtask', async function () {
    vi.useFakeTimers()
    const refresh = vi.fn().mockResolvedValue(undefined)
    const scheduler = createSessionListRefreshScheduler(refresh)

    act(function runTimerThenDispose() {
      scheduler.scheduleRefresh()
      vi.advanceTimersByTime(200)
      scheduler.dispose()
    })
    await act(async function flushMicrotask() {
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(refresh).not.toHaveBeenCalled()
  })
})

describe('authenticated session list subscription', function () {
  it('closes the stream when the reactive user identity is cleared without fetching /me', function () {
    const sources: Array<FakeEventSource> = []

    class FakeEventSource {
      closed = false

      constructor(public url: string) {
        sources.push(this)
      }

      addEventListener() {}
      removeEventListener() {}
      close() {
        this.closed = true
      }
    }

    vi.stubGlobal('EventSource', FakeEventSource)
    const fetchCurrentUser = vi.fn()
    vi.stubGlobal('fetch', fetchCurrentUser)
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    })
    queryClient.setQueryData(appQueryKeys.me, {
      id: 'user-1',
      email: 'user@example.invalid',
      role: 'user',
      createdAt: 1,
    })

    function Wrapper({ children }: { children: ReactNode }) {
      return (
        <QueryClientProvider client={queryClient}>
          {children}
        </QueryClientProvider>
      )
    }

    render(<ChatSessionSync />, { wrapper: Wrapper })
    expect(sources).toHaveLength(1)
    expect(sources[0]?.url).toBe('/api/me/sessions/events')

    act(function switchIdentity() {
      queryClient.setQueryData(appQueryKeys.me, {
        id: 'user-2',
        email: 'other@example.invalid',
        role: 'user',
        createdAt: 2,
      })
    })
    expect(sources).toHaveLength(2)
    expect(sources[0]?.closed).toBe(true)
    expect(sources[1]?.closed).toBe(false)

    act(function clearIdentityOnLogout() {
      queryClient.removeQueries({ queryKey: appQueryKeys.me, exact: true })
    })

    expect(sources[1]?.closed).toBe(true)
    expect(fetchCurrentUser).not.toHaveBeenCalled()
  })

  it('does not connect from an unconfigured desktop shell', function () {
    const sources: Array<{ url: string }> = []

    class FakeDesktopEventSource {
      constructor(public url: string) {
        sources.push(this)
      }

      addEventListener() {}
      removeEventListener() {}
      close() {}
    }

    vi.stubGlobal('EventSource', FakeDesktopEventSource)
    window.kairosDesktop = {
      platform: 'linux',
      isDesktop: true,
      server: null,
      setServer: async function setServer() {
        return { ok: false, error: 'unreachable' }
      },
    }
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    })
    queryClient.setQueryData(appQueryKeys.me, {
      id: 'user-1',
      email: 'user@example.invalid',
      role: 'user',
      createdAt: 1,
    })

    function Wrapper({ children }: { children: ReactNode }) {
      return (
        <QueryClientProvider client={queryClient}>
          {children}
        </QueryClientProvider>
      )
    }

    render(<ChatSessionSync />, { wrapper: Wrapper })
    expect(sources).toHaveLength(0)
  })
})
