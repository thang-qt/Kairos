// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { ShortcutsHelpDialog } from './shortcuts-help-dialog'
import { shortcutGroups, shortcutRegistry } from '@/lib/shortcuts'

afterEach(cleanup)

it('renders every registry entry once in its group with keyboard hints', async function () {
  render(<ShortcutsHelpDialog open onOpenChange={function noop() {}} />)
  await screen.findByRole('dialog')
  for (const entry of shortcutRegistry) {
    expect(screen.getByText(entry.description)).toBeTruthy()
    const row = document.querySelector(`[data-shortcut-id="${entry.id}"]`)
    expect(row?.querySelector('kbd')).toBeTruthy()
  }
  expect(document.querySelectorAll('[data-shortcut-id]')).toHaveLength(
    shortcutRegistry.length,
  )
  for (const group of shortcutGroups)
    expect(screen.getByText(group)).toBeTruthy()
})
