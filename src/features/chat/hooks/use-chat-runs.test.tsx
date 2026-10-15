// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useChatRuns } from './use-chat-runs'

beforeEach(function () {
  window.localStorage.clear()
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
