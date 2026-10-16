import { useCallback, useEffect, useEffectEvent, useRef } from 'react'

import {
  chatQueryKeys,
  updateSessionLastMessage,
  upsertSessionSummary,
} from '../chat-queries'
import {
  turnFromConversationEvent,
  applyConversationEvent,
  findConversationTurn,
} from '../conversation-event-reducer'
import type { QueryClient } from '@tanstack/react-query'
import type { ConversationTurn, HistoryResponse } from '../types'
import type { ConversationEvent } from '@/lib/chat-backend'
import { getChatBackend } from '@/lib/chat-backend'

const SIDEBAR_SYNC_INTERVAL_MS = 500
const lastSidebarSyncBySession = new Map<string, number>()

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
    const hasNewRevision =
      payload.revision !== undefined &&
      payload.revision > (cached?.revision ?? -1)
    if (hasNewRevision) {
      refreshHistoryRef.current()
    }
    if (payload.mcpApproval) {
      const approval = payload.mcpApproval
      function applyApproval(
        previous: HistoryResponse | undefined,
      ): HistoryResponse {
        const pending = (previous?.pendingMcpApprovals ?? []).filter(
          (item) => item.id !== approval.id,
        )
        if (approval.state === 'pending') pending.push(approval)
        return {
          ...previous,
          sessionKey: previous?.sessionKey ?? sessionKeyForHistory,
          messages: previous?.messages ?? [],
          pendingMcpApprovals: pending,
          revision: payload.revision ?? previous?.revision,
          cursor: payload.cursor ?? previous?.cursor,
        }
      }
      queryClient.setQueryData<HistoryResponse>(key, applyApproval)
      if (payload.sessionKey && payload.sessionKey !== sessionKeyForHistory) {
        queryClient.setQueryData<HistoryResponse>(
          chatQueryKeys.history(activeFriendlyId, payload.sessionKey),
          applyApproval,
        )
      }
      return
    }
    onChatEvent?.(payload)

    const payloadState = typeof payload.state === 'string' ? payload.state : ''
    const payloadSessionKey =
      typeof payload.sessionKey === 'string' ? payload.sessionKey : ''
    const syncSidebar = shouldSyncSidebar(
      `${activeFriendlyId}:${payloadSessionKey || sessionKeyForHistory}`,
      payloadState,
    )

    const authoritativeSession =
      payload.session && typeof payload.session === 'object'
        ? payload.session
        : null
    if (authoritativeSession && syncSidebar) {
      upsertSessionSummary(queryClient, authoritativeSession)
    }
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
        function applyTerminalEvent(previous: HistoryResponse | undefined) {
          const previousMessages = previous?.messages ?? []
          const messages =
            payloadState === 'reconcile' &&
            hasNewRevision &&
            previous?.revision !== undefined
              ? []
              : previousMessages
          return {
            ...previous,
            sessionKey: previous?.sessionKey ?? sessionKeyForHistory,
            pendingMcpApprovals: remainingApprovals(previous, payload),
            messages: applyConversationEvent(messages, payload),
            revision: payload.revision ?? previous?.revision,
            cursor: payload.cursor ?? previous?.cursor,
          }
        }
        queryClient.setQueryData<HistoryResponse>(key, applyTerminalEvent)
        if (payloadSessionKey && payloadSessionKey !== sessionKeyForHistory) {
          queryClient.setQueryData<HistoryResponse>(
            chatQueryKeys.history(activeFriendlyId, payloadSessionKey),
            function reduceMirroredTerminalEvent(previous) {
              const previousMessages = previous?.messages ?? []
              const messages =
                payloadState === 'reconcile' &&
                hasNewRevision &&
                previous?.revision !== undefined
                  ? []
                  : previousMessages
              return {
                ...previous,
                sessionKey: previous?.sessionKey ?? payloadSessionKey,
                pendingMcpApprovals: remainingApprovals(previous, payload),
                messages: applyConversationEvent(messages, payload),
                revision: payload.revision ?? previous?.revision,
                cursor: payload.cursor ?? previous?.cursor,
              }
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
      !findConversationTurn(cached?.messages ?? [], payload.turnId)
    ) {
      refreshHistoryRef.current()
      return
    }

    let nextMessages = cached?.messages ?? []
    queryClient.setQueryData<HistoryResponse>(
      key,
      function reduceEvent(previous) {
        const previousMessages = previous?.messages ?? []
        const messages =
          payloadState === 'reconcile' &&
          hasNewRevision &&
          previous?.revision !== undefined
            ? []
            : previousMessages
        nextMessages = applyConversationEvent(messages, payload)
        return {
          ...previous,
          sessionKey: previous?.sessionKey ?? sessionKeyForHistory,
          pendingMcpApprovals: remainingApprovals(previous, payload),
          messages: nextMessages,
          revision: payload.revision ?? previous?.revision,
          cursor: payload.cursor ?? previous?.cursor,
        }
      },
    )

    if (payloadSessionKey && payloadSessionKey !== sessionKeyForHistory) {
      queryClient.setQueryData<HistoryResponse>(
        chatQueryKeys.history(activeFriendlyId, payloadSessionKey),
        function reduceMirroredEvent(previous) {
          const previousMessages = previous?.messages ?? []
          const messages =
            payloadState === 'reconcile' &&
            hasNewRevision &&
            previous?.revision !== undefined
              ? []
              : previousMessages
          return {
            ...previous,
            sessionKey: previous?.sessionKey ?? payloadSessionKey,
            pendingMcpApprovals: remainingApprovals(previous, payload),
            messages: applyConversationEvent(messages, payload),
            revision: payload.revision ?? previous?.revision,
            cursor: payload.cursor ?? previous?.cursor,
          }
        },
      )
    }

    const nextMessage = payload.message
      ? turnFromConversationEvent(payload)
      : findConversationTurn(nextMessages, payload.turnId)
    if (!nextMessage) return
    if (payloadSessionKey && !authoritativeSession && syncSidebar) {
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

function shouldSyncSidebar(sessionKey: string, state: string): boolean {
  const now = Date.now()
  const previousSync = lastSidebarSyncBySession.get(sessionKey) ?? 0
  const boundary =
    state === 'user' ||
    state === 'final' ||
    state === 'error' ||
    state === 'aborted' ||
    state === 'reconcile'
  if (!boundary && now - previousSync < SIDEBAR_SYNC_INTERVAL_MS) return false
  lastSidebarSyncBySession.set(sessionKey, now)
  if (lastSidebarSyncBySession.size > 100) {
    const oldest = lastSidebarSyncBySession.keys().next().value
    if (oldest) lastSidebarSyncBySession.delete(oldest)
  }
  return true
}

function remainingApprovals(
  previous: HistoryResponse | undefined,
  event: ConversationEvent,
) {
  const pending = previous?.pendingMcpApprovals ?? []
  if (event.state === 'reconcile') {
    return pending.filter((approval) =>
      (event.activeRunIds ?? []).includes(approval.runId),
    )
  }
  if (isTerminalState(event.state ?? '')) {
    return pending.filter((approval) => approval.runId !== event.runId)
  }
  return pending
}
