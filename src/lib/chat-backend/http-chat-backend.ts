import type {
  ChatBackend,
  ChatCreateConversationInput,
  ChatDeleteConversationInput,
  ConversationEvent,
  ChatHistoryInput,
  ChatRenameConversationInput,
  ChatStatus,
} from './types'
import type {
  HistoryResponse,
  SessionMeta,
  SessionSearchResult,
} from './contracts'
import { parseJSON } from '@/lib/api-client'

export type ConversationImportReport = {
  conversations: number
  messages: number
  images: number
  imageBytes: number
  skippedImages: number
  skippedAttachments: number
  skippedMessages: number
  alternateNodes: number
  duplicates: number
  imported: number
  failed: boolean
}

export function isLocalChatImportHost(hostname: string): boolean {
  return ['localhost', '127.0.0.1', '[::1]', '::1'].includes(hostname)
}

export async function getConversationImportSettings(): Promise<{
  enabled: boolean
}> {
  const response = await fetch('/api/imports', { credentials: 'include' })
  return parseJSON<{ enabled: boolean }>(response)
}

export type ConversationImportProgress =
  | { stage: 'uploading'; loaded: number; total: number }
  | { stage: 'validating' }
  | { stage: 'importing'; imported: number; total: number }

type ImportStreamEvent = {
  stage: 'validating' | 'importing' | 'complete' | 'error'
  imported: number
  total: number
  report?: ConversationImportReport
  error?: string
}

// XMLHttpRequest exposes actual upload progress; the small streamed response
// contains only aggregate import progress, never exported conversation content.
export async function importConversationWithProgress(
  source: string,
  file: File,
  signal: AbortSignal,
  onProgress: (progress: ConversationImportProgress) => void,
): Promise<ConversationImportReport> {
  if (!isLocalChatImportHost(window.location.hostname)) {
    const settings = await getConversationImportSettings()
    if (!settings.enabled)
      throw new Error(
        'Conversation import is available only on localhost. Set ALLOW_REMOTE_IMPORT=true on the server to enable remote imports.',
      )
  }
  if (file.size > 512 * 1024 * 1024)
    throw new Error('Archive exceeds the 512 MiB upload limit.')
  return new Promise(function uploadArchive(resolve, reject) {
    const request = new XMLHttpRequest()
    let consumed = 0
    let buffer = ''
    let report: ConversationImportReport | undefined
    let ended = false

    function finish(error?: Error) {
      if (ended) return
      ended = true
      signal.removeEventListener('abort', abort)
      if (error) reject(error)
      else if (report) resolve(report)
      else
        reject(
          new Error(
            'Import progress stream ended unexpectedly. Retry to resume safely.',
          ),
        )
    }

    function abort() {
      request.abort()
      finish(new DOMException('Import cancelled', 'AbortError'))
    }

    function consume() {
      if (request.status !== 200) return
      buffer += request.responseText.slice(consumed)
      consumed = request.responseText.length
      const frames = buffer.split(/\r?\n\r?\n/)
      buffer = frames.pop() ?? ''
      for (const frame of frames) {
        const data = frame
          .split(/\r?\n/)
          .filter(function dataLine(line) {
            return line.startsWith('data:')
          })
          .map(function payload(line) {
            return line.slice(5).trimStart()
          })
          .join('\n')
        if (!data) continue
        const event = JSON.parse(data) as ImportStreamEvent
        if (event.stage === 'error') {
          finish(new Error(event.error || 'Import failed.'))
          return
        }
        if (event.stage === 'complete') report = event.report
        else if (event.stage === 'validating')
          onProgress({ stage: 'validating' })
        else if (event.stage === 'importing')
          onProgress({
            stage: 'importing',
            imported: event.imported,
            total: event.total,
          })
      }
    }

    request.open(
      'POST',
      `/api/imports/${encodeURIComponent(source)}?mode=import`,
    )
    request.setRequestHeader('Content-Type', 'application/zip')
    request.setRequestHeader('Accept', 'text/event-stream')
    request.upload.onprogress = function uploadProgress(event) {
      onProgress({
        stage: 'uploading',
        loaded: Math.min(event.loaded, file.size),
        total: file.size,
      })
    }
    request.upload.onload = function uploaded() {
      onProgress({ stage: 'validating' })
    }
    request.onprogress = function importProgress() {
      try {
        consume()
      } catch {
        finish(
          new Error('Unable to read import progress. Retry to resume safely.'),
        )
        request.abort()
      }
    }
    request.onload = function imported() {
      if (request.status !== 200) {
        let message = 'Import failed. Retry to resume safely.'
        try {
          message =
            (JSON.parse(request.responseText) as { error?: string }).error ||
            message
        } catch {
          /* Use a generic error for non-JSON responses. */
        }
        finish(new Error(message))
        return
      }
      try {
        consume()
        finish()
      } catch {
        finish(
          new Error('Unable to read import progress. Retry to resume safely.'),
        )
      }
    }
    request.onerror = function networkFailure() {
      finish(
        new Error(
          'Import connection failed. Completed conversations are safe to retry.',
        ),
      )
    }
    request.onabort = function cancelled() {
      finish(new DOMException('Import cancelled', 'AbortError'))
    }
    signal.addEventListener('abort', abort, { once: true })
    if (signal.aborted) {
      abort()
      return
    }
    onProgress({ stage: 'uploading', loaded: 0, total: file.size })
    request.send(file)
  })
}

export async function importConversationArchive(
  source: string,
  file: File,
  mode: 'preview' | 'import',
  signal: AbortSignal,
): Promise<ConversationImportReport> {
  if (!isLocalChatImportHost(window.location.hostname)) {
    const settings = await getConversationImportSettings()
    if (!settings.enabled)
      throw new Error(
        'Conversation import is available only on localhost. Set ALLOW_REMOTE_IMPORT=true on the server to enable remote imports.',
      )
  }
  if (file.size > 512 * 1024 * 1024) {
    throw new Error('Archive exceeds the 512 MiB upload limit.')
  }
  const response = await fetch(
    `/api/imports/${encodeURIComponent(source)}?mode=${mode}`,
    {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/zip' },
      body: file,
      signal,
      redirect: 'error',
    },
  )
  return parseJSON<ConversationImportReport>(response)
}

type SessionsPayload = {
  sessions: Array<SessionMeta>
  nextCursor?: string
}

type SessionSearchPayload = {
  sessions: Array<SessionSearchResult>
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
  userTurnId?: string
  assistantTurnId?: string
  clientId?: string
}

export async function consumeSSEChatEvents(
  response: Response,
  onEvent: (event: ConversationEvent) => void,
) {
  if (!response.body) {
    throw new Error('Streaming response unavailable')
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let terminalReceived = false

  function consumeFrame(frame: string) {
    const data = frame
      .split(/\r?\n/)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trimStart())
      .join('\n')
    if (!data) return
    const event = JSON.parse(data) as ConversationEvent
    if (
      event.state === 'final' ||
      event.state === 'error' ||
      event.state === 'aborted'
    ) {
      terminalReceived = true
    }
    onEvent(event)
    if (event.state === 'error') {
      throw new Error(event.error || 'The model request failed.')
    }
  }

  try {
    while (true) {
      const { value, done } = await reader.read()
      buffer += decoder.decode(value, { stream: !done })
      const frames = buffer.split(/\r?\n\r?\n/)
      buffer = frames.pop() ?? ''
      for (const frame of frames) {
        consumeFrame(frame)
      }
      if (done) {
        if (buffer.trim()) consumeFrame(buffer)
        if (!terminalReceived) {
          throw new Error('Throwaway response stream ended unexpectedly.')
        }
        return
      }
    }
  } finally {
    if (!terminalReceived) {
      await reader.cancel().catch(function ignoreCancelError() {})
    }
    reader.releaseLock()
  }
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
    async listConversationPage(cursor, signal) {
      const query = new URLSearchParams({ limit: '50' })
      if (cursor) query.set('cursor', cursor)
      const response = await fetch(`/api/sessions?${query}`, {
        credentials: 'include',
        signal,
      })
      const payload = await parseJSON<SessionsPayload>(response)
      return {
        sessions: payload.sessions,
        nextCursor: payload.nextCursor ?? null,
      }
    },
    async listRecentConversationPage(cursor, signal) {
      const query = new URLSearchParams({ limit: '50', order: 'recent' })
      if (cursor) query.set('cursor', cursor)
      const response = await fetch(`/api/sessions?${query}`, {
        credentials: 'include',
        signal,
      })
      const payload = await parseJSON<SessionsPayload>(response)
      return {
        sessions: payload.sessions,
        nextCursor: payload.nextCursor ?? null,
      }
    },
    async getConversation(friendlyId, signal) {
      const response = await fetch(
        `/api/sessions/${encodeURIComponent(friendlyId)}`,
        { credentials: 'include', signal },
      )
      return parseJSON<SessionMeta>(response)
    },
    async searchConversations(query: string, signal?: AbortSignal) {
      const parameters = new URLSearchParams({ q: query })
      const response = await fetch(
        `/api/sessions/search?${parameters.toString()}`,
        {
          credentials: 'include',
          signal,
        },
      )
      const payload = await parseJSON<SessionSearchPayload>(response)
      return payload.sessions
    },
    async getConversationHistory(input: ChatHistoryInput) {
      const response = await fetch(
        `/api/sessions/${encodeURIComponent(input.friendlyId)}/history`,
        {
          credentials: 'include',
          signal: input.signal,
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
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ runId: input.runId }),
        },
      )
      await parseJSON(response)
    },
    async retryRun(input) {
      const response = await fetch(
        `/api/sessions/${encodeURIComponent(input.friendlyId)}/runs/${encodeURIComponent(input.runId)}/retry`,
        {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            idempotencyKey: input.idempotencyKey,
            expectedRevision: input.expectedRevision,
          }),
        },
      )
      return parseJSON(response)
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
            expectedRevision: input.expectedRevision,
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
    async streamEphemeralMessage(input, onEvent) {
      const runtimeContext = getClientRuntimeContext()
      const response = await fetch('/api/ephemeral/messages', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
        signal: input.signal,
        body: JSON.stringify({
          history: input.history,
          message: input.message,
          model: input.model,
          systemPrompt: input.systemPrompt,
          webSearch: input.webSearch,
          mathTools: input.mathTools,
          advanced: input.advanced,
          clientId: input.clientId,
          clientTime: input.clientTime || runtimeContext.clientTime,
          clientTimeZone: input.clientTimeZone || runtimeContext.clientTimeZone,
          attachments: input.attachments,
        }),
      })
      if (!response.ok) {
        await parseJSON<never>(response)
      }
      const contentType = response.headers.get('Content-Type') ?? ''
      if (!contentType.toLowerCase().startsWith('text/event-stream')) {
        throw new Error('Invalid throwaway response stream.')
      }
      await consumeSSEChatEvents(response, onEvent)
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
            expectedRevision: input.expectedRevision,
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
          }),
        },
      )
      return parseJSON(response)
    },
    async deleteUserMessage(input) {
      const response = await fetch(
        `/api/sessions/${encodeURIComponent(input.sourceFriendlyId)}/messages/${encodeURIComponent(input.messageId)}${input.expectedRevision === undefined ? '' : `?revision=${input.expectedRevision}`}`,
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
