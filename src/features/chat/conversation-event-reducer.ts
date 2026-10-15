import type { ConversationTurn } from './types'
import type {
  ConversationEvent,
  ConversationCommandAck,
  TurnPatchOperation,
} from '@/lib/chat-backend'

type TurnIndexes = {
  maxRevision: number
  byId?: Map<string, number>
  byClientId?: Map<string, number>
  changedIds?: Map<string, number | null>
  changedClientIds?: Map<string, number | null>
  parent?: TurnIndexes
  depth: number
}

const turnIndexesByArray = new WeakMap<Array<ConversationTurn>, TurnIndexes>()
const MAX_TURN_INDEX_DEPTH = 32

function lookupTurnIndex(
  indexes: TurnIndexes,
  key: string,
  identity: 'id' | 'clientId',
): number | undefined {
  let current: TurnIndexes | undefined = indexes
  while (current) {
    const changes =
      identity === 'id' ? current.changedIds : current.changedClientIds
    if (changes?.has(key)) return changes.get(key) ?? undefined
    const base = identity === 'id' ? current.byId : current.byClientId
    if (base) return base.get(key)
    current = current.parent
  }
  return undefined
}

function indexesFor(messages: Array<ConversationTurn>): TurnIndexes {
  const cached = turnIndexesByArray.get(messages)
  if (cached) return cached
  const indexes: TurnIndexes = {
    maxRevision: -1,
    byId: new Map(),
    byClientId: new Map(),
    depth: 0,
  }
  const byId = indexes.byId!
  const byClientId = indexes.byClientId!
  for (let index = 0; index < messages.length; index += 1) {
    const turn = messages[index]
    indexes.maxRevision = Math.max(indexes.maxRevision, turn.revision ?? -1)
    if (typeof turn.id === 'string' && !byId.has(turn.id)) {
      byId.set(turn.id, index)
    }
    if (typeof turn.clientId === 'string' && !byClientId.has(turn.clientId)) {
      byClientId.set(turn.clientId, index)
    }
  }
  turnIndexesByArray.set(messages, indexes)
  return indexes
}

export function findConversationTurn(
  messages: Array<ConversationTurn>,
  id: string | undefined,
): ConversationTurn | undefined {
  if (!id) return undefined
  const index = lookupTurnIndex(indexesFor(messages), id, 'id')
  return typeof index === 'number' ? messages[index] : undefined
}

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
  const indexes = indexesFor(messages)
  const revision = indexes.maxRevision
  if (event.revision !== undefined && event.revision < revision) return messages
  let turn = turnFromConversationEvent(event)
  if (event.turnPatch?.length && event.turnId) {
    const previousIndex = lookupTurnIndex(indexes, event.turnId, 'id')
    const previous =
      typeof previousIndex === 'number' ? messages[previousIndex] : undefined
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
  const idIndex =
    typeof turn.id === 'string'
      ? lookupTurnIndex(indexes, turn.id, 'id')
      : undefined
  const clientIndex =
    typeof turn.clientId === 'string'
      ? lookupTurnIndex(indexes, turn.clientId, 'clientId')
      : undefined
  const index =
    typeof idIndex === 'number' && typeof clientIndex === 'number'
      ? Math.min(idIndex, clientIndex)
      : (idIndex ?? clientIndex ?? -1)
  const next = [...messages]
  if (index < 0) {
    next.push(turn)
    indexUpdatedArray(next, indexes, undefined, turn, next.length - 1)
    return next
  }
  const prior = messages[index]
  next[index] = turn
  indexUpdatedArray(next, indexes, prior, turn, index)
  return next
}

function indexUpdatedArray(
  next: Array<ConversationTurn>,
  indexes: TurnIndexes,
  prior: ConversationTurn | undefined,
  turn: ConversationTurn,
  turnIndex: number,
) {
  const maxRevision =
    (prior?.revision ?? -1) >= indexes.maxRevision &&
    (turn.revision ?? -1) < indexes.maxRevision
      ? next.reduce(function findMaximum(maximum, candidate) {
          return Math.max(maximum, candidate.revision ?? -1)
        }, -1)
      : Math.max(indexes.maxRevision, turn.revision ?? -1)
  if (indexes.depth + 1 >= MAX_TURN_INDEX_DEPTH) {
    const compacted = indexesForUncached(next, maxRevision)
    turnIndexesByArray.set(next, compacted)
    return
  }
  const changedIds = new Map<string, number | null>()
  const changedClientIds = new Map<string, number | null>()
  if (
    typeof prior?.id === 'string' &&
    lookupTurnIndex(indexes, prior.id, 'id') === turnIndex
  ) {
    changedIds.set(prior.id, null)
  }
  if (
    typeof prior?.clientId === 'string' &&
    lookupTurnIndex(indexes, prior.clientId, 'clientId') === turnIndex
  ) {
    changedClientIds.set(prior.clientId, null)
  }
  if (typeof turn.id === 'string') changedIds.set(turn.id, turnIndex)
  if (typeof turn.clientId === 'string') {
    changedClientIds.set(turn.clientId, turnIndex)
  }
  turnIndexesByArray.set(next, {
    maxRevision,
    changedIds,
    changedClientIds,
    parent: indexes,
    depth: indexes.depth + 1,
  })
}

function indexesForUncached(
  messages: Array<ConversationTurn>,
  maxRevision: number,
): TurnIndexes {
  const indexes: TurnIndexes = {
    maxRevision,
    byId: new Map(),
    byClientId: new Map(),
    depth: 0,
  }
  for (let index = 0; index < messages.length; index += 1) {
    const turn = messages[index]
    if (typeof turn.id === 'string' && !indexes.byId!.has(turn.id)) {
      indexes.byId!.set(turn.id, index)
    }
    if (
      typeof turn.clientId === 'string' &&
      !indexes.byClientId!.has(turn.clientId)
    ) {
      indexes.byClientId!.set(turn.clientId, index)
    }
  }
  return indexes
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
