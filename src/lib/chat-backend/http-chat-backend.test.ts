import { describe, expect, it } from 'vitest'

import { consumeSSEChatEvents } from './http-chat-backend'

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
