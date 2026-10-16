import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  consumeSSEChatEvents,
  createHTTPChatBackend,
} from './http-chat-backend'

afterEach(function restoreGlobals() {
  vi.unstubAllGlobals()
})

describe('consumeSSEChatEvents', function () {
  it('delivers model deltas and a terminal event across response chunks', async function () {
    const encoder = new TextEncoder()
    const response = new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(
            encoder.encode(
              'data: {"runId":"run-1","state":"delta","message":{"id":"assistant-1",',
            ),
          )
          controller.enqueue(
            encoder.encode(
              '"role":"assistant","content":[{"type":"text","text":"Hi"}]}}\n\n',
            ),
          )
          controller.enqueue(
            encoder.encode(
              'data: {"runId":"run-1","state":"final","message":{"id":"assistant-1","role":"assistant","content":[{"type":"text","text":"Hi there"}]}}\n\n',
            ),
          )
          controller.close()
        },
      }),
    )
    const events: Array<{ state?: string }> = []

    await consumeSSEChatEvents(response, function collectEvent(event) {
      events.push(event)
    })

    expect(events.map((event) => event.state)).toEqual(['delta', 'final'])
  })

  it('rejects a stream that ends without a terminal event', async function () {
    const response = new Response(
      'data: {"runId":"run-1","state":"delta","message":{"id":"assistant-1","role":"assistant"}}\n\n',
    )

    await expect(
      consumeSSEChatEvents(response, function ignoreEvent() {}),
    ).rejects.toThrow('ended unexpectedly')
  })

  it('surfaces streamed generation errors', async function () {
    const response = new Response(
      'data: {"runId":"run-1","state":"error","error":"provider unavailable"}\n\n',
    )

    await expect(
      consumeSSEChatEvents(response, function ignoreEvent() {}),
    ).rejects.toThrow('provider unavailable')
  })
})

it('requests recent-order session pages with the recent cursor mode', async function () {
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ sessions: [], nextCursor: 'next' }), {
      headers: { 'Content-Type': 'application/json' },
    }),
  )
  vi.stubGlobal('fetch', fetchMock)
  const backend = createHTTPChatBackend()
  const listRecentConversationPage = backend.listRecentConversationPage
  if (!listRecentConversationPage)
    throw new Error('recent paging is unavailable')

  const page = await listRecentConversationPage('cursor value')

  expect(page).toEqual({ sessions: [], nextCursor: 'next' })
  const requestURL = new URL(
    String(fetchMock.mock.calls[0][0]),
    'http://localhost',
  )
  expect(requestURL.pathname).toBe('/api/sessions')
  expect(requestURL.searchParams.get('limit')).toBe('50')
  expect(requestURL.searchParams.get('order')).toBe('recent')
  expect(requestURL.searchParams.get('cursor')).toBe('cursor value')
})
