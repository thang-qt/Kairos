// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { SystemPromptField } from './system-prompt-field'

beforeEach(function setup() {
  vi.useFakeTimers()
})

afterEach(function teardown() {
  cleanup()
  vi.useRealTimers()
})

it('updates the draft immediately and saves only after typing pauses', function testDebounce() {
  const save = vi.fn()
  const view = render(
    <SystemPromptField value="" onChange={save} debounceMs={500} />,
  )
  const field = view.getByRole('textbox') as HTMLTextAreaElement
  fireEvent.change(field, { target: { value: 'Be' } })
  act(function advance() {
    vi.advanceTimersByTime(400)
  })
  fireEvent.change(field, { target: { value: 'Be concise' } })
  expect(field.value).toBe('Be concise')
  act(function advance() {
    vi.advanceTimersByTime(499)
  })
  expect(save).not.toHaveBeenCalled()
  act(function advance() {
    vi.advanceTimersByTime(1)
  })
  expect(save).toHaveBeenCalledExactlyOnceWith('Be concise')
})

it.each(['blur', 'unmount'])(
  'flushes pending edits on %s without duplicate saves',
  function testFlush(action) {
    const save = vi.fn()
    const view = render(
      <SystemPromptField value="Original" onChange={save} debounceMs={500} />,
    )
    const field = view.getByRole('textbox')
    fireEvent.change(field, { target: { value: '' } })
    if (action === 'blur') fireEvent.blur(field)
    else view.unmount()
    expect(save).toHaveBeenCalledExactlyOnceWith('')
    act(function advance() {
      vi.runAllTimers()
    })
    expect(save).toHaveBeenCalledTimes(1)
  },
)

it('uses the latest save callback and follows acknowledged server values', function testReconciliation() {
  const firstSave = vi.fn()
  const latestSave = vi.fn()
  const view = render(
    <SystemPromptField
      value="Original"
      onChange={firstSave}
      debounceMs={500}
    />,
  )
  const field = view.getByRole('textbox') as HTMLTextAreaElement
  fireEvent.change(field, { target: { value: 'Draft' } })
  view.rerender(
    <SystemPromptField
      value="Original"
      onChange={latestSave}
      debounceMs={500}
    />,
  )
  act(function advance() {
    vi.advanceTimersByTime(500)
  })
  expect(firstSave).not.toHaveBeenCalled()
  expect(latestSave).toHaveBeenCalledExactlyOnceWith('Draft')
  view.rerender(
    <SystemPromptField value="Draft" onChange={latestSave} debounceMs={500} />,
  )
  view.rerender(
    <SystemPromptField
      value="External update"
      onChange={latestSave}
      debounceMs={500}
    />,
  )
  expect(field.value).toBe('External update')
})

it('keeps non-debounced consumers immediate', function testImmediate() {
  const save = vi.fn()
  const view = render(<SystemPromptField value="" onChange={save} />)
  fireEvent.change(view.getByRole('textbox'), { target: { value: 'Prompt' } })
  expect(save).toHaveBeenCalledExactlyOnceWith('Prompt')
})
