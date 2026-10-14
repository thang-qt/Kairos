// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { MessageActionsBar } from './message-actions-bar'
import { MessageActionsSheet } from './message-actions-sheet'
import { MessageItem } from './message-item'
import { hasShortcutOverlay } from '@/lib/shortcut-events'

afterEach(function reset() {
  cleanup()
  vi.restoreAllMocks()
})

it('disables hidden hit targets and reveals them together for hover, focus, and coarse pointers', function () {
  const { rerender } = render(
    <MessageActionsBar text="answer" align="start" timestamp={1} />,
  )
  const row = screen.getByRole('button', {
    name: 'Copy message',
  }).parentElement!
  expect(row.classList.contains('opacity-0')).toBe(true)
  expect(row.classList.contains('pointer-events-none')).toBe(true)
  for (const variant of [
    'group-hover',
    'group-focus-within',
    'pointer-coarse',
  ]) {
    expect(row.classList.contains(`${variant}:opacity-100`)).toBe(true)
    expect(row.classList.contains(`${variant}:pointer-events-auto`)).toBe(true)
  }
  expect(
    screen
      .getByRole('button', { name: 'Copy message' })
      .classList.contains('pointer-coarse:size-10'),
  ).toBe(true)
  rerender(
    <MessageActionsBar
      text="answer"
      align="start"
      timestamp={1}
      forceVisible
    />,
  )
  expect(row.classList.contains('opacity-100')).toBe(true)
  expect(row.classList.contains('pointer-events-auto')).toBe(true)
  expect(row.classList.contains('pointer-events-none')).toBe(false)
  rerender(
    <MessageActionsBar
      text="answer"
      align="start"
      timestamp={1}
      forceVisible
      available={false}
    />,
  )
  expect(row.parentElement!.hasAttribute('inert')).toBe(true)
  expect(row.classList.contains('pointer-events-none')).toBe(true)
  expect(row.classList.contains('pointer-coarse:pointer-events-auto')).toBe(
    false,
  )
})

it('opens one shared sheet for the selected user message, copies, and restores focus', async function () {
  const writeText = vi.fn().mockResolvedValue(undefined)
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText },
  })
  render(
    <MessageActionsSheet>
      <MessageActionsBar text="first" align="end" timestamp={1} />
      <MessageActionsBar text="selected" align="end" timestamp={1} />
    </MessageActionsSheet>,
  )
  const more = screen.getAllByRole('button', {
    name: 'More message actions',
  })[1]
  expect(more.parentElement!.classList.contains('pointer-fine:hidden')).toBe(
    true,
  )
  expect(more.parentElement!.classList.contains('pointer-coarse:flex')).toBe(
    true,
  )
  const inlineCopy = screen.getAllByRole('button', { name: 'Copy message' })[1]
  expect(
    inlineCopy.parentElement!.classList.contains('pointer-coarse:hidden'),
  ).toBe(true)
  more.focus()
  fireEvent.click(more)
  const dialog = await screen.findByRole('dialog', { name: 'Message actions' })
  expect(screen.getAllByRole('dialog')).toHaveLength(1)
  expect(hasShortcutOverlay()).toBe(true)
  await waitFor(function focusInside() {
    expect(dialog.contains(document.activeElement)).toBe(true)
  })
  fireEvent.click(within(dialog).getByRole('button', { name: 'Copy' }))
  expect(writeText).toHaveBeenCalledWith('selected')
  await waitFor(function closed() {
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(more)
    expect(hasShortcutOverlay()).toBe(false)
  })
})

it('uses the existing user message handlers for Delete, Fork, and Edit', async function () {
  const onDelete = vi.fn()
  const onClone = vi.fn()
  const onEdit = vi.fn()
  render(
    <MessageActionsSheet>
      <MessageItem
        message={{
          id: 'user-1',
          role: 'user',
          timestamp: 1,
          content: [{ type: 'text', text: 'question' }],
        }}
        modelLabelById={new Map()}
        onDelete={onDelete}
        onClone={onClone}
        onEdit={onEdit}
        isLastUser
      />
    </MessageActionsSheet>,
  )
  const more = screen.getByRole('button', { name: 'More message actions' })
  fireEvent.click(more)
  fireEvent.click(
    within(await screen.findByRole('dialog')).getByRole('button', {
      name: 'Delete',
    }),
  )
  expect(onDelete).toHaveBeenCalledWith('user-1', 'question')
  await waitFor(function closed() {
    expect(screen.queryByRole('dialog')).toBeNull()
  })
  fireEvent.click(more)
  fireEvent.click(
    within(await screen.findByRole('dialog')).getByRole('button', {
      name: 'Fork',
    }),
  )
  expect(onClone).toHaveBeenCalledWith(
    expect.objectContaining({ id: 'user-1' }),
    'question',
    undefined,
  )
  await waitFor(function closed() {
    expect(screen.queryByRole('dialog')).toBeNull()
  })
  expect(document.querySelector('[data-edit-user-message]')).toBeTruthy()
  fireEvent.click(more)
  fireEvent.click(
    within(await screen.findByRole('dialog')).getByRole('button', {
      name: 'Edit',
    }),
  )
  await waitFor(function closed() {
    expect(screen.queryByRole('dialog')).toBeNull()
  })
  expect(screen.getByRole('textbox')).toBeTruthy()
})

it('dismisses the sheet with Escape', async function () {
  render(
    <MessageActionsSheet>
      <MessageActionsBar text="question" align="end" timestamp={1} />
    </MessageActionsSheet>,
  )
  fireEvent.click(screen.getByRole('button', { name: 'More message actions' }))
  const dialog = await screen.findByRole('dialog')
  fireEvent.keyDown(dialog, { key: 'Escape', code: 'Escape' })
  await waitFor(function closed() {
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})

it('dismisses the sheet when the scrim is tapped', async function () {
  render(
    <MessageActionsSheet>
      <MessageActionsBar text="question" align="end" timestamp={1} />
    </MessageActionsSheet>,
  )
  fireEvent.click(screen.getByRole('button', { name: 'More message actions' }))
  await screen.findByRole('dialog')
  const scrim = document.querySelector('.fixed.inset-0')!
  fireEvent.mouseDown(scrim, { button: 0 })
  fireEvent.mouseUp(scrim, { button: 0 })
  fireEvent.click(scrim, { button: 0 })
  await waitFor(function closed() {
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
