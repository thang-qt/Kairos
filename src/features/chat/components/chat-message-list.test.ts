import { describe, expect, it } from 'vitest'
import { projectConversationTurns } from './chat-message-list'
import { toolResultsForTurn } from './chat-message-list-utils'
import { targetVisibleCount } from '../hooks/use-chat-scroll-control'
import type { ConversationTurn } from '../types'

describe('authoritative turn rendering', function () {
  it('renders a stopped turn as one message with explicit tool results', function () {
    const result: ConversationTurn = {
      id: 'result',
      role: 'toolResult',
      toolCallId: 'call',
      content: [{ type: 'text', text: '42' }],
    }
    const turn: ConversationTurn = {
      id: 'turn',
      role: 'assistant',
      runId: 'run',
      status: 'aborted',
      content: [{ type: 'toolCall', id: 'call', name: 'math_eval' }],
      steps: [result],
    }
    const projection = projectConversationTurns([turn])
    expect(projection.displayMessages).toEqual([turn])
    expect(projection.toolResultsByCallId.get('run\u0000call')).toEqual(result)
  })
  it('does not guess a final round or group messages', function () {
    const messages: Array<ConversationTurn> = [
      { id: 'one', role: 'assistant' },
      { id: 'two', role: 'assistant' },
    ]
    expect(projectConversationTurns(messages).displayMessages).toEqual(messages)
  })
  it('preserves scroll visibility calculations', function () {
    expect(targetVisibleCount([{ id: 'target' }], 'target')).toBeGreaterThan(0)
  })
})

it('retains lookup references for unchanged turns while another turn streams', function () {
  const result: ConversationTurn = {
    id: 'result',
    role: 'toolResult',
    toolCallId: 'call',
  }
  const prior: ConversationTurn = {
    id: 'prior',
    runId: 'prior-run',
    steps: [result],
  }
  const original = toolResultsForTurn(prior)
  toolResultsForTurn({ id: 'live', steps: [] })
  expect(toolResultsForTurn(prior)).toBe(original)
  expect(original.get('prior-run\u0000call')).toBe(result)
  const replacement: ConversationTurn = { ...result, error: 'changed' }
  const updated = toolResultsForTurn({ ...prior, steps: [replacement] })
  expect(updated).not.toBe(original)
  expect(updated.get('prior-run\u0000call')).toBe(replacement)
})
