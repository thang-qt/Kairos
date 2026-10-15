import { describe, expect, it } from 'vitest'

import { QueryClient } from '@tanstack/react-query'
import {
  chatQueryKeys,
  moveHistoryMessages,
  acceptConversationCommand,
  isChatBackendUnavailable,
} from './chat-queries'

describe('chat backend availability', function chatBackendAvailabilitySuite() {
  it('treats a network query error as unavailable', function () {
    expect(isChatBackendUnavailable({ isError: true })).toBe(true)
  })

  it('treats an unsuccessful health response as unavailable', function () {
    expect(
      isChatBackendUnavailable({
        isError: false,
        data: {
          ok: false,
          mode: 'http',
          provider: 'test',
          detail: 'offline',
        },
      }),
    ).toBe(true)
  })

  it('keeps the composer available after a successful health response', function () {
    expect(
      isChatBackendUnavailable({
        isError: false,
        data: { ok: true, mode: 'http', provider: 'test' },
      }),
    ).toBe(false)
  })
})

it('keeps the draft visible while the saved chat receives its authoritative turn', function () {
  const client = new QueryClient()
  const draftKey = chatQueryKeys.history('new', 'new')
  const savedKey = chatQueryKeys.history('saved', 'session')
  const pending = {
    sessionKey: 'new',
    messages: [
      { role: 'user', clientId: 'command', status: 'sending', content: [] },
    ],
  }
  client.setQueryData(draftKey, pending)
  moveHistoryMessages(client, 'new', 'new', 'saved', 'session', true)
  acceptConversationCommand(client, 'saved', 'session', {
    userTurn: { id: 'server', role: 'user', clientId: 'command', content: [] },
  })
  expect(client.getQueryData(draftKey)).toEqual(pending)
  expect(client.getQueryData(savedKey)).toMatchObject({
    sessionKey: 'session',
    messages: [{ id: 'server', clientId: 'command' }],
  })
})
