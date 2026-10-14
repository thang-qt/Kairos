// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { useShortcut } from './use-shortcut'
import type { ShortcutId } from './shortcuts'

afterEach(cleanup)
function Binding({
  id,
  onPress,
}: {
  id: ShortcutId
  onPress: (event: KeyboardEvent) => void
}) {
  useShortcut(id, onPress)
  return <textarea aria-label="Composer" />
}

it('matches shifted period, allows modifiers in the composer, and leaves menus in control', function () {
  const action = vi.fn(function action(event: KeyboardEvent) {
    event.preventDefault()
  })
  render(<Binding id="conversationPanel" onPress={action} />)
  const prompt = screen.getByRole('textbox')
  expect(
    fireEvent.keyDown(prompt, {
      key: '>',
      code: 'Period',
      ctrlKey: true,
      shiftKey: true,
    }),
  ).toBe(false)
  expect(action).toHaveBeenCalledTimes(1)
  const overlay = document.createElement('div')
  overlay.setAttribute('role', 'menu')
  document.body.append(overlay)
  expect(
    fireEvent.keyDown(prompt, {
      key: '>',
      code: 'Period',
      ctrlKey: true,
      shiftKey: true,
    }),
  ).toBe(true)
  expect(action).toHaveBeenCalledTimes(1)
  overlay.remove()
})

it('leaves F2 and single-key navigation alone in editable targets', function () {
  const action = vi.fn()
  const { rerender } = render(<Binding id="renameChat" onPress={action} />)
  const prompt = screen.getByRole('textbox')
  fireEvent.keyDown(prompt, { key: 'F2' })
  expect(action).not.toHaveBeenCalled()
  fireEvent.keyDown(document.body, { key: 'F2' })
  expect(action).toHaveBeenCalledTimes(1)
  rerender(<Binding id="scrollDown" onPress={action} />)
  fireEvent.keyDown(prompt, { key: 'j' })
  expect(action).toHaveBeenCalledTimes(1)
  fireEvent.keyDown(document.body, { key: 'j' })
  expect(action).toHaveBeenCalledTimes(2)
})
