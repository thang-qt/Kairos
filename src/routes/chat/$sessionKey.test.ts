import { describe, expect, it } from 'vitest'
import { validateChatSearch } from './$sessionKey'
import { searchForSessionNavigation } from '@/features/chat/hooks/use-sidebar-actions'

describe('chat message search navigation', function () {
  it('keeps only a nonempty message target in route search', function () {
    expect(validateChatSearch({ messageId: ' message-1 ' })).toEqual({
      messageId: 'message-1',
    })
    expect(validateChatSearch({ messageId: '', ignored: 'value' })).toEqual({})
  })

  it('clears stale targets for session and title selections', function () {
    expect(
      searchForSessionNavigation({ friendlyId: 'session-1', messageId: 'm-1' }),
    ).toEqual({ messageId: 'm-1' })
    expect(searchForSessionNavigation({ friendlyId: 'session-1' })).toEqual({})
  })
})
