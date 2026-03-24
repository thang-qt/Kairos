import {
  getMessageTimestamp,
  normalizeSessions,
  textFromMessage,
} from './utils'
import type { QueryClient } from '@tanstack/react-query'
import type { GatewayMessage, HistoryResponse, SessionMeta } from './types'
import type { ChatStatus } from '@/lib/chat-backend'
import { getChatBackend } from '@/lib/chat-backend'

export const chatQueryKeys = {
  sessions: ['chat', 'sessions'] as const,
  history: function history(friendlyId: string, sessionKey: string) {
    return ['chat', 'history', friendlyId, sessionKey] as const
  },
} as const

export async function fetchSessions(): Promise<Array<SessionMeta>> {
  const backend = getChatBackend()
  const sessions = await backend.listConversations()
  return normalizeSessions(sessions)
}

export async function fetchHistory(payload: {
  sessionKey: string
  friendlyId: string
}): Promise<HistoryResponse> {
  const backend = getChatBackend()
  return backend.getConversationHistory(payload)
}

export async function fetchChatStatus(): Promise<ChatStatus> {
  const backend = getChatBackend()
  return backend.getStatus()
}

export function updateHistoryMessages(
  queryClient: QueryClient,
  friendlyId: string,
  sessionKey: string,
  updater: (messages: Array<GatewayMessage>) => Array<GatewayMessage>,
) {
  const queryKey = chatQueryKeys.history(friendlyId, sessionKey)
  queryClient.setQueryData(queryKey, function update(data: unknown) {
    const current = data as HistoryResponse | undefined
    const messages = Array.isArray(current?.messages) ? current.messages : []
    const nextMessages = updater(messages)
    return {
      sessionKey: current?.sessionKey ?? sessionKey,
      sessionId: current?.sessionId,
      messages: nextMessages,
    }
  })
}

export function appendHistoryMessage(
  queryClient: QueryClient,
  friendlyId: string,
  sessionKey: string,
  message: GatewayMessage,
) {
  updateHistoryMessages(
    queryClient,
    friendlyId,
    sessionKey,
    function append(messages) {
      return [...messages, message]
    },
  )
}

export function updateHistoryMessageByClientId(
  queryClient: QueryClient,
  friendlyId: string,
  sessionKey: string,
  clientId: string,
  updater: (message: GatewayMessage) => GatewayMessage,
) {
  const optimisticId = `opt-${clientId}`
  updateHistoryMessages(
    queryClient,
    friendlyId,
    sessionKey,
    function update(messages) {
      return messages.map((message) => {
        if (
          message.clientId === clientId ||
          message.__optimisticId === clientId ||
          message.__optimisticId === optimisticId
        ) {
          return updater(message)
        }
        return message
      })
    },
  )
}

export function removeHistoryMessageByClientId(
  queryClient: QueryClient,
  friendlyId: string,
  sessionKey: string,
  clientId: string,
  optimisticId?: string,
) {
  updateHistoryMessages(
    queryClient,
    friendlyId,
    sessionKey,
    function remove(messages) {
      return messages.filter((message) => {
        if (message.clientId === clientId) return false
        if (message.__optimisticId === clientId) return false
        if (optimisticId && message.__optimisticId === optimisticId)
          return false
        return true
      })
    },
  )
}

export function clearHistoryMessages(
  queryClient: QueryClient,
  friendlyId: string,
  sessionKey: string,
) {
  const queryKey = chatQueryKeys.history(friendlyId, sessionKey)
  queryClient.setQueryData(queryKey, {
    sessionKey,
    messages: [],
  })
}

export function moveHistoryMessages(
  queryClient: QueryClient,
  fromFriendlyId: string,
  fromSessionKey: string,
  toFriendlyId: string,
  toSessionKey: string,
) {
  const fromKey = chatQueryKeys.history(fromFriendlyId, fromSessionKey)
  const toKey = chatQueryKeys.history(toFriendlyId, toSessionKey)
  const fromData = queryClient.getQueryData<HistoryResponse>(fromKey)
  if (!fromData) return
  const messages = Array.isArray(fromData.messages) ? fromData.messages : []
  queryClient.setQueryData(toKey, {
    sessionKey: toSessionKey,
    sessionId: fromData.sessionId,
    messages,
  })
  queryClient.removeQueries({ queryKey: fromKey, exact: true })
}

export function updateSessionLastMessage(
  queryClient: QueryClient,
  sessionKey: string,
  friendlyId: string,
  message: GatewayMessage,
) {
  const messageUpdatedAt = getMessageTimestamp(message)
  queryClient.setQueryData(
    chatQueryKeys.sessions,
    function update(currentSessions: unknown) {
      const sessions = Array.isArray(currentSessions)
        ? (currentSessions as Array<SessionMeta>)
        : []

      const matchedIndex = sessions.findIndex((session) => {
        return session.key === sessionKey || session.friendlyId === friendlyId
      })
      const nextSessions = sessions.map((session, index) => {
        if (index !== matchedIndex) {
          return session
        }
        return mergeSessionMessage(session, message, messageUpdatedAt)
      })

      if (matchedIndex < 0) {
        nextSessions.unshift(
          mergeSessionMessage(
            {
              key: sessionKey,
              friendlyId,
            },
            message,
            messageUpdatedAt,
          ),
        )
      }

      return sortSessionsByUpdatedAt(nextSessions)
    },
  )
}

function mergeSessionMessage(
  session: SessionMeta,
  message: GatewayMessage,
  messageUpdatedAt: number,
): SessionMeta {
  const derivedTitleCandidate = deriveSessionTitle(message)
  return {
    ...session,
    lastMessage: message,
    updatedAt:
      typeof session.updatedAt === 'number' &&
      Number.isFinite(session.updatedAt) &&
      session.updatedAt > messageUpdatedAt
        ? session.updatedAt
        : messageUpdatedAt,
    derivedTitle:
      session.label || session.title || session.derivedTitle
        ? session.derivedTitle
        : derivedTitleCandidate || session.derivedTitle,
  }
}

function deriveSessionTitle(message: GatewayMessage): string | undefined {
  if (message.role !== 'user') return undefined
  const text = textFromMessage(message).replace(/\s+/g, ' ').trim()
  if (!text) return undefined
  return text.slice(0, 48)
}

function sortSessionsByUpdatedAt(
  sessions: Array<SessionMeta>,
): Array<SessionMeta> {
  return [...sessions].sort((a, b) => {
    const aPinned = a.isPinned === true
    const bPinned = b.isPinned === true
    if (aPinned !== bPinned) {
      return aPinned ? -1 : 1
    }
    const aUpdatedAt =
      typeof a.updatedAt === 'number' && Number.isFinite(a.updatedAt)
        ? a.updatedAt
        : 0
    const bUpdatedAt =
      typeof b.updatedAt === 'number' && Number.isFinite(b.updatedAt)
        ? b.updatedAt
        : 0
    return bUpdatedAt - aUpdatedAt
  })
}

export function removeSessionFromCache(
  queryClient: QueryClient,
  sessionKey: string,
  friendlyId: string,
) {
  queryClient.setQueryData(
    chatQueryKeys.sessions,
    function update(messages: unknown) {
      if (!Array.isArray(messages)) return messages
      return (messages as Array<SessionMeta>).filter((session) => {
        return session.key !== sessionKey && session.friendlyId !== friendlyId
      })
    },
  )

  queryClient.removeQueries({
    queryKey: ['chat', 'history', friendlyId],
    exact: false,
  })
  if (sessionKey && sessionKey !== friendlyId) {
    queryClient.removeQueries({
      queryKey: ['chat', 'history', sessionKey],
      exact: false,
    })
  }
}
