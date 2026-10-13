import { useCallback, useEffect, useEffectEvent, useRef } from 'react'

import {
  chatQueryKeys,
  updateHistoryMessages,
  updateSessionLastMessage,
  upsertSessionSummary,
} from '../chat-queries'
import {
  turnFromConversationEvent,
  applyConversationEvent,
} from '../conversation-event-reducer'
import type { QueryClient } from '@tanstack/react-query'
import type { ConversationTurn, HistoryResponse } from '../types'
import type { ConversationEvent } from '@/lib/chat-backend'
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
    message?: ConversationTurn
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
    payload: ConversationEvent,
  ) {
    if (payload.state === 'heartbeat') return
    const key = chatQueryKeys.history(activeFriendlyId, sessionKeyForHistory)
    const cached = queryClient.getQueryData<HistoryResponse>(key)
    if (payload.snapshot) {
      if (
        (payload.snapshot.revision ?? 0) >= (cached?.revision ?? -1) &&
        (payload.snapshot.cursor ?? 0) >= (cached?.cursor ?? 0)
      ) {
        queryClient.setQueryData(key, payload.snapshot)
        onChatEvent?.(payload)
      }
      return
    }
    if (
      payload.revision !== undefined &&
      payload.revision < (cached?.revision ?? -1)
    )
      return
    if (payload.cursor && payload.cursor <= (cached?.cursor ?? 0)) return
    if (
      payload.revision !== undefined &&
      payload.revision > (cached?.revision ?? -1)
    ) {
      queryClient.setQueryData<HistoryResponse>(
        key,
        function setRevision(previous) {
          return {
            ...previous,
            sessionKey: previous?.sessionKey ?? sessionKeyForHistory,
            messages:
              payload.state === 'reconcile' && previous?.revision !== undefined
                ? []
                : (previous?.messages ?? []),
            revision: payload.revision,
          }
        },
      )
      refreshHistoryRef.current()
    }
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
    if (
      (!payload.message || typeof payload.message !== 'object') &&
      !payload.turnPatch?.length
    ) {
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
            return applyConversationEvent(messages, payload)
          },
        )
        if (payloadSessionKey && payloadSessionKey !== sessionKeyForHistory) {
          updateHistoryMessages(
            queryClient,
            activeFriendlyId,
            payloadSessionKey,
            function reduceMirroredTerminalEvent(messages) {
              return applyConversationEvent(messages, payload)
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

    if (
      !payload.message &&
      !cached?.messages.some(function target(turn) {
        return turn.id === payload.turnId
      })
    ) {
      refreshHistoryRef.current()
      return
    }

    updateHistoryMessages(
      queryClient,
      activeFriendlyId,
      sessionKeyForHistory,
      function reduceEvent(messages) {
        return applyConversationEvent(messages, payload)
      },
    )

    if (payloadSessionKey && payloadSessionKey !== sessionKeyForHistory) {
      updateHistoryMessages(
        queryClient,
        activeFriendlyId,
        payloadSessionKey,
        function reduceMirroredEvent(messages) {
          return applyConversationEvent(messages, payload)
        },
      )
    }

    const nextMessage = payload.message
      ? turnFromConversationEvent(payload)
      : queryClient
          .getQueryData<HistoryResponse>(key)
          ?.messages.find(function target(turn) {
            return turn.id === payload.turnId
          })
    if (!nextMessage) return
    if (payloadSessionKey && !authoritativeSession) {
      updateSessionLastMessage(
        queryClient,
        payloadSessionKey,
        activeFriendlyId,
        nextMessage,
      )
    }

    queryClient.setQueryData<HistoryResponse>(
      key,
      function advanceCursor(previous) {
        if (!previous) return previous
        return {
          ...previous,
          revision: payload.revision ?? previous.revision,
          cursor: payload.cursor ?? previous.cursor,
        }
      },
    )
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
