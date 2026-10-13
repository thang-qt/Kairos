// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { expect, it } from 'vitest'
import { AssistantWork } from './assistant-work'

it('collapses completed work while retaining an expandable duration summary', function () {
  const view = render(
    <AssistantWork streaming durationMs={2500} toolCount={2}>
      <div>Tool result</div>
    </AssistantWork>,
  )
  const trigger = screen.getByRole('button', { name: 'Working…' })
  expect(trigger.getAttribute('aria-expanded')).toBe('true')
  view.rerender(
    <AssistantWork streaming={false} durationMs={2500} toolCount={2}>
      <div>Tool result</div>
    </AssistantWork>,
  )
  const finished = screen.getByRole('button', { name: 'Worked for 2.5s' })
  expect(finished.getAttribute('aria-expanded')).toBe('false')
  fireEvent.click(finished)
  expect(finished.getAttribute('aria-expanded')).toBe('true')
  view.unmount()
})
