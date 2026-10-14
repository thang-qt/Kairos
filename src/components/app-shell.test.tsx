// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { AppShell } from './app-shell'

beforeEach(function prepare() {
  localStorage.clear()
  Object.defineProperty(window, 'innerWidth', {
    configurable: true,
    writable: true,
    value: 1280,
  })
})
afterEach(function reset() {
  cleanup()
  vi.unstubAllGlobals()
})

function shell(
  isSidebarCollapsed = false,
  rightPanelWidth = 280,
  isMobile = false,
) {
  return (
    <AppShell
      isMobile={isMobile}
      isSidebarCollapsed={isSidebarCollapsed}
      sidebar={<div>Sessions</div>}
      header={null}
      rightPanelWidth={rightPanelWidth}
    >
      <div>Chat</div>
    </AppShell>
  )
}

function width(side: string) {
  return screen
    .getByRole('separator', { name: `Resize ${side} sidebar` })
    .getAttribute('aria-valuenow')
}

it('resizes both sides with keyboard, persists on commit and resets to panel defaults', function () {
  const view = render(shell())
  fireEvent.keyDown(
    screen.getByRole('separator', { name: 'Resize left sidebar' }),
    { key: 'ArrowRight', shiftKey: true },
  )
  expect(width('left')).toBe('340')
  expect(localStorage.getItem('kairos-sidebar-widths')).toBeNull()
  fireEvent.keyUp(
    screen.getByRole('separator', { name: 'Resize left sidebar' }),
  )
  fireEvent.keyDown(
    screen.getByRole('separator', { name: 'Resize right sidebar' }),
    { key: 'ArrowLeft' },
  )
  fireEvent.keyUp(
    screen.getByRole('separator', { name: 'Resize right sidebar' }),
  )
  view.unmount()
  const restored = render(shell(false, 360))
  expect(width('left')).toBe('340')
  expect(width('right')).toBe('290')
  fireEvent.doubleClick(
    screen.getByRole('separator', { name: 'Resize right sidebar' }),
  )
  expect(width('right')).toBe('360')
  fireEvent.doubleClick(
    screen.getByRole('separator', { name: 'Resize left sidebar' }),
  )
  expect(width('left')).toBe('300')
  restored.rerender(shell(true, 0))
  expect(screen.queryByRole('separator')).toBeNull()
  const root = restored.container.firstElementChild as HTMLElement
  expect(root.style.getPropertyValue('--left-sidebar-width')).toBe('300px')
  expect(root.style.getPropertyValue('--right-sidebar-width')).toBe('360px')
})

it('bounds widths on window resize to preserve the main column and restores preferences when space returns', function () {
  localStorage.setItem(
    'kairos-sidebar-widths',
    JSON.stringify({ left: 480, right: 560 }),
  )
  render(shell())
  act(function shrink() {
    window.innerWidth = 800
    window.dispatchEvent(new Event('resize'))
  })
  expect(Number(width('left')) + Number(width('right'))).toBeLessThanOrEqual(
    481,
  )
  expect(
    Number(
      screen
        .getByRole('separator', { name: 'Resize left sidebar' })
        .getAttribute('aria-valuemax'),
    ),
  ).toBeLessThanOrEqual(240)
  act(function expand() {
    window.innerWidth = 1600
    window.dispatchEvent(new Event('resize'))
  })
  expect(width('left')).toBe('480')
  expect(width('right')).toBe('560')
})

it('keeps mobile drawers fixed without resize handles and recovers invalid stored widths', function () {
  localStorage.setItem('kairos-sidebar-widths', '{broken')
  const view = render(shell(false, 280, true))
  expect(screen.queryByRole('separator')).toBeNull()
  view.rerender(shell())
  expect(width('left')).toBe('300')
  expect(width('right')).toBe('280')
})

it('drags from the visible edge after viewport clamping and commits on release or cancellation', function () {
  vi.stubGlobal('PointerEvent', MouseEvent)
  localStorage.setItem(
    'kairos-sidebar-widths',
    JSON.stringify({ left: 480, right: 560 }),
  )
  window.innerWidth = 800
  const view = render(shell())
  const left = screen.getByRole('separator', { name: 'Resize left sidebar' })
  const right = screen.getByRole('separator', { name: 'Resize right sidebar' })
  left.setPointerCapture = vi.fn()
  right.setPointerCapture = vi.fn()
  const constrainedLeft = Number(width('left'))
  fireEvent.pointerDown(left, { button: 0, clientX: constrainedLeft })
  fireEvent.pointerMove(left, { clientX: constrainedLeft })
  expect(Number(width('left'))).toBe(constrainedLeft)
  fireEvent.pointerUp(left)
  act(function expandForDrag() {
    window.innerWidth = 1280
    window.dispatchEvent(new Event('resize'))
  })
  fireEvent.doubleClick(left)
  fireEvent.doubleClick(right)
  const initialLeft = Number(width('left'))
  fireEvent.pointerDown(left, { button: 0, clientX: initialLeft })
  fireEvent.pointerMove(left, { clientX: initialLeft - 20 })
  expect(Number(width('left'))).toBe(initialLeft - 20)
  fireEvent.pointerUp(left)
  expect(
    JSON.parse(localStorage.getItem('kairos-sidebar-widths') ?? '{}').left,
  ).toBe(initialLeft - 20)
  const initialRight = Number(width('right'))
  fireEvent.pointerDown(right, { button: 0, clientX: 500 })
  fireEvent.pointerMove(right, { clientX: 510 })
  expect(Number(width('right'))).toBe(initialRight - 10)
  fireEvent.pointerCancel(right)
  expect(
    JSON.parse(localStorage.getItem('kairos-sidebar-widths') ?? '{}').right,
  ).toBe(initialRight - 10)
  fireEvent.pointerMove(right, { clientX: 550 })
  expect(Number(width('right'))).toBe(initialRight - 10)
  expect(view.container.querySelector('.transition-none')).toBeNull()
})
