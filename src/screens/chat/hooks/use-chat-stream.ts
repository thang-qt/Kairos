import { useCallback, useEffect, useEffectEvent, useRef } from 'react'

import {
  updateHistoryMessages,
  updateSessionLastMessage,
  upsertSessionSummary,
} from '../chat-queries'
import type { QueryClient } from '@tanstack/react-query'
import type { GatewayMessage } from '../types'
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
    error?: string
    activeRunIds?: Array<string>
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

    const authoritativeSession =
      payload.session && typeof payload.session === 'object'
        ? payload.session
        : null
    if (authoritativeSession) {
      upsertSessionSummary(queryClient, authoritativeSession)
    }

    const payloadSessionKey =
      typeof payload.sessionKey === 'string' ? payload.sessionKey : ''

    if (!payload.message || typeof payload.message !== 'object') {
      if (
        payloadState === 'reconcile' ||
        payloadState === 'final' ||
        payloadState === 'error' ||
        payloadState === 'aborted'
      ) {
        refreshHistoryRef.current()
      }
      return
    }

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
      runId:
        typeof payload.message.runId === 'string' &&
        payload.message.runId.trim().length > 0
          ? payload.message.runId
          : streamRunId,
      __streamRunId: payloadState === 'delta' ? streamRunId : null,
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

    if (payloadSessionKey && !authoritativeSession) {
      updateSessionLastMessage(
        queryClient,
        payloadSessionKey,
        activeFriendlyId,
        nextMessage,
      )
    }

    if (
      payloadState === 'final' ||
      payloadState === 'error' ||
      payloadState === 'aborted'
    ) {
      refreshHistoryRef.current()
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
      onReconnect: () => refreshHistoryRef.current(),
      onReconcile: () => refreshHistoryRef.current(),
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
  const nextContent = Array.isArray(nextMessage.content)
    ? nextMessage.content
    : []

  if (previousContent.length === 0) {
    return nextMessage
  }

  // Each streaming delta carries the full accumulated content snapshot.
  // When the next delta has content, use it as the authoritative source
  // instead of merging with previous content. This prevents stale parts
  // (e.g. reasoning text suppressed after tool calls appear) from
  // persisting in the merged message.
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
    const runId = normalizeString(
      (message as { __streamRunId?: unknown }).__streamRunId,
    )
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
