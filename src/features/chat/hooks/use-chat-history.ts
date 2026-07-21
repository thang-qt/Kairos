import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'

import { chatQueryKeys, fetchHistory } from '../chat-queries'
import type { QueryClient } from '@tanstack/react-query'
import type { GatewayMessage, HistoryResponse } from '../types'

type UseChatHistoryInput = {
  activeFriendlyId: string
  activeSessionKey: string
  forcedSessionKey?: string
  isNewChat: boolean
  isRedirecting: boolean
  activeExists: boolean
  sessionsReady: boolean
  queryClient: QueryClient
}

export function useChatHistory({
  activeFriendlyId,
  activeSessionKey,
  forcedSessionKey,
  isNewChat,
  isRedirecting,
  activeExists,
  sessionsReady,
  queryClient,
}: UseChatHistoryInput) {
  const sessionKeyForHistory = forcedSessionKey || activeSessionKey || ''
  const historyKey = chatQueryKeys.history(
    activeFriendlyId,
    sessionKeyForHistory,
  )
  const historyQuery = useQuery({
    queryKey: historyKey,
    queryFn: async function fetchHistoryForSession() {
      const cached = queryClient.getQueryData<HistoryResponse>(historyKey)
      const cachedMessages = Array.isArray(cached?.messages)
        ? cached.messages
        : []
      const optimisticMessages = cachedMessages.filter((message) => {
        if (message.status === 'sending') return true
        if (message.__optimisticId) return true
        return Boolean(message.clientId)
      })
      const streamingMessages = cachedMessages.filter((message) => {
        const runId = (message as { __streamRunId?: unknown }).__streamRunId
        return typeof runId === 'string' && runId.trim().length > 0
      })

      const serverData = await fetchHistory({
        sessionKey: sessionKeyForHistory,
        friendlyId: activeFriendlyId,
      })
      if (!optimisticMessages.length && !streamingMessages.length) {
        return serverData
      }

      const mergedWithOptimistic = mergeOptimisticHistoryMessages(
        serverData.messages,
        optimisticMessages,
      )
      const merged = mergeStreamingHistoryMessages(
        mergedWithOptimistic,
        streamingMessages,
      )

      return {
        ...serverData,
        messages: merged,
      }
    },
    enabled:
      !isNewChat &&
      Boolean(activeFriendlyId) &&
      !isRedirecting &&
      (!sessionsReady || activeExists),
    retry: false,
    placeholderData: function useCachedHistory(): HistoryResponse | undefined {
      return queryClient.getQueryData(historyKey)
    },
    gcTime: 1000 * 60 * 10,
  })

  const historyMessages = useMemo(() => {
    return Array.isArray(historyQuery.data?.messages)
      ? historyQuery.data.messages
      : []
  }, [historyQuery.data?.messages])

  const historyError =
    historyQuery.error instanceof Error ? historyQuery.error.message : null
  const resolvedSessionKey = useMemo(() => {
    if (forcedSessionKey) return forcedSessionKey
    const key = historyQuery.data?.sessionKey
    if (typeof key === 'string' && key.trim().length > 0) return key.trim()
    return activeSessionKey
  }, [activeSessionKey, forcedSessionKey, historyQuery.data?.sessionKey])
  const activeCanonicalKey = isNewChat
    ? 'new'
    : resolvedSessionKey || activeFriendlyId

  return {
    historyQuery,
    historyMessages,
    displayMessages: historyMessages,
    historyError,
    resolvedSessionKey,
    activeCanonicalKey,
    sessionKeyForHistory,
  }
}

function mergeStreamingHistoryMessages(
  serverMessages: Array<GatewayMessage>,
  streamingMessages: Array<GatewayMessage>,
): Array<GatewayMessage> {
  if (!streamingMessages.length) return serverMessages

  const merged = [...serverMessages]
  for (const streamingMessage of streamingMessages) {
    const hasMatch = merged.some(
      function hasMatchingServerMessage(serverMessage) {
        return sameMessageIdentity(serverMessage, streamingMessage)
      },
    )

    if (!hasMatch) {
      merged.push(streamingMessage)
    }
  }

  return merged
}

function sameMessageIdentity(
  leftMessage: GatewayMessage,
  rightMessage: GatewayMessage,
): boolean {
  const leftID = normalizeString((leftMessage as { id?: unknown }).id)
  const rightID = normalizeString((rightMessage as { id?: unknown }).id)
  if (leftID && rightID) {
    return leftID === rightID
  }

  const leftRunID = normalizeString(
    (leftMessage as { __streamRunId?: unknown }).__streamRunId,
  )
  const rightRunID = normalizeString(
    (rightMessage as { __streamRunId?: unknown }).__streamRunId,
  )
  if (leftRunID && rightRunID) {
    return (
      leftRunID === rightRunID &&
      normalizeString(leftMessage.role) === normalizeString(rightMessage.role)
    )
  }

  return false
}

function mergeOptimisticHistoryMessages(
  serverMessages: Array<GatewayMessage>,
  optimisticMessages: Array<GatewayMessage>,
): Array<GatewayMessage> {
  if (!optimisticMessages.length) return serverMessages

  const merged = [...serverMessages]
  for (const optimisticMessage of optimisticMessages) {
    const hasMatch = merged.some((serverMessage) => {
      if (
        optimisticMessage.clientId &&
        serverMessage.clientId &&
        optimisticMessage.clientId === serverMessage.clientId
      ) {
        return true
      }
      return false
    })

    if (!hasMatch) {
      merged.push(optimisticMessage)
    }
  }

  return merged
}

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}
