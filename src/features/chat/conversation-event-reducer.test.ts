import { describe, expect, it } from 'vitest'
import { applyConversationEvent } from './conversation-event-reducer'
import type { ConversationTurn } from './types'

describe('authoritative turn replacements', function () {
  it('replays snapshots without appending duplicate content', function () {
    const event = {
      runId: 'run',
      revision: 1,
      state: 'delta' as const,
      message: {
        id: 'turn',
        role: 'assistant',
        steps: [],
        content: [{ type: 'text' as const, text: 'partial' }],
      },
    }
    const first = applyConversationEvent([], event)
    expect(applyConversationEvent(first, event)).toEqual(first)
    const stopped = applyConversationEvent(first, {
      ...event,
      state: 'aborted',
      message: { ...event.message, status: 'aborted' },
    })
    expect(stopped).toHaveLength(1)
    expect(stopped[0].__streamRunId).toBeNull()
    expect(stopped[0].content).toEqual(event.message.content)
  })
  it('clears partial output on retry using the same turn id', function () {
    const old: Array<ConversationTurn> = [
      {
        id: 'turn',
        role: 'assistant',
        status: 'error',
        content: [{ type: 'text', text: 'old' }],
      },
    ]
    const retried = applyConversationEvent(old, {
      state: 'delta',
      runId: 'run',
      message: {
        id: 'turn',
        role: 'assistant',
        status: 'queued',
        content: [],
        steps: [],
      },
    })
    expect(retried).toHaveLength(1)
    expect(retried[0].content).toEqual([])
  })
  it('rejects obsolete revisions and id-less provider messages', function () {
    const current: Array<ConversationTurn> = [
      { id: 'turn', revision: 2, content: [] },
    ]
    expect(
      applyConversationEvent(current, {
        revision: 1,
        message: { id: 'obsolete' },
      }),
    ).toBe(current)
    expect(
      applyConversationEvent(current, { message: { role: 'assistant' } }),
    ).toBe(current)
  })
})

describe('accepted user turns', function () {
  it('replaces an optimistic user turn by its explicit client identity', function () {
    const pending: Array<ConversationTurn> = [
      {
        id: 'local',
        clientId: 'client-command',
        role: 'user',
        status: 'sending',
      },
    ]
    const accepted = applyConversationEvent(pending, {
      state: 'user',
      revision: 1,
      message: {
        id: 'server',
        clientId: 'client-command',
        role: 'user',
        content: [],
      },
    })
    expect(accepted).toHaveLength(1)
    expect(accepted[0].id).toBe('server')
    expect(accepted[0].status).toBeUndefined()
  })
})
