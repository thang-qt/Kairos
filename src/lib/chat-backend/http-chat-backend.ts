import type {
  ChatBackend,
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
      return payload.sessions
    },
    async getConversationHistory(input: ChatHistoryInput) {
      const response = await fetch(
        `/api/sessions/${encodeURIComponent(input.friendlyId)}/history`,
        {
          credentials: 'include',
        },
      )
      return parseJSON<HistoryResponse>(response)
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
      return parseJSON<SessionMutationPayload>(response)
    },
    async renameConversation(input: ChatRenameConversationInput) {
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
      return parseJSON<SessionMutationPayload>(response)
    },
    async pinConversation(input) {
      const response = await fetch(
        `/api/sessions/${encodeURIComponent(input.friendlyId)}/pin`,
        {
          method: 'PATCH',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            isPinned: input.isPinned,
          }),
        },
      )
      return parseJSON(response)
    },
    async deleteConversation(input: ChatDeleteConversationInput) {
      const response = await fetch(
        `/api/sessions/${encodeURIComponent(input.friendlyId || input.sessionKey)}`,
        {
          method: 'DELETE',
          credentials: 'include',
        },
      )
      await parseJSON(response)
    },
    async stopConversation(input) {
      const response = await fetch(
        `/api/sessions/${encodeURIComponent(input.friendlyId || input.sessionKey)}/stop`,
        {
          method: 'POST',
          credentials: 'include',
        },
      )
      await parseJSON(response)
    },
    async sendMessage(input) {
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
            systemPrompt: input.systemPrompt,
            thinking: input.thinking,
            temperature: input.temperature,
            topP: input.topP,
            maxOutputTokens: input.maxOutputTokens,
            idempotencyKey: input.idempotencyKey,
            attachments: input.attachments,
          }),
        },
      )
      return parseJSON(response)
    },
    async forkConversation(input) {
      const response = await fetch(
        `/api/sessions/${encodeURIComponent(input.sourceFriendlyId)}/fork`,
        {
          method: 'POST',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            messageId: input.forkAtMessageId,
          }),
        },
      )
      return parseJSON<SessionMutationPayload>(response)
    },
    async editUserMessage(input) {
      const response = await fetch(
        `/api/sessions/${encodeURIComponent(input.sourceFriendlyId)}/messages/${encodeURIComponent(input.messageId)}/edit`,
        {
          method: 'POST',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            message: input.message,
            model: input.model,
            systemPrompt: input.systemPrompt,
            thinking: input.thinking,
            temperature: input.temperature,
            topP: input.topP,
            maxOutputTokens: input.maxOutputTokens,
          }),
        },
      )
      return parseJSON(response)
    },
    async deleteUserMessage(input) {
      const response = await fetch(
        `/api/sessions/${encodeURIComponent(input.sourceFriendlyId)}/messages/${encodeURIComponent(input.messageId)}`,
        {
          method: 'DELETE',
          credentials: 'include',
        },
      )
      return parseJSON<SessionMutationPayload>(response)
    },
    subscribeToConversation(subscription) {
      const friendlyId = subscription.friendlyId?.trim()
      if (!friendlyId || typeof window === 'undefined')
        return function noop() {}

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

async function parseJSON<T>(response: Response): Promise<T> {
  const text = await response.text()
  const data = text ? (JSON.parse(text) as { error?: string } & T) : ({} as T)
  if (!response.ok) {
    const errorData = data as { error?: string }
    throw new ApiError({
      message:
        typeof errorData.error === 'string'
          ? errorData.error
          : 'Request failed',
      status: response.status,
    })
  }
  return data
}
