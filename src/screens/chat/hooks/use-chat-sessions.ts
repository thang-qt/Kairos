import { useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'

import { chatQueryKeys, fetchSessions } from '../chat-queries'
import { isRecentSession } from '../pending-send'
import { filterSessionsWithTombstones } from '../session-tombstones'
import type { SessionMeta } from '../types'

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
  const sessionsQuery = useQuery({
    queryKey: chatQueryKeys.sessions,
    queryFn: async function fetchAndMergeSessions() {
      const serverSessions = await fetchSessions()
      const cachedSessions =
        queryClient.getQueryData<Array<SessionMeta>>(chatQueryKeys.sessions) ??
        []
      return mergeSessionLists(serverSessions, cachedSessions)
    },
    refetchInterval: 30000,
  })

  const sessions = useMemo(() => {
    const rawSessions = sessionsQuery.data ?? []
    return filterSessionsWithTombstones(rawSessions)
  }, [sessionsQuery.data])

  const activeSession = useMemo(() => {
    return sessions.find((session) => session.friendlyId === activeFriendlyId)
  }, [sessions, activeFriendlyId])
  const activeExists = useMemo(() => {
    if (isNewChat) return true
    if (forcedSessionKey) return true
    if (isRecentSession(activeFriendlyId)) return true
    return sessions.some((session) => session.friendlyId === activeFriendlyId)
  }, [activeFriendlyId, forcedSessionKey, isNewChat, sessions])
  const activeSessionKey = activeSession?.key ?? ''
  const activeTitle = useMemo(() => {
    if (activeSession) {
      return (
        activeSession.label ||
        activeSession.title ||
        activeSession.derivedTitle ||
        activeSession.friendlyId
      )
    }
    return activeFriendlyId
  }, [activeFriendlyId, activeSession])

  const sessionsError =
    sessionsQuery.error instanceof Error ? sessionsQuery.error.message : null

  return {
    sessionsQuery,
    sessions,
    activeSession,
    activeExists,
    activeSessionKey,
    activeTitle,
    sessionsError,
  }
}

function mergeSessionLists(
  serverSessions: Array<SessionMeta>,
  cachedSessions: Array<SessionMeta>,
): Array<SessionMeta> {
  const mergedByID = new Map<string, SessionMeta>()

  for (const session of cachedSessions) {
    mergedByID.set(sessionIdentity(session), session)
  }

  for (const session of serverSessions) {
    const key = sessionIdentity(session)
    const cached = mergedByID.get(key)
    if (!cached) {
      mergedByID.set(key, session)
      continue
    }
    mergedByID.set(key, mergeSession(session, cached))
  }

  return [...mergedByID.values()].sort(function sortByUpdatedAt(left, right) {
    const leftUpdatedAt =
      typeof left.updatedAt === 'number' && Number.isFinite(left.updatedAt)
        ? left.updatedAt
        : 0
    const rightUpdatedAt =
      typeof right.updatedAt === 'number' && Number.isFinite(right.updatedAt)
        ? right.updatedAt
        : 0
    return rightUpdatedAt - leftUpdatedAt
  })
}

function mergeSession(serverSession: SessionMeta, cachedSession: SessionMeta) {
  const serverUpdatedAt =
    typeof serverSession.updatedAt === 'number' &&
    Number.isFinite(serverSession.updatedAt)
      ? serverSession.updatedAt
      : 0
  const cachedUpdatedAt =
    typeof cachedSession.updatedAt === 'number' &&
    Number.isFinite(cachedSession.updatedAt)
      ? cachedSession.updatedAt
      : 0
  const preferCached = cachedUpdatedAt > serverUpdatedAt

  return {
    ...serverSession,
    updatedAt: preferCached ? cachedUpdatedAt : serverUpdatedAt,
    lastMessage:
      serverSession.lastMessage ??
      (preferCached ? cachedSession.lastMessage : null) ??
      cachedSession.lastMessage,
    label: serverSession.label || cachedSession.label,
    title: serverSession.title || cachedSession.title,
    derivedTitle: serverSession.derivedTitle || cachedSession.derivedTitle,
  } satisfies SessionMeta
}

function sessionIdentity(session: SessionMeta): string {
  return session.key || session.friendlyId
}
