// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { ConversationShortcuts } from './conversation-shortcuts'
import type { ConversationTurn } from '../types'

afterEach(function reset() {
  cleanup()
  vi.unstubAllGlobals()
})

it('copies the last assistant turn or its last code block from inside a textarea', async function () {
  const writeText = vi.fn().mockResolvedValue(undefined)
  vi.stubGlobal('navigator', {
    clipboard: { writeText },
    platform: 'Linux',
    userAgent: 'Linux',
  })
  const messages: Array<ConversationTurn> = [
    { role: 'assistant', content: [{ type: 'text', text: 'earlier' }] },
    {
      role: 'assistant',
      content: [
        { type: 'text', text: 'Response\n```js\nfirst\n```\n```sh\nlast\n```' },
      ],
    },
    { role: 'user', content: [{ type: 'text', text: 'question' }] },
  ]
  const { rerender } = render(
    <>
      <textarea aria-label="Composer" />
      <ConversationShortcuts messages={messages} />
    </>,
  )
  const prompt = screen.getByRole('textbox')
  fireEvent.keyDown(prompt, {
    key: 'C',
    code: 'KeyC',
    ctrlKey: true,
    shiftKey: true,
  })
  await vi.waitFor(function copied() {
    expect(writeText).toHaveBeenLastCalledWith(
      'Response\n```js\nfirst\n```\n```sh\nlast\n```',
    )
  })
  await waitFor(function feedback() {
    expect(screen.getByRole('status').textContent).toBe('Response copied')
  })
  fireEvent.keyDown(prompt, {
    key: ':',
    code: 'Semicolon',
    ctrlKey: true,
    shiftKey: true,
  })
  await vi.waitFor(function copied() {
    expect(writeText).toHaveBeenLastCalledWith('last')
  })
  await waitFor(function feedback() {
    expect(screen.getByRole('status').textContent).toBe('Code copied')
  })
  rerender(
    <>
      <textarea aria-label="Composer" />
      <ConversationShortcuts
        messages={[
          { role: 'assistant', content: [{ type: 'text', text: 'No code' }] },
        ]}
      />
    </>,
  )
  fireEvent.keyDown(prompt, {
    key: ':',
    code: 'Semicolon',
    ctrlKey: true,
    shiftKey: true,
  })
  expect(writeText).toHaveBeenCalledTimes(2)
  await vi.waitFor(
    function cleared() {
      expect(screen.getByRole('status').textContent).toBe('')
    },
    { timeout: 2000 },
  )
})
