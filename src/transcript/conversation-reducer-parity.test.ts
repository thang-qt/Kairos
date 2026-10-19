import { describe, expect, it } from 'vitest'
import fixtures from '../../android/app/src/test/resources/conversation-events.json'
import {
  applyConversationCommand,
  applyConversationEvent,
} from '@/features/chat/conversation-event-reducer'
import type { ConversationTurn } from '@/features/chat/types'
import type {
  ConversationCommandAck,
  ConversationEvent,
} from '@/lib/chat-backend'

describe('shared Android and web reducer fixtures', function () {
  for (const fixture of fixtures) {
    it(fixture.name, function () {
      const before = fixture.messages as ConversationTurn[]
      const actual =
        'event' in fixture && fixture.event
          ? applyConversationEvent(before, fixture.event as ConversationEvent)
          : applyConversationCommand(
              before,
              fixture.command as ConversationCommandAck,
            )
      expect(JSON.parse(JSON.stringify(actual))).toEqual(fixture.expected)
    })
  }
})
