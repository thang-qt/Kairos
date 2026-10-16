import { describe, expect, it } from 'vitest'

import { resolveConversationSessionKey } from './conversation-identity'

describe('resolveConversationSessionKey', function () {
  it('prefers the forced key, then a resolved key, then the active key', function () {
    expect(
      resolveConversationSessionKey({
        forcedSessionKey: 'forced-key',
        resolvedSessionKey: 'resolved-key',
        activeSessionKey: 'active-key',
        activeFriendlyId: 'friendly-id',
      }),
    ).toBe('forced-key')
    expect(
      resolveConversationSessionKey({
        resolvedSessionKey: 'resolved-key',
        activeSessionKey: 'active-key',
        activeFriendlyId: 'friendly-id',
      }),
    ).toBe('resolved-key')
    expect(
      resolveConversationSessionKey({
        activeSessionKey: 'active-key',
        activeFriendlyId: 'friendly-id',
      }),
    ).toBe('active-key')
  })

  it('resolves a new chat before the friendly ID fallback', function () {
    expect(
      resolveConversationSessionKey({
        isNewChat: true,
        activeFriendlyId: 'friendly-id',
      }),
    ).toBe('new')
    expect(
      resolveConversationSessionKey({ activeFriendlyId: 'friendly-id' }),
    ).toBe('friendly-id')
  })
})
