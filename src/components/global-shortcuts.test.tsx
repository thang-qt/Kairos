// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { GlobalShortcuts } from './global-shortcuts'

const { navigate } = vi.hoisted(function mocks() {
  return { navigate: vi.fn() }
})
vi.mock('@tanstack/react-router', function router() {
  return {
    useNavigate: function useNavigate() {
      return navigate
    },
  }
})
afterEach(function reset() {
  cleanup()
  navigate.mockClear()
})

it('supports sidebar, settings and help even inside a settings input', async function () {
  const toggle = vi.fn()
  render(
    <>
      <input aria-label="Setting" />
      <GlobalShortcuts onToggleSidebar={toggle} />
    </>,
  )
  const input = screen.getByRole('textbox')
  fireEvent.keyDown(input, {
    key: 'S',
    code: 'KeyS',
    ctrlKey: true,
    shiftKey: true,
  })
  expect(toggle).toHaveBeenCalledTimes(1)
  fireEvent.keyDown(input, { key: ',', ctrlKey: true })
  expect(navigate).toHaveBeenCalledWith({ to: '/settings' })
  fireEvent.keyDown(input, { key: '?', shiftKey: true })
  expect(screen.queryByRole('dialog')).toBeNull()
  fireEvent.keyDown(input, { key: '/', code: 'Slash', ctrlKey: true })
  expect(await screen.findByRole('dialog')).toBeTruthy()
  fireEvent.keyDown(input, {
    key: 'S',
    code: 'KeyS',
    ctrlKey: true,
    shiftKey: true,
  })
  expect(toggle).toHaveBeenCalledTimes(1)
})
