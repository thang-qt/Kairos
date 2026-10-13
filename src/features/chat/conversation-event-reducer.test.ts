import { describe, expect, it } from 'vitest'
import {
  applyConversationEvent,
  applyConversationCommand,
  cancelEphemeralTurns,
} from './conversation-event-reducer'
import type { ConversationTurn } from './types'
import type { ConversationEvent } from '@/lib/chat-backend'

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

describe('throwaway stream cancellation', function () {
  it('freezes partial content and stops pending calls without adding a turn', function () {
    const turns: Array<ConversationTurn> = [
      {
        id: 'turn',
        role: 'assistant',
        __streamRunId: 'run',
        status: 'running',
        content: [
          { type: 'text', text: 'partial' },
          { type: 'toolCall', id: 'call', name: 'fake' },
        ],
      },
    ]
    const stopped = cancelEphemeralTurns(turns)
    expect(stopped).toHaveLength(1)
    expect(stopped[0].status).toBe('aborted')
    expect(stopped[0].__streamRunId).toBeNull()
    expect(stopped[0].content?.[0]).toEqual(turns[0].content?.[0])
    expect(stopped[0].content?.[1]).toMatchObject({ status: 'aborted' })
  })
})

describe('authoritative mutation acknowledgement', function () {
  it('removes revoked turns and rejects an older event already in flight', function () {
    const before: Array<ConversationTurn> = [
      {
        id: 'user',
        role: 'user',
        revision: 0,
        content: [{ type: 'text', text: 'old' }],
      },
      { id: 'old-response', role: 'assistant', runId: 'old-run', revision: 0 },
      { id: 'later-user', role: 'user', revision: 0 },
    ]
    const after = applyConversationCommand(before, {
      revision: 1,
      invalidatedRunIds: ['old-run'],
      removedTurnIds: ['later-user'],
      userTurn: {
        id: 'user',
        role: 'user',
        revision: 1,
        content: [{ type: 'text', text: 'edited' }],
      },
    })
    expect(after).toHaveLength(1)
    expect(after[0].content).toEqual([{ type: 'text', text: 'edited' }])
    expect(
      applyConversationEvent(after, {
        revision: 0,
        state: 'delta',
        runId: 'old-run',
        message: { id: 'old-response', role: 'assistant' },
      }),
    ).toBe(after)
  })
})

it('applies compact string and tool patches without duplicating content', function () {
  const before = [
    {
      id: 'turn',
      role: 'assistant',
      revision: 1,
      content: [{ type: 'text', text: 'Hello' }],
      steps: [],
    },
  ] as Array<ConversationTurn>
  const event: ConversationEvent = {
    state: 'delta',
    revision: 1,
    turnId: 'turn',
    runId: 'run',
    turnPatch: [
      { op: 'append', path: ['content', '0', 'text'], value: ' world' },
      {
        op: 'set',
        path: ['steps', '0'],
        value: {
          id: 'tool',
          role: 'toolResult',
          content: [{ type: 'text', text: '4' }],
        },
      },
      { op: 'set', path: ['details'], value: null },
    ],
  }
  const after = applyConversationEvent(before, event)
  expect(after[0].content?.[0]).toEqual({ type: 'text', text: 'Hello world' })
  expect(after[0].steps).toHaveLength(1)
  expect(before[0].content?.[0]).toEqual({ type: 'text', text: 'Hello' })
  expect(applyConversationEvent(after, { ...event, revision: 0 })).toBe(after)
})
