import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'

import { chatQueryKeys, fetchHistory } from '../chat-queries'
import { resolveConversationSessionKey } from '../conversation-identity'
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
    : resolveConversationSessionKey({ activeSessionKey, forcedSessionKey })
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
  const historyResolvedSessionKey =
    typeof historyQuery.data?.sessionKey === 'string' &&
    historyQuery.data.sessionKey.trim().length > 0
      ? historyQuery.data.sessionKey.trim()
      : undefined
  const resolvedSessionKey = useMemo(() => {
    return resolveConversationSessionKey({
      activeSessionKey,
      forcedSessionKey,
      resolvedSessionKey: historyResolvedSessionKey,
    })
  }, [activeSessionKey, forcedSessionKey, historyResolvedSessionKey])
  const activeCanonicalKey = isNewChat
    ? 'new'
    : resolveConversationSessionKey({ activeFriendlyId, resolvedSessionKey })

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
