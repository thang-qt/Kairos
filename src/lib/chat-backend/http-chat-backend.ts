import {
  createMockChatBackend,
  hydrateMockConversation,
} from './mock-chat-backend'
import type {
  ChatBackend,
  ChatConversation,
  ChatCreateConversationInput,
  ChatDeleteConversationInput,
  ChatHistoryInput,
  ChatRenameConversationInput,
  ChatStatus,
} from './types'
import type { HistoryResponse, SessionMeta } from '@/screens/chat/types'
import { ApiError } from '@/lib/app-api'

type SessionsPayload = {
  sessions: Array<SessionMeta>
}

type SessionMutationPayload = {
  sessionKey: string
  friendlyId: string
}

const mockBackend = createMockChatBackend()

export function createHTTPChatBackend(): ChatBackend {
  return {
    async getStatus() {
      try {
        const response = await fetch('/api/health', {
          credentials: 'include',
        })
        const payload = await parseJSON<{ ok?: boolean; service?: string }>(
          response,
        )
        return {
          ok: payload.ok === true,
          mode: 'http',
          provider: payload.service || 'Kairos HTTP Backend',
        } satisfies ChatStatus
      } catch (error) {
        return {
          ok: false,
          mode: 'http',
          provider: 'Kairos HTTP Backend',
          detail:
            error instanceof Error ? error.message : 'Backend unavailable',
        } satisfies ChatStatus
      }
    },
    async listConversations() {
      const response = await fetch('/api/sessions', {
        credentials: 'include',
      })
      const payload = await parseJSON<SessionsPayload>(response)
      for (const session of payload.sessions) {
        hydrateMockConversation(session)
      }

      const mockSessions = await mockBackend.listConversations()
      return mergeConversations(payload.sessions, mockSessions)
    },
    async getConversationHistory(input: ChatHistoryInput) {
      try {
        const response = await fetch(
          `/api/sessions/${encodeURIComponent(input.friendlyId)}/history`,
          {
            credentials: 'include',
          },
        )
        const history = await parseJSON<HistoryResponse>(response)
        hydrateMockConversation(
          {
            key: history.sessionKey,
            friendlyId: input.friendlyId,
          },
          history,
        )
        return history
      } catch (error) {
        if (error instanceof ApiError && error.status === 404) {
          return mockBackend.getConversationHistory(input)
        }
        throw error
      }
    },
    async createConversation(input?: ChatCreateConversationInput) {
      const response = await fetch('/api/sessions', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          label: input?.label,
        }),
      })
      const payload = await parseJSON<SessionMutationPayload>(response)
      hydrateMockConversation({
        key: payload.sessionKey,
        friendlyId: payload.friendlyId,
        label: input?.label?.trim(),
        title: input?.label?.trim(),
        derivedTitle: input?.label?.trim(),
      })
      return payload
    },
    async renameConversation(input: ChatRenameConversationInput) {
      try {
        const response = await fetch(
          `/api/sessions/${encodeURIComponent(input.friendlyId || input.sessionKey)}`,
          {
            method: 'PATCH',
            credentials: 'include',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              label: input.label,
            }),
          },
        )
        const payload = await parseJSON<SessionMutationPayload>(response)
        hydrateMockConversation({
          key: payload.sessionKey,
          friendlyId: payload.friendlyId,
          label: input.label.trim(),
          title: input.label.trim(),
          derivedTitle: input.label.trim(),
        })
        return payload
      } catch (error) {
        if (error instanceof ApiError && error.status === 404) {
          return mockBackend.renameConversation(input)
        }
        throw error
      }
    },
    async deleteConversation(input: ChatDeleteConversationInput) {
      try {
        const response = await fetch(
          `/api/sessions/${encodeURIComponent(input.friendlyId || input.sessionKey)}`,
          {
            method: 'DELETE',
            credentials: 'include',
          },
        )
        await parseJSON(response)
        try {
          await mockBackend.deleteConversation(input)
        } catch {
          // Ignore local mirror misses after the server accepted the deletion.
        }
        return
      } catch (error) {
        if (error instanceof ApiError && error.status === 404) {
          await mockBackend.deleteConversation(input)
          return
        }
        throw error
      }
    },
    async sendMessage(input) {
      try {
        const response = await fetch(
          `/api/sessions/${encodeURIComponent(input.friendlyId)}/messages`,
          {
            method: 'POST',
            credentials: 'include',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              message: input.message,
              model: input.model,
              idempotencyKey: input.idempotencyKey,
              attachments: input.attachments,
            }),
          },
        )
        return await parseJSON(response)
      } catch (error) {
        if (error instanceof ApiError && error.status === 404) {
          return mockBackend.sendMessage(input)
        }
        throw error
      }
    },
    forkConversation(input) {
      return mockBackend.forkConversation(input)
    },
    editUserMessage(input) {
      return mockBackend.editUserMessage(input)
    },
    deleteUserMessage(input) {
      return mockBackend.deleteUserMessage(input)
    },
    subscribeToConversation(subscription) {
      const friendlyId = subscription.friendlyId?.trim()
      if (!friendlyId || typeof window === 'undefined') {
        return mockBackend.subscribeToConversation(subscription)
      }

      const eventSource = new EventSource(
        `/api/sessions/${encodeURIComponent(friendlyId)}/events`,
      )

      function handleMessage(event: MessageEvent<string>) {
        if (typeof event.data !== 'string' || event.data.trim().length === 0) {
          return
        }

        try {
          const payload = JSON.parse(event.data)
          subscription.onEvent(payload)
        } catch {
          // Ignore malformed stream payloads.
        }
      }

      function handleError() {
        // Let EventSource manage reconnect attempts for transient network or
        // dev-proxy interruptions. Closing here can permanently drop the
        // stream for later turns in the same conversation.
      }

      eventSource.addEventListener('message', handleMessage as EventListener)
      eventSource.addEventListener('error', handleError)

      return function unsubscribe() {
        eventSource.removeEventListener(
          'message',
          handleMessage as EventListener,
        )
        eventSource.removeEventListener('error', handleError)
        eventSource.close()
      }
    },
  }
}

function mergeConversations(
  httpSessions: Array<ChatConversation>,
  mockSessions: Array<ChatConversation>,
): Array<ChatConversation> {
  const byID = new Map<string, ChatConversation>()

  for (const session of mockSessions) {
    byID.set(conversationID(session), session)
  }

  for (const session of httpSessions) {
    const key = conversationID(session)
    const existing = byID.get(key)
    if (!existing) {
      byID.set(key, session)
      continue
    }

    const existingUpdatedAt = normalizeUpdatedAt(existing.updatedAt)
    const sessionUpdatedAt = normalizeUpdatedAt(session.updatedAt)
    byID.set(key, existingUpdatedAt > sessionUpdatedAt ? existing : session)
  }

  return [...byID.values()].sort((left, right) => {
    return (
      normalizeUpdatedAt(right.updatedAt) - normalizeUpdatedAt(left.updatedAt)
    )
  })
}

function conversationID(session: ChatConversation): string {
  return session.key || session.friendlyId
}

function normalizeUpdatedAt(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

async function parseJSON<T>(response: Response): Promise<T> {
  const text = await response.text()
  const data = text ? (JSON.parse(text) as { error?: string } & T) : ({} as T)
  if (!response.ok) {
    throw new ApiError({
      message:
        typeof (data as { error?: string }).error === 'string'
          ? (data as { error?: string }).error
          : 'Request failed',
      status: response.status,
    })
  }
  return data
}
