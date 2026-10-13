import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'

import { chatQueryKeys, fetchHistory } from '../chat-queries'
import type { QueryClient } from '@tanstack/react-query'
import type { ConversationTurn, HistoryResponse } from '../types'

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
  const sessionKeyForHistory = isNewChat
    ? 'new'
    : forcedSessionKey || activeSessionKey || ''
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
        return false
      })
      const serverData = await fetchHistory({
        sessionKey: sessionKeyForHistory,
        friendlyId: activeFriendlyId,
      })
      const latest = queryClient.getQueryData<HistoryResponse>(historyKey)
      if (latest && (latest.cursor ?? 0) > (serverData.cursor ?? 0))
        return latest
      if (
        !optimisticMessages.length ||
        serverData.revision !== cached?.revision
      ) {
        return serverData
      }

      const mergedWithOptimistic = mergeOptimisticHistoryMessages(
        serverData.messages,
        optimisticMessages,
      )

      return {
        ...serverData,
        messages: mergedWithOptimistic,
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

function mergeOptimisticHistoryMessages(
  serverMessages: Array<ConversationTurn>,
  optimisticMessages: Array<ConversationTurn>,
): Array<ConversationTurn> {
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
