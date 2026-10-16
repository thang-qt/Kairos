import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  consumeSSEChatEvents,
  createHTTPChatBackend,
} from './http-chat-backend'

afterEach(function restoreGlobals() {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('conversation event subscriptions', function () {
  function subscribe(onEvent = vi.fn(), onReconcile = vi.fn()) {
    const listeners = new Map<string, EventListener>()
    const close = vi.fn()
    vi.stubGlobal('window', {})
    vi.stubGlobal(
      'EventSource',
      class {
        addEventListener(type: string, listener: EventListener) {
          listeners.set(type, listener)
        }
        removeEventListener(type: string) {
          listeners.delete(type)
        }
        close = close
      },
    )
    const onReconnect = vi.fn()
    const unsubscribe = createHTTPChatBackend().subscribeToConversation({
      friendlyId: 'chat-1',
      onEvent,
      onReconcile,
      onReconnect,
    })
    function emit(data: string) {
      listeners.get('message')?.({ data } as MessageEvent<string>)
    }
    return { emit, onEvent, onReconnect, onReconcile, unsubscribe, close }
  }

  it('ignores malformed JSON and continues delivering valid events', function () {
    const reportError = vi
      .spyOn(console, 'error')
      .mockImplementation(function () {})
    const stream = subscribe()
    stream.emit('{')
    stream.emit('{"state":"delta"}')
    expect(stream.onEvent).toHaveBeenCalledExactlyOnceWith({ state: 'delta' })
    expect(stream.onReconnect).not.toHaveBeenCalled()
    expect(reportError).not.toHaveBeenCalled()
    stream.unsubscribe()
    expect(stream.close).toHaveBeenCalledOnce()
  })

  it('reports callback failures and requests authoritative history', function () {
    const failure = new Error('patch failed')
    const reportError = vi
      .spyOn(console, 'error')
      .mockImplementation(function () {})
    const onEvent = vi.fn().mockImplementationOnce(function () {
      throw failure
    })
    const stream = subscribe(onEvent)
    stream.emit('{"state":"delta"}')
    expect(reportError).toHaveBeenCalledWith(
      'Failed to apply conversation stream event.',
      failure,
    )
    expect(stream.onReconnect).toHaveBeenCalledOnce()
    stream.emit('{"state":"final"}')
    expect(onEvent).toHaveBeenLastCalledWith({ state: 'final' })
    stream.unsubscribe()
  })

  it('reports reconciliation callback failures', function () {
    const reportError = vi
      .spyOn(console, 'error')
      .mockImplementation(function () {})
    const stream = subscribe(
      vi.fn(),
      vi.fn(function () {
        throw new Error('reconciliation failed')
      }),
    )
    stream.emit('{"state":"reconcile"}')
    expect(reportError).toHaveBeenCalledOnce()
    expect(stream.onReconnect).toHaveBeenCalledOnce()
    stream.unsubscribe()
  })
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
