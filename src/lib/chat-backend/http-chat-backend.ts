import type {
  ChatBackend,
  ChatCreateConversationInput,
  ChatDeleteConversationInput,
  ChatHistoryInput,
  ChatRenameConversationInput,
  ChatStatus,
} from './types'
import type { HistoryResponse, SessionMeta } from './contracts'
import { parseJSON } from '@/lib/api-client'

type SessionsPayload = {
  sessions: Array<SessionMeta>
}

type ClientRuntimeContext = {
  clientTime: string
  clientTimeZone?: string
}

function getClientRuntimeContext(): ClientRuntimeContext {
  const clientTime = new Date().toISOString()
  const clientTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone
  return {
    clientTime,
    clientTimeZone,
  }
}

type SessionMutationPayload = {
  sessionKey: string
  key: string
  friendlyId: string
  title?: string
  derivedTitle?: string
  label?: string
  isPinned?: boolean
  updatedAt?: number
  lastMessage?: HistoryResponse['messages'][number] | null
  totalTokens?: number
  contextTokens?: number
  settings?: SessionMeta['settings']
  runId?: string
  userMessageId?: string
  assistantMessageId?: string
  clientId?: string
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
      const runtimeContext = getClientRuntimeContext()
      const response = await fetch('/api/sessions', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          label: input?.label,
          message: input?.message,
          model: input?.model,
          systemPrompt: input?.systemPrompt,
          webSearch: input?.webSearch,
          mathTools: input?.mathTools,
          advanced: input?.advanced,
          idempotencyKey: input?.idempotencyKey,
          clientId: input?.clientId,
          clientTime: input?.clientTime || runtimeContext.clientTime,
          clientTimeZone:
            input?.clientTimeZone || runtimeContext.clientTimeZone,
          attachments: input?.attachments,
          settings: input?.settings,
        }),
      })
      return parseJSON<SessionMutationPayload>(response)
    },
    async updateConversationSettings(input) {
      const response = await fetch(
        `/api/sessions/${encodeURIComponent(input.friendlyId)}/settings`,
        {
          method: 'PATCH',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ settings: input.settings }),
        },
      )
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
      const runtimeContext = getClientRuntimeContext()
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
            webSearch: input.webSearch,
            mathTools: input.mathTools,
            advanced: input.advanced,
            idempotencyKey: input.idempotencyKey,
            clientId: input.clientId,
            clientTime: input.clientTime || runtimeContext.clientTime,
            clientTimeZone:
              input.clientTimeZone || runtimeContext.clientTimeZone,
            attachments: input.attachments,
          }),
        },
      )
      return parseJSON(response)
    },
    async cloneConversation(input) {
      const response = await fetch(
        `/api/sessions/${encodeURIComponent(input.sourceFriendlyId)}/clone`,
        {
          method: 'POST',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            messageId: input.cloneAtMessageId,
          }),
        },
      )
      return parseJSON<SessionMutationPayload>(response)
    },
    async editUserMessage(input) {
      const runtimeContext = getClientRuntimeContext()
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
            webSearch: input.webSearch,
            mathTools: input.mathTools,
            advanced: input.advanced,
            clientId: input.clientId,
            clientTime: input.clientTime || runtimeContext.clientTime,
            clientTimeZone:
              input.clientTimeZone || runtimeContext.clientTimeZone,
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

      let opened = false
      let closed = false

      function handleOpen() {
        if (closed) return
        if (opened) {
          subscription.onReconnect?.()
          return
        }
        opened = true
      }

      function handleMessage(event: MessageEvent<string>) {
        if (typeof event.data !== 'string' || event.data.trim().length === 0) {
          return
        }

        try {
          const payload = JSON.parse(event.data)
          subscription.onEvent(payload)
          if (payload?.state === 'reconcile') {
            subscription.onReconcile?.(payload)
          }
        } catch {
          // Ignore malformed stream payloads.
        }
      }

      function handleError() {
        // Let EventSource manage reconnect attempts for transient network or
        // dev-proxy interruptions. Closing here can permanently drop the
        // stream for later turns in the same conversation.
      }

      eventSource.addEventListener('open', handleOpen)
      eventSource.addEventListener('message', handleMessage as EventListener)
      eventSource.addEventListener('error', handleError)

      return function unsubscribe() {
        closed = true
        eventSource.removeEventListener('open', handleOpen)
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
