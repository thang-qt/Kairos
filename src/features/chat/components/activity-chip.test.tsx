// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ActivityChip } from './activity-chip'
import { splitAssistantActivity } from './message-item-utils'
import type { ConversationTurn } from '../types'

describe('ActivityChip', function () {
  it('summarizes streaming and finished work and opens the panel', function () {
    const onOpen = vi.fn()
    const view = render(
      <ActivityChip
        streaming
        durationMs={2500}
        toolCount={2}
        hasThinking={false}
        onOpen={onOpen}
      />,
    )
    expect(screen.getByRole('button', { name: 'Working…' }))
    view.rerender(
      <ActivityChip
        streaming={false}
        durationMs={2500}
        toolCount={2}
        hasThinking={false}
        selected
        onOpen={onOpen}
      />,
    )
    const finished = screen.getByRole('button', {
      name: 'Worked for 2.5s',
    })
    expect(finished.getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(finished)
    expect(onOpen).toHaveBeenCalledOnce()
    view.unmount()
  })
})

describe('splitAssistantActivity', function () {
  const message: ConversationTurn = {
    role: 'assistant',
    content: [
      { type: 'thinking', thinking: 'plan' },
      { type: 'text', text: 'Let me check.' },
      { type: 'toolCall', id: 'call-1', name: 'read', arguments: {} },
      { type: 'text', text: 'Answer' },
    ],
  }

  it('keeps only the final answer in the main column', function () {
    const split = splitAssistantActivity(message, true, true)
    expect([...split.answerIndexes]).toEqual([3])
    expect(split.activityIndexes).toEqual([0, 1, 2])
    expect(split.toolCount).toBe(1)
    expect(split.hasThinking).toBe(true)
  })

  it('returns all text to the main column when tools and reasoning are hidden', function () {
    const split = splitAssistantActivity(message, false, false)
    expect([...split.answerIndexes]).toEqual([1, 3])
    expect(split.activityIndexes).toEqual([])
  })
})
