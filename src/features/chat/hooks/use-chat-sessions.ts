import { useCallback, useMemo } from 'react'
import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { sessionListQueryOptions, upsertSessionSummary } from '../chat-queries'
import { cachedSessions } from '../session-cache'
import { isRecentSession } from '../pending-send'
import { filterSessionsWithTombstones } from '../session-tombstones'
import { getSessionDisplayTitle, isSessionNotFound } from '../utils'
import { getChatBackend } from '@/lib/chat-backend'
import { ApiError } from '@/lib/api-client'

type UseChatSessionsInput = {
  activeFriendlyId: string
  isNewChat: boolean
  forcedSessionKey?: string
}

export function useChatSessions({
  activeFriendlyId,
  isNewChat,
  forcedSessionKey,
}: UseChatSessionsInput) {
  const queryClient = useQueryClient()
  const sessionsQuery = useInfiniteQuery({
    ...sessionListQueryOptions(),
    staleTime: 1000 * 15,
    refetchInterval: 1000 * 60 * 5,
    refetchOnMount: 'always',
    refetchOnWindowFocus: false,
    refetchOnReconnect: 'always',
  })
  const loaded = useMemo(
    function loadedSessions() {
      return filterSessionsWithTombstones(cachedSessions(sessionsQuery.data))
    },
    [sessionsQuery.data],
  )
  const listedActive = loaded.find(function active(session) {
    return session.friendlyId === activeFriendlyId
  })
  const sessionsReady = Boolean(sessionsQuery.data?.pages.length)
  const lookupEnabled =
    !isNewChat && !forcedSessionKey && sessionsReady && !listedActive
  const activeQuery = useQuery({
    queryKey: ['chat', 'session-summary', activeFriendlyId],
    queryFn: async function fetchActive({ signal }) {
      const backend = getChatBackend()
      if (!backend.getConversation) throw new Error('Session not found.')
      const session = await backend.getConversation(activeFriendlyId, signal)
      upsertSessionSummary(queryClient, session)
      return session
    },
    enabled: lookupEnabled,
    retry: false,
  })
  const activeMissing =
    (activeQuery.error instanceof ApiError &&
      activeQuery.error.status === 404) ||
    (activeQuery.error instanceof Error &&
      isSessionNotFound(activeQuery.error.message))
  const activeSession =
    listedActive ?? (activeMissing ? undefined : activeQuery.data)
  const sessions = useMemo(
    function includeLinkedSession() {
      return activeSession && !listedActive
        ? [...loaded, activeSession]
        : loaded
    },
    [loaded, activeSession, listedActive],
  )
  const activeExists =
    isNewChat ||
    Boolean(forcedSessionKey) ||
    isRecentSession(activeFriendlyId) ||
    Boolean(activeSession) ||
    (lookupEnabled && !activeMissing)
  const activeSessionKey = activeSession?.key ?? ''
  const hasActiveTitle = Boolean(
    activeSession?.label || activeSession?.title || activeSession?.derivedTitle,
  )
  const activeTitle = getSessionDisplayTitle(activeSession)
  const error = !sessionsQuery.isFetchNextPageError ? sessionsQuery.error : null
  const sessionsError =
    error instanceof Error
      ? error.message
      : activeQuery.error instanceof Error
        ? activeQuery.error.message
        : null
  const loadMoreSessions = useCallback(
    function loadMore() {
      if (!sessionsQuery.hasNextPage || sessionsQuery.isFetching) return
      void sessionsQuery
        .fetchNextPage({ cancelRefetch: false })
        .catch(function ignoreFetchError() {})
    },
    [
      sessionsQuery.fetchNextPage,
      sessionsQuery.hasNextPage,
      sessionsQuery.isFetching,
    ],
  )
  return {
    sessionsQuery,
    sessionsReady,
    sessions,
    activeSession,
    activeExists,
    activeSessionKey,
    hasActiveTitle,
    activeTitle,
    sessionsError,
    hasMoreSessions: sessionsQuery.hasNextPage,
    loadingMoreSessions: sessionsQuery.isFetching,
    sessionLoadError: sessionsQuery.isFetchNextPageError
      ? 'Unable to load more conversations.'
      : null,
    loadMoreSessions,
  }
}
