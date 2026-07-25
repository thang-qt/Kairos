import { describe, expect, it } from 'vitest'

import { isChatBackendUnavailable } from './chat-queries'

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
