// @vitest-environment jsdom
import {
  cleanup,
  createEvent,
  fireEvent,
  render,
  screen,
} from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { ChatComposer } from './chat-composer'
import { MessageItem } from './message-item'
import { Dialog } from '@base-ui/react/dialog'

function noop() {}
afterEach(cleanup)

it('stops from the composer only while canStop is true and Escape is unclaimed', function () {
  const stop = vi.fn()
  const { rerender } = render(
    <ChatComposer
      onSubmit={noop}
      onStop={stop}
      isLoading={false}
      disabled={false}
      canStop={false}
    />,
  )
  const prompt = screen.getByRole('textbox')
  fireEvent.keyDown(prompt, { key: 'Escape' })
  expect(stop).not.toHaveBeenCalled()
  rerender(
    <ChatComposer
      onSubmit={noop}
      onStop={stop}
      isLoading={false}
      disabled={false}
      canStop
    />,
  )
  fireEvent.keyDown(prompt, { key: 'Escape' })
  expect(stop).toHaveBeenCalledTimes(1)
  const claimed = createEvent.keyDown(prompt, { key: 'Escape' })
  claimed.preventDefault()
  fireEvent(prompt, claimed)
  expect(stop).toHaveBeenCalledTimes(1)
  for (const role of ['dialog', 'alertdialog', 'menu', 'listbox']) {
    const overlay = document.createElement('div')
    overlay.setAttribute('role', role)
    document.body.append(overlay)
    fireEvent.keyDown(prompt, { key: 'Escape' })
    expect(stop).toHaveBeenCalledTimes(1)
    overlay.remove()
  }
  const popover = document.createElement('div')
  popover.dataset.shortcutOverlay = ''
  document.body.append(popover)
  fireEvent.keyDown(prompt, { key: 'Escape' })
  expect(stop).toHaveBeenCalledTimes(1)
  popover.remove()
  fireEvent.keyDown(prompt, { key: 'Escape' })
  expect(stop).toHaveBeenCalledTimes(2)
})

it('lets an actual dialog claim Escape without also stopping a response', async function () {
  const stop = vi.fn()
  const close = vi.fn()
  render(
    <>
      <ChatComposer
        onSubmit={noop}
        onStop={stop}
        isLoading={false}
        disabled={false}
        canStop
      />
      <Dialog.Root open onOpenChange={close}>
        <Dialog.Portal>
          <Dialog.Popup>
            <Dialog.Title>Rename</Dialog.Title>
            <input aria-label="Title" />
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>
    </>,
  )
  const title = await screen.findByRole('textbox', { name: 'Title' })
  fireEvent.keyDown(title, { key: 'Escape' })
  expect(close).toHaveBeenCalled()
  expect(stop).not.toHaveBeenCalled()
})

it('focuses with Shift+Escape without dismissing a menu, and respects a modal', function () {
  render(<ChatComposer onSubmit={noop} isLoading={false} disabled={false} />)
  const prompt = screen.getByRole('textbox')
  const overlay = document.createElement('button')
  overlay.setAttribute('role', 'menu')
  document.body.append(overlay)
  overlay.focus()
  const dismiss = vi.fn()
  overlay.addEventListener('keydown', dismiss)
  fireEvent.keyDown(overlay, { key: 'Escape', shiftKey: true })
  expect(document.activeElement).toBe(prompt)
  expect(dismiss).not.toHaveBeenCalled()
  overlay.setAttribute('role', 'dialog')
  overlay.focus()
  fireEvent.keyDown(overlay, { key: 'Escape', shiftKey: true })
  expect(document.activeElement).toBe(overlay)
  expect(dismiss).not.toHaveBeenCalled()
  overlay.remove()
})

it('ArrowUp opens the last user turn editor only from an empty focused composer', function () {
  const save = vi.fn()
  render(
    <>
      <MessageItem
        message={{
          id: 'first',
          role: 'user',
          content: [{ type: 'text', text: 'Earlier' }],
        }}
        modelLabelById={new Map()}
        onEdit={save}
      />
      <MessageItem
        message={{
          id: 'last',
          role: 'user',
          content: [{ type: 'text', text: 'Latest' }],
        }}
        modelLabelById={new Map()}
        onEdit={save}
      />
      <ChatComposer onSubmit={noop} isLoading={false} disabled={false} />
    </>,
  )
  const prompt = screen.getByPlaceholderText('Type a message…')
  prompt.focus()
  fireEvent.change(prompt, { target: { value: 'draft' } })
  expect(fireEvent.keyDown(prompt, { key: 'ArrowUp' })).toBe(true)
  expect(screen.queryByDisplayValue('Latest')).toBeNull()
  fireEvent.change(prompt, { target: { value: '' } })
  expect(fireEvent.keyDown(prompt, { key: 'ArrowUp', shiftKey: true })).toBe(
    true,
  )
  expect(screen.queryByDisplayValue('Latest')).toBeNull()
  const overlay = document.createElement('div')
  overlay.setAttribute('role', 'menu')
  document.body.append(overlay)
  expect(fireEvent.keyDown(prompt, { key: 'ArrowUp' })).toBe(true)
  overlay.remove()
  expect(fireEvent.keyDown(prompt, { key: 'ArrowUp' })).toBe(false)
  expect(screen.getByDisplayValue('Latest')).toBeTruthy()
  expect(screen.queryByDisplayValue('Earlier')).toBeNull()
  expect(save).not.toHaveBeenCalled()
})
