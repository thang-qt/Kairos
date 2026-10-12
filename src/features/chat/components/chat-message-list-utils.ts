import { getGatewayMessageId, getToolCallsFromMessage } from '../utils'
import type { GatewayMessage } from '../types'

export function findPreviousClonePoint(
  messages: Array<GatewayMessage>,
  index: number,
): GatewayMessage | undefined {
  for (let previousIndex = index - 1; previousIndex >= 0; previousIndex -= 1) {
    const message = messages[previousIndex]
    if (message.role === 'toolResult') continue
    if (getGatewayMessageId(message)) return message
  }
  return undefined
}

export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName.toLowerCase()
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return true
  return target.isContentEditable
}

export function collectLinkedToolCallIds(
  messages: Array<GatewayMessage>,
): Set<string> {
  const linkedToolCallIds = new Set<string>()
  for (const message of messages) {
    if (message.role !== 'assistant') continue
    const toolCalls = getToolCallsFromMessage(message)
    for (const toolCall of toolCalls) {
      const toolCallId = normalizeID(toolCall.id)
      if (!toolCallId) continue
      linkedToolCallIds.add(toolCallId)
    }
  }
  return linkedToolCallIds
}

export function isLinkedToolResultMessage(
  message: GatewayMessage,
  linkedToolCallIds: ReadonlySet<string>,
): boolean {
  if (message.role !== 'toolResult') return false
  const toolCallId = normalizeID(message.toolCallId)
  return toolCallId.length > 0 && linkedToolCallIds.has(toolCallId)
}

export type MessageProjection = {
  displayMessages: Array<GatewayMessage>
  toolChainsByFinalMessageID: Map<string, Array<GatewayMessage>>
  toolResultsByCallId: Map<string, GatewayMessage>
}

export function projectChatMessages(
  messages: Array<GatewayMessage>,
): MessageProjection {
  const toolResultsByCallId = new Map<string, GatewayMessage>()
  for (const turn of messages) {
    for (const step of turn.steps ?? []) {
      if (step.role !== 'toolResult' || !step.toolCallId) continue
      toolResultsByCallId.set(toolResultLookupKey(turn, step.toolCallId), step)
    }
  }
  return {
    displayMessages: messages,
    toolChainsByFinalMessageID: new Map(),
    toolResultsByCallId,
  }
}

export function toolResultLookupKey(
  messageOrRunId: GatewayMessage | string | undefined,
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
