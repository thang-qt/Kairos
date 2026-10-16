import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type {
  ChatSendMessageInput,
  ChatSendMessageResult,
  ConversationEvent,
} from './types'
import {
  consumeSSEChatEvents,
  createHTTPChatBackend,
} from './http-chat-backend'
import {
  applyConversationCommand,
  applyConversationEvent,
} from '@/features/chat/conversation-event-reducer'

type SharedChatContractFixture = {
  sendRequest: ChatSendMessageInput
  commandAck: ChatSendMessageResult
  sseFrame: string
}

afterEach(function restoreGlobals() {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const fixture = JSON.parse(
  readFileSync('internal/server/testdata/chat-contract.json', 'utf8'),
) as SharedChatContractFixture

describe('shared Go and TypeScript chat wire contract', function () {
  it('accepts the command acknowledgement revision and identity fields', function () {
    expect(fixture.commandAck.revision).toBe(7)
    expect(fixture.commandAck.runId).toBe('run-contract-1')
    expect(fixture.commandAck.userTurnId).toBe('user-contract-1')
    expect(fixture.commandAck.assistantTurnId).toBe('assistant-contract-1')
    expect(fixture.commandAck.invalidatedRunIds).toEqual(['run-old-1'])
    expect(fixture.commandAck.removedTurnIds).toEqual(['assistant-old-1'])
  })

  it('serializes the production send request with the Go decoder field names', async function () {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(fixture.commandAck), {
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    await createHTTPChatBackend().sendMessage({
      ...fixture.sendRequest,
      sessionKey: 'session-contract-1',
      friendlyId: 'friendly-contract-1',
    })

    const init = fetchMock.mock.calls[0]?.[1]
    expect(JSON.parse(String(init?.body))).toEqual(fixture.sendRequest)
  })

  it('consumes Go-shaped SSE patches and the terminal event', async function () {
    const events: Array<ConversationEvent> = []
    await consumeSSEChatEvents(
      new Response(fixture.sseFrame),
      function collect(event) {
        events.push(event)
      },
    )

    expect(events).toHaveLength(2)
    expect(events[0]).toMatchObject({
      cursor: 19,
      revision: 7,
      runId: 'run-contract-1',
      state: 'delta',
      turnPatch: [
        {
          op: 'append',
          path: ['content', '0', 'text'],
          value: ' there',
        },
      ],
    })
    expect(events[1]).toMatchObject({
      cursor: 20,
      revision: 7,
      state: 'final',
      message: {
        id: 'assistant-contract-1',
        content: [{ type: 'text', text: 'Hello there' }],
      },
    })

    const afterAck = applyConversationCommand(
      [
        { id: 'assistant-old-1', role: 'assistant', runId: 'run-old-1' },
        { id: 'keep-1', role: 'assistant', content: [] },
      ],
      fixture.commandAck,
    )
    expect(afterAck.map((turn) => turn.id)).toEqual([
      'keep-1',
      'user-contract-1',
    ])

    const patched = applyConversationEvent(
      [
        {
          id: 'assistant-contract-1',
          role: 'assistant',
          revision: 7,
          content: [{ type: 'text', text: 'Hello' }],
        },
      ],
      events[0],
    )
    expect(patched[0]?.content).toEqual([{ type: 'text', text: 'Hello there' }])
    expect(applyConversationEvent(patched, { ...events[0], revision: 6 })).toBe(
      patched,
    )
  })
})
