import { useCallback, useEffect, useEffectEvent, useRef } from 'react'

import { getMessageTimestamp, textFromMessage } from '../utils'
import {
  updateHistoryMessages,
  updateSessionLastMessage,
} from '../chat-queries'
import type { QueryClient } from '@tanstack/react-query'
import type { GatewayMessage, MessageContent } from '../types'
import type { ChatEvent } from '@/lib/chat-backend'
import { getChatBackend } from '@/lib/chat-backend'

type UseChatStreamInput = {
  activeFriendlyId: string
  isNewChat: boolean
  isRedirecting: boolean
  resolvedSessionKey: string
  sessionKeyForHistory: string
  queryClient: QueryClient
  refreshHistory: () => void
  onChatEvent?: (payload: {
    runId?: string
    sessionKey?: string
    state?: string
    message?: GatewayMessage
  }) => void
}

export function useChatStream({
  activeFriendlyId,
  isNewChat,
  isRedirecting,
  resolvedSessionKey,
  sessionKeyForHistory,
  queryClient,
  refreshHistory,
  onChatEvent,
}: UseChatStreamInput) {
  const unsubscribeRef = useRef<(() => void) | null>(null)
  const refreshHistoryRef = useRef(refreshHistory)
  refreshHistoryRef.current = refreshHistory
  const handleChatEvent = useEffectEvent(function handleChatEvent(
    payload: ChatEvent,
  ) {
    onChatEvent?.(payload)

    const payloadState = typeof payload.state === 'string' ? payload.state : ''
    if (
      payloadState === 'final' ||
      payloadState === 'error' ||
      payloadState === 'aborted'
    ) {
      refreshHistoryRef.current()
    }

    if (!payload.message || typeof payload.message !== 'object') {
      return
    }

    const payloadSessionKey =
      typeof payload.sessionKey === 'string' ? payload.sessionKey : ''
    if (
      payloadSessionKey &&
      resolvedSessionKey &&
      payloadSessionKey !== resolvedSessionKey &&
      payloadSessionKey !== sessionKeyForHistory
    ) {
      return
    }

    const streamRunId =
      typeof payload.runId === 'string' ? payload.runId : undefined
    const nextMessage: GatewayMessage = {
      ...payload.message,
      __streamRunId: streamRunId,
    }

    function upsert(messages: Array<GatewayMessage>) {
      const nextId = getMessageId(nextMessage)
      if (nextId) {
        const existingById = messages.findIndex(
          (message) => getMessageId(message) === nextId,
        )
        if (existingById >= 0) {
          const next = [...messages]
          next[existingById] = mergeStreamMessage(
            messages[existingById],
            nextMessage,
          )
          return next
        }
      }

      if (streamRunId) {
        const existingByRunId = findStreamMessageIndex(
          messages,
          nextMessage,
          streamRunId,
        )
        if (existingByRunId >= 0) {
          const next = [...messages]
          next[existingByRunId] = mergeStreamMessage(
            messages[existingByRunId],
            nextMessage,
          )
          return next
        }
      }

      if (nextMessage.role === 'assistant') {
        const previousAssistantIndex = [...messages]
          .reverse()
          .findIndex((message) => message.role === 'assistant')
        if (previousAssistantIndex >= 0) {
          const targetIndex = messages.length - 1 - previousAssistantIndex
          const previousAssistant = messages[targetIndex]
          const previousText = textFromMessage(previousAssistant)
          const nextText = textFromMessage(nextMessage)
          const timeGap = Math.abs(
            getMessageTimestamp(previousAssistant) -
              getMessageTimestamp(nextMessage),
          )
          if (
            timeGap <= 15000 ||
            shouldMergeAssistantByText(previousText, nextText)
          ) {
            const next = [...messages]
            next[targetIndex] = mergeStreamMessage(
              previousAssistant,
              nextMessage,
            )
            return next
          }
        }
      }

      return [...messages, nextMessage]
    }

    updateHistoryMessages(
      queryClient,
      activeFriendlyId,
      sessionKeyForHistory,
      upsert,
    )

    if (payloadSessionKey && payloadSessionKey !== sessionKeyForHistory) {
      updateHistoryMessages(
        queryClient,
        activeFriendlyId,
        payloadSessionKey,
        upsert,
      )
    }

    if (payloadSessionKey) {
      updateSessionLastMessage(
        queryClient,
        payloadSessionKey,
        activeFriendlyId,
        nextMessage,
      )
    }
  })

  const stopStream = useCallback(() => {
    unsubscribeRef.current?.()
    unsubscribeRef.current = null
  }, [])

  useEffect(() => {
    if (!activeFriendlyId || isNewChat || isRedirecting) {
      stopStream()
      return
    }

    const backend = getChatBackend()
    const sessionKey = resolvedSessionKey || sessionKeyForHistory || undefined
    const unsubscribe = backend.subscribeToConversation({
      sessionKey,
      friendlyId: activeFriendlyId,
      onEvent: handleChatEvent,
    })

    unsubscribeRef.current = unsubscribe
    return function cleanup() {
      unsubscribe()
      if (unsubscribeRef.current === unsubscribe) {
        unsubscribeRef.current = null
      }
    }
  }, [
    activeFriendlyId,
    isNewChat,
    isRedirecting,
    onChatEvent,
    queryClient,
    resolvedSessionKey,
    sessionKeyForHistory,
    stopStream,
  ])

  return { stopStream }
}

function mergeStreamMessage(
  previousMessage: GatewayMessage,
  nextMessage: GatewayMessage,
): GatewayMessage {
  const previousContent = Array.isArray(previousMessage.content)
    ? previousMessage.content
    : []
  const nextContent = Array.isArray(nextMessage.content) ? nextMessage.content : []

  if (previousContent.length === 0) {
    return nextMessage
  }

  if (nextContent.length === 0) {
    return { ...previousMessage, ...nextMessage }
  }

  return {
    ...previousMessage,
    ...nextMessage,
    content: mergeMessageContent(previousContent, nextContent),
  }
}

function mergeMessageContent(
  previousContent: Array<MessageContent>,
  nextContent: Array<MessageContent>,
): Array<MessageContent> {
  const mergedByIdentity = new Map<string, MessageContent>()
  const orderedKeys: Array<string> = []

  function upsertPart(part: MessageContent) {
    const identity = partIdentity(part)
    if (!mergedByIdentity.has(identity)) {
      orderedKeys.push(identity)
    }
    mergedByIdentity.set(identity, part)
  }

  for (const part of previousContent) {
    upsertPart(part)
  }
  for (const part of nextContent) {
    upsertPart(part)
  }

  return orderedKeys
    .map((key) => mergedByIdentity.get(key))
    .filter((part): part is MessageContent => Boolean(part))
}

function partIdentity(part: MessageContent): string {
  switch (part.type) {
    case 'text':
      return 'text'
    case 'thinking':
      return 'thinking'
    case 'toolCall': {
      const toolCallId = normalizeString((part as { id?: unknown }).id)
      const toolName = normalizeString((part as { name?: unknown }).name)
      if (toolCallId || toolName) {
        return `toolCall:${toolCallId}:${toolName}`
      }
      return `toolCall:${JSON.stringify(part)}`
    }
    default:
      return 'unknown'
  }
}

function findStreamMessageIndex(
  messages: Array<GatewayMessage>,
  targetMessage: GatewayMessage,
  streamRunId: string,
): number {
  const targetId = getMessageId(targetMessage)
  if (targetId) {
    const byId = messages.findIndex((message) => getMessageId(message) === targetId)
    if (byId >= 0) return byId
  }

  const targetRole = normalizeString(targetMessage.role)
  let index = -1
  messages.forEach((message, currentIndex) => {
    const runId = normalizeString((message as { __streamRunId?: unknown }).__streamRunId)
    if (!runId || runId !== streamRunId) return
    if (normalizeString(message.role) !== targetRole) return
    index = currentIndex
  })
  return index
}

function getMessageId(message: GatewayMessage): string {
  return normalizeString((message as { id?: unknown }).id)
}

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function shouldMergeAssistantByText(previousText: string, nextText: string): boolean {
  if (!previousText || !nextText) return false
  if (previousText === nextText) return true

  const previousNormalized = normalizeAssistantTextForDedup(previousText)
  const nextNormalized = normalizeAssistantTextForDedup(nextText)
  if (!previousNormalized || !nextNormalized) return false
  if (previousNormalized === nextNormalized) return true
  if (previousNormalized.includes(nextNormalized)) return true
  if (nextNormalized.includes(previousNormalized)) return true
  return false
}

function normalizeAssistantTextForDedup(text: string): string {
  return text
    .replace(/\[\[reply_to:[^\]]*\]\]\s*/gi, '')
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
}
