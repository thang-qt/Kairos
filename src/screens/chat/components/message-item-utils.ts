import { getToolCallsFromMessage, textFromMessage } from '../utils'
import type {
  GatewayMessage,
  ImageContent,
  MessageContent as MessageContentPart,
  ToolCallContent,
} from '../types'
import type { ToolPart } from '@/components/prompt-kit/tool'
export {
  mapSearchDetailsToToolPart,
  searchDetailsSignature,
} from './web-tool-utils'

type MessageModelMetadata = {
  id: string | null
  name: string | null
}

export function mapToolCallToToolPart(
  toolCall: ToolCallContent,
  resultMessage: GatewayMessage | undefined,
  assistantMessage?: GatewayMessage,
): ToolPart {
  const resultText = toolResultText(resultMessage)
  const output = toolCallOutput(
    toolCall,
    resultMessage,
    resultText,
    assistantMessage,
  )
  const outputError = normalizedString(output?.error)
  const hasResult = resultMessage !== undefined || output !== undefined
  const isError = resultMessage?.isError ?? Boolean(outputError)

  let state: ToolPart['state']
  if (toolCall.status === 'running') {
    state = 'input-streaming'
  } else if (toolCall.status === 'completed') {
    state = 'output-available'
  } else if (!hasResult) {
    state = 'input-available'
  } else if (isError) {
    state = 'output-error'
  } else {
    state = 'output-available'
  }

  // Extract error text from result message content
  let errorText: string | undefined
  if (isError) {
    errorText = resultText || outputError || 'Unknown error'
  }

  return {
    type: toolCall.name || 'unknown',
    state,
    input: toolCall.arguments,
    output,
    toolCallId: toolCall.id,
    emoji: toolCall.emoji,
    compact: toolCall.status !== undefined,
    errorText,
  }
}

function toolCallOutput(
  toolCall: ToolCallContent,
  resultMessage: GatewayMessage | undefined,
  resultText: string,
  assistantMessage?: GatewayMessage,
): Record<string, unknown> | undefined {
  const details = detailsRecord(resultMessage?.details)
  const persistedResult = persistedToolResult(
    toolCall,
    resultMessage,
    assistantMessage,
  )
  if (persistedResult) return persistedResult
  if (details) return details
  if (resultText) return parseToolResultText(resultText)
  return undefined
}

function persistedToolResult(
  toolCall: ToolCallContent,
  resultMessage: GatewayMessage | undefined,
  assistantMessage: GatewayMessage | undefined,
): Record<string, unknown> | undefined {
  const callId = normalizedString(toolCall.id)
  if (!callId || resultMessage) return undefined
  const messageDetails = detailsRecord(assistantMessage?.details)
  const events = Array.isArray(messageDetails?.tools)
    ? messageDetails.tools
    : []
  for (const event of events) {
    const record = detailsRecord(event)
    if (normalizedString(record?.id) !== callId) continue
    const result = detailsRecord(record?.result)
    if (result) {
      const durationMs = normalizedNumber(record?.durationMs)
      return durationMs === undefined ? result : { ...result, durationMs }
    }
    const error = normalizedString(record?.error)
    if (error) return { error }
  }
  return undefined
}

function parseToolResultText(
  text: string,
): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(text)
    const record = detailsRecord(parsed)
    if (record) return record
  } catch {
    // fall through to plain text output
  }
  return { text }
}

export function runtimeToolDetailsSignature(message: GatewayMessage): string {
  const details = detailsRecord(message.details)
  if (!details) return ''
  const tools = Array.isArray(details.tools) ? details.tools : []
  const hermesToolProgress = Array.isArray(details.hermesToolProgress)
    ? details.hermesToolProgress
    : []
  return tools.length > 0 || hermesToolProgress.length > 0
    ? JSON.stringify({ tools, hermesToolProgress })
    : ''
}

export function hermesToolPartsFromMessage(
  message: GatewayMessage,
): Array<ToolPart> {
  const details = detailsRecord(message.details)
  const progress = Array.isArray(details?.hermesToolProgress)
    ? details.hermesToolProgress
    : []

  return progress.flatMap(function toToolPart(value) {
    const item = detailsRecord(value)
    const toolCallId = normalizedString(item?.toolCallId)
    const type = normalizedString(item?.tool)
    if (!toolCallId || !type) return []

    const label = normalizedString(item?.label)
    const status = normalizedString(item?.status)
    const durationMs = normalizedNumber(item?.durationMs)
    return [
      {
        type,
        state: status === 'completed' ? 'output-available' : 'input-available',
        input: label ? { label } : undefined,
        toolCallId,
        emoji: normalizedString(item?.emoji) ?? undefined,
        durationMs,
        compact: true,
      },
    ]
  })
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
      const status = toolCall.status ?? ''
      const emoji = toolCall.emoji ?? ''
      return `${id}|${name}|${partialJson}|${args}|${status}|${emoji}`
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
  const runId = typeof message.runId === 'string' ? message.runId : ''
  return toolCalls
    .map((toolCall) => {
      if (!toolCall.id) return 'missing'
      const keyed = runId ? `${runId}\u0000${toolCall.id}` : toolCall.id
      return toolResultSignature(
        toolResultsByCallId.get(keyed) ?? toolResultsByCallId.get(toolCall.id),
      )
    })
    .join('||')
}

export function toolChainMessagesSignature(
  messages: Array<GatewayMessage> | undefined,
  toolResultsByCallId: Map<string, GatewayMessage> | undefined,
): string {
  if (!messages?.length) return ''
  return messages
    .map(
      (message) =>
        `${message.id ?? ''}:${textFromMessage(message)}:${thinkingFromMessage(message) ?? ''}:${toolCallsSignature(message)}:${toolResultsSignature(message, toolResultsByCallId)}`,
    )
    .join('##')
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

function normalizedNumber(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
  return value
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
