import type { ConversationTurn } from './types'
import type {
  ConversationEvent,
  ConversationCommandAck,
} from '@/lib/chat-backend'

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

// Throwaway chats have one request-bound stream. A local transport abort freezes
// its last received snapshot; it does not mutate any persisted conversation.
export function cancelEphemeralTurns(
  turns: Array<ConversationTurn>,
): Array<ConversationTurn> {
  return turns.map(function stopLiveTurn(turn) {
    if (turn.role !== 'assistant' || !turn.__streamRunId) return turn
    const completedCalls = new Set(
      (turn.steps ?? [])
        .filter(function isResult(step) {
          return step.role === 'toolResult'
        })
        .map(function callId(step) {
          return step.toolCallId
        }),
    )
    return {
      ...turn,
      status: 'aborted',
      __streamRunId: null,
      content: turn.content?.map(function stopPendingCall(part) {
        return part.type === 'toolCall' && !completedCalls.has(part.id)
          ? { ...part, status: 'aborted' }
          : part
      }),
    }
  })
}

export function applyConversationCommand(
  turns: Array<ConversationTurn>,
  ack: ConversationCommandAck,
): Array<ConversationTurn> {
  const removed = new Set(ack.removedTurnIds ?? [])
  const invalidated = new Set(ack.invalidatedRunIds ?? [])
  const next = turns.filter(function stillCanonical(turn) {
    return !removed.has(turn.id ?? '') && !invalidated.has(turn.runId ?? '')
  })
  if (!ack.userTurn) return next
  const user = ack.userTurn
  const index = next.findIndex(function sameUser(turn) {
    return (
      turn.id === user.id ||
      Boolean(user.clientId && turn.clientId === user.clientId)
    )
  })
  if (index < 0) return [...next, user]
  next[index] = user
  return next
}
