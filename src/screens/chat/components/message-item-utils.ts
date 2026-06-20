import { getToolCallsFromMessage } from '../utils'
import type {
  GatewayMessage,
  ImageContent,
  MessageContent as MessageContentPart,
  ToolCallContent,
} from '../types'
import type { ToolPart } from '@/components/prompt-kit/tool'

type MessageModelMetadata = {
  id: string | null
  name: string | null
}

export function mapToolCallToToolPart(
  toolCall: ToolCallContent,
  resultMessage: GatewayMessage | undefined,
): ToolPart {
  const hasResult = resultMessage !== undefined
  const isError = resultMessage?.isError ?? false

  let state: ToolPart['state']
  if (!hasResult) {
    state = 'input-available'
  } else if (isError) {
    state = 'output-error'
  } else {
    state = 'output-available'
  }

  const resultText = toolResultText(resultMessage)

  // Extract error text from result message content
  let errorText: string | undefined
  if (isError) {
    errorText = resultText || 'Unknown error'
  }

  const output =
    resultMessage?.details && typeof resultMessage.details === 'object'
      ? resultMessage.details
      : resultText
        ? { text: resultText }
        : undefined

  return {
    type: toolCall.name || 'unknown',
    state,
    input: toolCall.arguments,
    output,
    toolCallId: toolCall.id,
    errorText,
  }
}

export function toolResultText(
  resultMessage: GatewayMessage | undefined,
): string {
  if (!resultMessage) return ''
  const content = Array.isArray(resultMessage.content)
    ? resultMessage.content
    : []
  return content
    .map((part) => (part.type === 'text' ? String(part.text ?? '') : ''))
    .join('')
    .trim()
}

export function mapStandaloneToolResultToToolPart(
  message: GatewayMessage,
): ToolPart {
  const isError = Boolean(message.isError)
  const text = toolResultText(message)
  const output =
    message.details && typeof message.details === 'object'
      ? message.details
      : text
        ? { text }
        : undefined

  return {
    type:
      typeof message.toolName === 'string' && message.toolName.trim().length > 0
        ? message.toolName
        : 'tool',
    state: isError ? 'output-error' : 'output-available',
    output,
    toolCallId:
      typeof message.toolCallId === 'string' ? message.toolCallId : undefined,
    errorText: isError ? text || 'Unknown error' : undefined,
  }
}

export function assistantPartRenderOrder(
  message: GatewayMessage,
  showReasoningBlocks: boolean,
  showToolMessages: boolean,
): Array<'thinking' | 'text' | 'toolCall'> {
  const content = Array.isArray(message.content) ? message.content : []
  const order: Array<'thinking' | 'text' | 'toolCall'> = []
  for (const part of content) {
    if (part.type === 'thinking') {
      const thinking = String(part.thinking ?? '').trim()
      if (showReasoningBlocks && thinking) {
        order.push('thinking')
      }
      continue
    }
    if (part.type === 'text') {
      const text = String(part.text ?? '').trim()
      if (text) {
        order.push('text')
      }
      continue
    }
    if (part.type === 'toolCall' && showToolMessages) {
      order.push('toolCall')
    }
  }
  return order
}

export function toolCallsSignature(message: GatewayMessage): string {
  const toolCalls = getToolCallsFromMessage(message)
  return toolCalls
    .map((toolCall) => {
      const id = toolCall.id ?? ''
      const name = toolCall.name ?? ''
      const partialJson = toolCall.partialJson ?? ''
      const args = toolCall.arguments ? JSON.stringify(toolCall.arguments) : ''
      return `${id}|${name}|${partialJson}|${args}`
    })
    .join('||')
}

export function toolResultSignature(
  result: GatewayMessage | undefined,
): string {
  if (!result) return 'missing'
  const content = Array.isArray(result.content) ? result.content : []
  const text = content
    .map((part) => (part.type === 'text' ? String(part.text ?? '') : ''))
    .join('')
    .trim()
  const details = result.details ? JSON.stringify(result.details) : ''
  return `${result.toolCallId ?? ''}|${result.toolName ?? ''}|${result.isError ? '1' : '0'}|${text}|${details}`
}

export function toolResultsSignature(
  message: GatewayMessage,
  toolResultsByCallId: Map<string, GatewayMessage> | undefined,
): string {
  if (!toolResultsByCallId) return ''
  const toolCalls = getToolCallsFromMessage(message)
  if (toolCalls.length === 0) return ''
  return toolCalls
    .map((toolCall) => {
      if (!toolCall.id) return 'missing'
      return toolResultSignature(toolResultsByCallId.get(toolCall.id))
    })
    .join('||')
}

export function thinkingFromMessage(msg: GatewayMessage): string | null {
  const parts = Array.isArray(msg.content) ? msg.content : []
  const thinkingPart = parts.find((part) => part.type === 'thinking')
  if (thinkingPart && 'thinking' in thinkingPart) {
    return String(thinkingPart.thinking ?? '')
  }
  return null
}

export function isRenderableImagePart(
  part: MessageContentPart,
): part is ImageContent {
  return (
    part.type === 'image' &&
    part.source.type === 'base64' &&
    typeof part.source.media_type === 'string' &&
    typeof part.source.data === 'string' &&
    part.source.data.length > 0
  )
}

export function imagesFromMessage(msg: GatewayMessage): Array<ImageContent> {
  const parts = Array.isArray(msg.content) ? msg.content : []
  return parts.filter(isRenderableImagePart)
}

export function normalizedString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

export function detailsRecord(
  value: GatewayMessage['details'] | unknown,
): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

export function modelFromMessage(
  message: GatewayMessage,
  modelLabelById: ReadonlyMap<string, string>,
): string | null {
  const directMetadata = messageModelMetadata(message)
  const directLabel = displayLabelFromMetadata(directMetadata, modelLabelById)
  if (directLabel) return directLabel

  const detailsMetadata = detailsModelMetadata(message)
  return displayLabelFromMetadata(detailsMetadata, modelLabelById)
}

export function messageModelMetadata(
  message: GatewayMessage,
): MessageModelMetadata {
  return {
    id: normalizedString(message.model),
    name: normalizedString(message.modelName),
  }
}

export function detailsModelMetadata(
  message: GatewayMessage,
): MessageModelMetadata {
  const details = detailsRecord(message.details)
  const detailsModel = detailsRecord(details?.model)
  return {
    id: normalizedString(details?.model) || normalizedString(detailsModel?.id),
    name:
      normalizedString(details?.modelName) ||
      normalizedString(detailsModel?.name) ||
      normalizedString(detailsModel?.label),
  }
}

export function displayLabelFromMetadata(
  metadata: MessageModelMetadata,
  modelLabelById: ReadonlyMap<string, string>,
): string | null {
  const labelFromCatalog = catalogModelLabel(metadata.id, modelLabelById)
  if (!metadata.name) return labelFromCatalog
  if (!metadata.id || metadata.name !== metadata.id) return metadata.name
  return labelFromCatalog || metadata.name
}

export function catalogModelLabel(
  modelId: string | null,
  modelLabelById: ReadonlyMap<string, string>,
): string | null {
  if (!modelId) return null
  return modelLabelById.get(modelId) || modelId
}
