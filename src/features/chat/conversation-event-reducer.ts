import type { ConversationTurn } from './types'
import type {
  ConversationEvent,
  ConversationCommandAck,
  TurnPatchOperation,
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

// Full turns establish identity; patches apply only after the authoritative snapshot.
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
  let turn = turnFromConversationEvent(event)
  if (event.turnPatch?.length && event.turnId) {
    const previous = messages.find(function target(turn) {
      return turn.id === event.turnId
    })
    if (!previous) return messages
    const patched = applyTurnPatch(previous, event.turnPatch)
    if (!patched) return messages
    turn = {
      ...patched,
      revision: event.revision ?? patched.revision,
      __streamRunId: event.runId ?? null,
    }
  }
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

// Clone only modified paths, preserving unchanged tool outputs and sibling turns.
export function applyTurnPatch(
  turn: ConversationTurn,
  operations: Array<TurnPatchOperation>,
): ConversationTurn | null {
  let result: unknown = turn
  for (const operation of operations) {
    if (
      operation.path.some(function unsafe(key) {
        return ['__proto__', 'constructor', 'prototype'].includes(key)
      })
    )
      return null
    result = patchValue(result, operation.path, operation)
    if (result === undefined) return null
  }
  return result as ConversationTurn
}

function patchValue(
  current: unknown,
  path: Array<string>,
  operation: TurnPatchOperation,
): unknown {
  if (!path.length) {
    if (operation.op === 'append')
      return typeof current === 'string' && typeof operation.value === 'string'
        ? current + operation.value
        : undefined
    return operation.op === 'remove' ? undefined : operation.value
  }
  if (current === null || typeof current !== 'object') return undefined
  const [key, ...rest] = path
  const copy: Record<string, unknown> | Array<unknown> = Array.isArray(current)
    ? [...current]
    : { ...current }
  const record = copy as Record<string, unknown>
  if (Array.isArray(copy) && (!/^\d+$/.test(key) || Number(key) > copy.length))
    return undefined
  if (!rest.length && operation.op === 'remove') {
    if (Array.isArray(copy)) copy.splice(Number(key), 1)
    else delete record[key]
  } else {
    const value = patchValue(record[key], rest, operation)
    if (value === undefined) return undefined
    record[key] = value
  }
  return copy
}
