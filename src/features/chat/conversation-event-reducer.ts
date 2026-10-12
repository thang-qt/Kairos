import type { ConversationTurn } from './types'
import type { ConversationEvent } from '@/lib/chat-backend'

export function turnFromConversationEvent(
  event: ConversationEvent,
): ConversationTurn | null {
  if (!event.message?.id) return null
  return {
    ...event.message,
    revision: event.revision ?? event.message.revision,
    runId: event.message.runId ?? event.runId,
    __streamRunId: event.state === 'delta' ? event.runId : null,
  }
}

// Events contain authoritative replacements for one stable turn identity.
export function applyConversationEvent(
  messages: Array<ConversationTurn>,
  event: ConversationEvent,
): Array<ConversationTurn> {
  const revision = Math.max(
    -1,
    ...messages.map(function currentRevision(turn) {
      return turn.revision ?? -1
    }),
  )
  if (event.revision !== undefined && event.revision < revision) return messages
  const turn = turnFromConversationEvent(event)
  if (!turn) return messages
  const index = messages.findIndex(function sameTurn(previous) {
    return (
      previous.id === turn.id ||
      Boolean(turn.clientId && turn.clientId === previous.clientId)
    )
  })
  if (index < 0) return [...messages, turn]
  const next = [...messages]
  next[index] = turn
  return next
}
