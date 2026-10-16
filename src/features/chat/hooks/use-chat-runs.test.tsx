// @vitest-environment jsdom

import { act, render, renderHook } from '@testing-library/react'
import { memo } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useChatRuns } from './use-chat-runs'

beforeEach(function () {
  window.localStorage.clear()
})

afterEach(function () {
  vi.useRealTimers()
})

describe('useChatRuns active run lifecycle', function () {
  it('resets active run IDs when the session scope changes', function () {
    const refreshHistory = vi.fn()
    const { result, rerender } = renderHook(
      ({ scopeKey }) => useChatRuns({ refreshHistory, scopeKey }),
      { initialProps: { scopeKey: 'session-a' } },
    )

    act(() => result.current.startRun('run-1'))
    expect(result.current.activeRunIds.has('run-1')).toBe(true)

    rerender({ scopeKey: 'session-b' })

    expect(result.current.activeRunIds.size).toBe(0)
    expect(result.current.waitingForResponse).toBe(false)
  })

  it('clears stale active run IDs from a reconcile snapshot', function () {
    const refreshHistory = vi.fn()
    const { result } = renderHook(() =>
      useChatRuns({ refreshHistory, scopeKey: 'session-a' }),
    )

    act(() => result.current.startRun('run-1'))
    act(() => result.current.reconcileActiveRunIds([]))

    expect(result.current.activeRunIds.size).toBe(0)
    expect(result.current.waitingForResponse).toBe(false)
  })

  it('keeps a genuinely active long-running run from reconcile', function () {
    const refreshHistory = vi.fn()
    const { result } = renderHook(() =>
      useChatRuns({ refreshHistory, scopeKey: 'session-a' }),
    )

    act(() => result.current.startRun('run-1'))
    act(() => result.current.reconcileActiveRunIds(['run-1']))

    expect(result.current.activeRunIds.has('run-1')).toBe(true)
    expect(result.current.waitingForResponse).toBe(true)
  })

  it('keeps active run state stable when a repeated delta only refreshes the watchdog', function () {
    vi.useFakeTimers()
    const refreshHistory = vi.fn()
    const renderActiveRunConsumer = vi.fn()
    const MemoActiveRunConsumer = memo(function ActiveRunConsumer({
      activeRunIds,
    }: {
      activeRunIds: ReadonlySet<string>
    }) {
      renderActiveRunConsumer()
      return <span>{activeRunIds.size}</span>
    })
    let startRun: (runId: string) => void = function noOp() {}
    let activeRunIds: ReadonlySet<string> = new Set()
    function Harness() {
      const state = useChatRuns({ refreshHistory, scopeKey: 'session-a' })
      startRun = state.startRun
      activeRunIds = state.activeRunIds
      return <MemoActiveRunConsumer activeRunIds={state.activeRunIds} />
    }
    render(<Harness />)

    act(() => startRun('run-1'))
    act(() => vi.advanceTimersByTime(60_000))
    const initialActiveRunIds = activeRunIds
    const renderCount = renderActiveRunConsumer.mock.calls.length

    act(() => startRun('run-1'))

    expect(activeRunIds).toBe(initialActiveRunIds)
    expect(renderActiveRunConsumer).toHaveBeenCalledTimes(renderCount)

    act(() => vi.advanceTimersByTime(59_999))
    expect(refreshHistory).not.toHaveBeenCalled()
    expect(activeRunIds.has('run-1')).toBe(true)

    act(() => vi.advanceTimersByTime(1))
    expect(activeRunIds.has('run-1')).toBe(true)
    const refreshCount = refreshHistory.mock.calls.length

    act(() => vi.advanceTimersByTime(59_999))
    expect(refreshHistory).toHaveBeenCalledTimes(refreshCount)
    expect(activeRunIds.has('run-1')).toBe(true)

    act(() => vi.advanceTimersByTime(1))
    expect(refreshHistory.mock.calls.length).toBeGreaterThan(refreshCount)
    expect(activeRunIds.size).toBe(0)
  })
})

it('preserves the active generation when a new draft becomes a saved chat', function () {
  const refreshHistory = vi.fn()
  const { result, rerender } = renderHook(
    ({ scopeKey }) => useChatRuns({ refreshHistory, scopeKey }),
    { initialProps: { scopeKey: 'new' } },
  )
  act(function createConversation() {
    result.current.startRun('first-run')
    result.current.adoptScope('saved-session')
  })
  // The route can render the draft again while authentication/navigation waits.
  rerender({ scopeKey: 'new' })
  expect(result.current.waitingForResponse).toBe(true)
  rerender({ scopeKey: 'saved-session' })
  expect(result.current.activeRunIds.has('first-run')).toBe(true)
  expect(result.current.waitingForResponse).toBe(true)
  rerender({ scopeKey: 'another-session' })
  expect(result.current.activeRunIds.size).toBe(0)
  expect(result.current.waitingForResponse).toBe(false)
})
