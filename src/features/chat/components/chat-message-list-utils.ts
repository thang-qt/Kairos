import { getTurnId } from '../utils'
import type { ConversationTurn } from '../types'

export function findPreviousClonePoint(
  messages: Array<ConversationTurn>,
  index: number,
): ConversationTurn | undefined {
  for (let previousIndex = index - 1; previousIndex >= 0; previousIndex -= 1) {
    const message = messages[previousIndex]
    if (message.role === 'toolResult') continue
    if (getTurnId(message)) return message
  }
  return undefined
}

export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName.toLowerCase()
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return true
  return target.isContentEditable
}

export type MessageProjection = {
  displayMessages: Array<ConversationTurn>
  toolResultsByCallId: Map<string, ConversationTurn>
}

export function projectConversationTurns(
  messages: Array<ConversationTurn>,
): MessageProjection {
  const toolResultsByCallId = new Map<string, ConversationTurn>()
  for (const turn of messages) {
    for (const step of turn.steps ?? []) {
      if (step.role !== 'toolResult' || !step.toolCallId) continue
      toolResultsByCallId.set(toolResultLookupKey(turn, step.toolCallId), step)
    }
  }
  return {
    displayMessages: messages,
    toolResultsByCallId,
  }
}

export function toolResultLookupKey(
  messageOrRunId: ConversationTurn | string | undefined,
  toolCallId: string | undefined,
) {
  const callId = normalizeID(toolCallId)
  if (!callId) return ''
  const runId =
    typeof messageOrRunId === 'string'
      ? normalizeID(messageOrRunId)
      : normalizeID(messageOrRunId?.runId)
  return runId ? runToolKey(runId, callId) : callId
}

function runToolKey(runId: string, callId: string) {
  return `${runId}\u0000${callId}`
}

function normalizeID(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}
