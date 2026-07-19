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

export type ActiveAssistantRunBounds = {
  firstIndex: number
  lastIndex: number
}

export function activeAssistantRunBounds(
  messages: Array<GatewayMessage>,
  activeRunIds: ReadonlySet<string>,
): Map<string, ActiveAssistantRunBounds> {
  const boundsByRunId = new Map<string, ActiveAssistantRunBounds>()
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index]
    if (message.role !== 'assistant') continue
    const runId = normalizeID(message.runId ?? message.__streamRunId)
    if (!runId || !activeRunIds.has(runId)) continue
    const current = boundsByRunId.get(runId)
    if (current) {
      current.lastIndex = index
    } else {
      boundsByRunId.set(runId, { firstIndex: index, lastIndex: index })
    }
  }
  return boundsByRunId
}

export function projectChatMessages(
  messages: Array<GatewayMessage>,
  activeRunIds: ReadonlySet<string>,
): MessageProjection {
  const assistantCallKeys = new Set<string>()
  const legacyCallCounts = new Map<string, number>()
  for (const message of messages) {
    if (message.role !== 'assistant') continue
    const runId = normalizeID(message.runId)
    for (const toolCall of getToolCallsFromMessage(message)) {
      const callId = normalizeID(toolCall.id)
      if (!callId) continue
      if (runId) {
        assistantCallKeys.add(runToolKey(runId, callId))
      } else {
        legacyCallCounts.set(callId, (legacyCallCounts.get(callId) ?? 0) + 1)
      }
    }
  }

  const toolResultsByCallId = new Map<string, GatewayMessage>()
  const hiddenToolResultIds = new Set<string>()
  const ambiguousLegacyResults = new Set<string>()
  for (const message of messages) {
    if (message.role !== 'toolResult') continue
    const callId = normalizeID(message.toolCallId)
    if (!callId) continue
    const runId = normalizeID(message.runId)
    const messageId = getGatewayMessageId(message) ?? ''
    if (runId && assistantCallKeys.has(runToolKey(runId, callId))) {
      toolResultsByCallId.set(runToolKey(runId, callId), message)
      toolResultsByCallId.set(callId, message)
      if (messageId) hiddenToolResultIds.add(messageId)
      continue
    }
    if (!runId && (legacyCallCounts.get(callId) ?? 0) === 1) {
      if (toolResultsByCallId.has(callId)) {
        ambiguousLegacyResults.add(callId)
        continue
      }
      toolResultsByCallId.set(callId, message)
      if (messageId) hiddenToolResultIds.add(messageId)
    }
  }
  for (const callId of ambiguousLegacyResults) {
    toolResultsByCallId.delete(callId)
  }

  const toolChainsByFinalMessageID = new Map<string, Array<GatewayMessage>>()
  const groupedToolMessageIDs = new Set<string>()
  const byRun = new Map<string, Array<GatewayMessage>>()
  for (const message of messages) {
    const runId = normalizeID(message.runId)
    if (!runId) continue
    if (!byRun.has(runId)) byRun.set(runId, [])
    byRun.get(runId)?.push(message)
  }

  for (const [runId, runMessages] of byRun) {
    if (activeRunIds.has(runId)) continue
    const assistantMessages = runMessages.filter(
      (message) => message.role === 'assistant',
    )
    const finalMessage = [...assistantMessages]
      .reverse()
      .find((message) => getToolCallsFromMessage(message).length === 0)
    if (!finalMessage) continue
    const finalMessageID = getGatewayMessageId(finalMessage)
    if (!finalMessageID) continue
    const toolTurns = assistantMessages.filter(
      (message) =>
        message !== finalMessage && getToolCallsFromMessage(message).length > 0,
    )
    if (toolTurns.length === 0) continue
    toolChainsByFinalMessageID.set(finalMessageID, toolTurns)
    for (const toolTurn of toolTurns) {
      const id = getGatewayMessageId(toolTurn)
      if (id) groupedToolMessageIDs.add(id)
    }
  }

  const displayMessages = messages.filter((message) => {
    const messageId = getGatewayMessageId(message) ?? ''
    if (messageId && hiddenToolResultIds.has(messageId)) return false
    if (messageId && groupedToolMessageIDs.has(messageId)) return false
    return true
  })

  return { displayMessages, toolChainsByFinalMessageID, toolResultsByCallId }
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
