import { getToolCallsFromMessage } from '../utils'
import type {
  ConversationTurn,
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
  resultMessage: ConversationTurn | undefined,
  assistantMessage?: ConversationTurn,
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
  const stopped =
    ['aborted', 'interrupted', 'error'].includes(toolCall.status ?? '') &&
    !hasResult
  const isError = stopped || (resultMessage?.isError ?? Boolean(outputError))

  let state: ToolPart['state']
  if (stopped) {
    state = 'output-error'
  } else if (toolCall.status === 'running') {
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
    errorText = stopped
      ? 'No result was saved for this call.'
      : resultText || outputError || 'Unknown error'
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
  resultMessage: ConversationTurn | undefined,
  resultText: string,
  assistantMessage?: ConversationTurn,
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
  resultMessage: ConversationTurn | undefined,
  assistantMessage: ConversationTurn | undefined,
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

export function runtimeToolDetailsSignature(message: ConversationTurn): string {
  const details = detailsRecord(message.details)
  if (!details) return ''
  const tools = Array.isArray(details.tools) ? details.tools : []
  return tools.length > 0 ? JSON.stringify(tools) : ''
}

export function toolResultText(
  resultMessage: ConversationTurn | undefined,
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
  message: ConversationTurn,
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
  message: ConversationTurn,
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

export function toolCallsSignature(message: ConversationTurn): string {
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
  result: ConversationTurn | undefined,
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
  message: ConversationTurn,
  toolResultsByCallId: Map<string, ConversationTurn> | undefined,
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

export function thinkingFromMessage(msg: ConversationTurn): string | null {
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

export function imagesFromMessage(msg: ConversationTurn): Array<ImageContent> {
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
  value: ConversationTurn['details'] | unknown,
): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

export function modelFromMessage(
  message: ConversationTurn,
  modelLabelById: ReadonlyMap<string, string>,
): string | null {
  const directMetadata = messageModelMetadata(message)
  const directLabel = displayLabelFromMetadata(directMetadata, modelLabelById)
  if (directLabel) return directLabel

  const detailsMetadata = detailsModelMetadata(message)
  return displayLabelFromMetadata(detailsMetadata, modelLabelById)
}

export function messageModelMetadata(
  message: ConversationTurn,
): MessageModelMetadata {
  return {
    id: normalizedString(message.model),
    name: normalizedString(message.modelName),
  }
}

export function detailsModelMetadata(
  message: ConversationTurn,
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
