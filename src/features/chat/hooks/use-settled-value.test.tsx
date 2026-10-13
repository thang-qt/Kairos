// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useSettledValue } from './use-settled-value'

const OPTIONS = { minDwellMs: 2000, settleMs: 800 }

beforeEach(function () {
  vi.useFakeTimers()
})

afterEach(function () {
  vi.useRealTimers()
})

it('holds each value and skips short-lived intermediate values', function () {
  const view = renderHook(({ value }) => useSettledValue(value, OPTIONS), {
    initialProps: { value: 'Thinking…' },
  })
  expect(view.result.current).toBe('Thinking…')

  view.rerender({ value: 'Searched “a”' })
  act(() => void vi.advanceTimersByTime(1000))
  view.rerender({ value: 'Searched “b”' })
  act(() => void vi.advanceTimersByTime(900))
  expect(view.result.current).toBe('Thinking…')

  act(() => void vi.advanceTimersByTime(100))
  expect(view.result.current).toBe('Searched “b”')

  view.rerender({ value: 'Read example.com' })
  act(() => void vi.advanceTimersByTime(1999))
  expect(view.result.current).toBe('Searched “b”')
  act(() => void vi.advanceTimersByTime(1))
  expect(view.result.current).toBe('Read example.com')
})
