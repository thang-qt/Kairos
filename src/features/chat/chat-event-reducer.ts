import type { GatewayMessage } from './types'
import type { ChatEvent } from '@/lib/chat-backend'

export function messageFromChatEvent(event: ChatEvent): GatewayMessage | null {
  if (!event.message || typeof event.message !== 'object') {
    return null
  }
  const runId =
    typeof event.runId === 'string' && event.runId.trim()
      ? event.runId.trim()
      : undefined
  return {
    ...event.message,
    runId:
      typeof event.message.runId === 'string' &&
      event.message.runId.trim().length > 0
        ? event.message.runId
        : runId,
    __streamRunId: event.state === 'delta' ? runId : null,
  }
}

export function reduceChatEventMessages(
  messages: Array<GatewayMessage>,
  event: ChatEvent,
  options?: {
    retainRunMessagesOnTerminal?: boolean
  },
): Array<GatewayMessage> {
  const nextMessage = messageFromChatEvent(event)
  const runId = normalizeString(event.runId)
  let nextMessages = messages

  if (nextMessage) {
    const nextId = getMessageId(nextMessage)
    if (nextId) {
      const existingById = messages.findIndex(
        (message) => getMessageId(message) === nextId,
      )
      if (existingById >= 0) {
        nextMessages = [...messages]
        nextMessages[existingById] = mergeStreamMessage(
          messages[existingById],
          nextMessage,
        )
      } else {
        nextMessages = [...messages, nextMessage]
      }
    } else if (runId) {
      const existingByRunId = findStreamMessageIndex(
        messages,
        nextMessage,
        runId,
      )
      if (existingByRunId >= 0) {
        nextMessages = [...messages]
        nextMessages[existingByRunId] = mergeStreamMessage(
          messages[existingByRunId],
          nextMessage,
        )
      } else {
        nextMessages = [...messages, nextMessage]
      }
    } else {
      nextMessages = [...messages, nextMessage]
    }
  }

  if (!runId || !isTerminalState(event.state ?? '')) {
    return nextMessages
  }
  if (options?.retainRunMessagesOnTerminal) {
    return nextMessages.map(function freezeRunMessage(message) {
      if (getStreamRunId(message) !== runId) return message
      return { ...message, __streamRunId: null }
    })
  }
  return nextMessages.filter((message) => getStreamRunId(message) !== runId)
}

function mergeStreamMessage(
  previousMessage: GatewayMessage,
  nextMessage: GatewayMessage,
): GatewayMessage {
  const previousContent = Array.isArray(previousMessage.content)
    ? previousMessage.content
    : []
  const nextContent = Array.isArray(nextMessage.content)
    ? nextMessage.content
    : []

  if (previousContent.length === 0) {
    return nextMessage
  }
  if (nextContent.length > 0) {
    return {
      ...previousMessage,
      ...nextMessage,
      content: nextContent,
    }
  }
  return { ...previousMessage, ...nextMessage }
}

export function findStreamMessageIndex(
  messages: Array<GatewayMessage>,
  targetMessage: GatewayMessage,
  streamRunId: string,
): number {
  const targetId = getMessageId(targetMessage)
  if (targetId) {
    return messages.findIndex((message) => getMessageId(message) === targetId)
  }

  const targetRole = normalizeString(targetMessage.role)
  let index = -1
  messages.forEach((message, currentIndex) => {
    const runId = getStreamRunId(message)
    if (!runId || runId !== streamRunId) return
    if (normalizeString(message.role) !== targetRole) return
    if (index === -2) return
    if (index >= 0) {
      index = -2
      return
    }
    index = currentIndex
  })
  return index >= 0 ? index : -1
}

function isTerminalState(state: string): boolean {
  return state === 'final' || state === 'error' || state === 'aborted'
}

function getStreamRunId(message: GatewayMessage): string {
  return normalizeString((message as { __streamRunId?: unknown }).__streamRunId)
}

function getMessageId(message: GatewayMessage): string {
  return normalizeString((message as { id?: unknown }).id)
}

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}
