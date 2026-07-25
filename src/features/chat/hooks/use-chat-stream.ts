import { useCallback, useEffect, useEffectEvent, useRef } from 'react'

import {
  updateHistoryMessages,
  updateSessionLastMessage,
  upsertSessionSummary,
} from '../chat-queries'
import {
  findStreamMessageIndex,
  messageFromChatEvent,
  reduceChatEventMessages,
} from '../chat-event-reducer'
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
        updateHistoryMessages(
          queryClient,
          activeFriendlyId,
          sessionKeyForHistory,
          function reduceTerminalEvent(messages) {
            return reduceChatEventMessages(messages, payload)
          },
        )
        if (payloadSessionKey && payloadSessionKey !== sessionKeyForHistory) {
          updateHistoryMessages(
            queryClient,
            activeFriendlyId,
            payloadSessionKey,
            function reduceMirroredTerminalEvent(messages) {
              return reduceChatEventMessages(messages, payload)
            },
          )
        }
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

    const nextMessage = messageFromChatEvent(payload)
    if (!nextMessage) return

    updateHistoryMessages(
      queryClient,
      activeFriendlyId,
      sessionKeyForHistory,
      function reduceEvent(messages) {
        return reduceChatEventMessages(messages, payload)
      },
    )

    if (payloadSessionKey && payloadSessionKey !== sessionKeyForHistory) {
      updateHistoryMessages(
        queryClient,
        activeFriendlyId,
        payloadSessionKey,
        function reduceMirroredEvent(messages) {
          return reduceChatEventMessages(messages, payload)
        },
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

    if (isTerminalState(payloadState)) {
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

function isTerminalState(state: string): boolean {
  return state === 'final' || state === 'error' || state === 'aborted'
}

export { findStreamMessageIndex }
