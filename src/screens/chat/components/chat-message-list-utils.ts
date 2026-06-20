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
      const toolCallId =
        typeof toolCall.id === 'string' ? toolCall.id.trim() : ''
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
  const toolCallId =
    typeof message.toolCallId === 'string' ? message.toolCallId.trim() : ''
  return toolCallId.length > 0 && linkedToolCallIds.has(toolCallId)
}
