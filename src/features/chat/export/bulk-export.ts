import type { ChatBackend } from '@/lib/chat-backend/types'
import type { SessionMeta, SessionPage } from '@/lib/chat-backend/contracts'
import {
  sanitizeFilename,
  toMarkdown,
  toPlainText,
} from './use-conversation-export'
import type { ConversationExportFormat } from './use-conversation-export'

export type ExportSelection = {
  scope: 'all' | 'range' | 'recent'
  from: string
  to: string
  limit: number
}

export function selectExportSessions(
  sessions: Array<SessionMeta>,
  selection: ExportSelection,
) {
  const start = selection.from
    ? new Date(`${selection.from}T00:00:00`).getTime()
    : -Infinity
  const end = selection.to ? new Date(`${selection.to}T00:00:00`) : null
  end?.setDate(end.getDate() + 1)
  const sorted = sessions
    .filter(function include(session) {
      if (selection.scope !== 'range') return true
      const updated = session.updatedAt
      return (
        updated != null &&
        updated >= start &&
        updated < (end?.getTime() ?? Infinity)
      )
    })
    .sort(function newest(a, b) {
      return (
        (b.updatedAt ?? 0) - (a.updatedAt ?? 0) || a.key.localeCompare(b.key)
      )
    })
  return selection.scope === 'recent'
    ? sorted.slice(0, selection.limit)
    : sorted
}

export async function buildBulkExport(
  backend: ChatBackend,
  selection: ExportSelection,
  format: ConversationExportFormat,
  signal: AbortSignal,
  onProgress: (message: string) => void,
) {
  const sessions = new Map<string, SessionMeta>()
  let cursor: string | null = null
  const cursors = new Set<string>()
  do {
    signal.throwIfAborted()
    onProgress(`Finding conversations… ${sessions.size}`)
    const page: SessionPage = backend.listConversationPage
      ? await backend.listConversationPage(cursor, signal)
      : { sessions: await backend.listConversations(), nextCursor: null }
    for (const session of page.sessions) sessions.set(session.key, session)
    cursor = page.nextCursor
    if (cursor && cursors.has(cursor))
      throw new Error('Unable to finish loading conversations. Please retry.')
    if (cursor) cursors.add(cursor)
  } while (cursor)
  const selected = selectExportSessions([...sessions.values()], selection)
  if (!selected.length)
    throw new Error('No conversations match your selection.')
  const files: Record<string, Uint8Array> = {}
  const conversations: Array<{ key: string; title: string; file: string }> = []
  const exportedAt = new Date().toISOString()
  const extension =
    format === 'markdown' ? 'md' : format === 'text' ? 'txt' : 'json'
  const encoder = new TextEncoder()
  for (const [index, session] of selected.entries()) {
    signal.throwIfAborted()
    onProgress(`Exporting conversations… ${index + 1} of ${selected.length}`)
    const history = await backend.getConversationHistory({
      sessionKey: session.key,
      friendlyId: session.friendlyId,
      signal,
    })
    signal.throwIfAborted()
    const title =
      session.label ||
      session.title ||
      session.derivedTitle ||
      session.friendlyId
    const file = `conversations/${String(index + 1).padStart(4, '0')}-${sanitizeFilename(title)}.${extension}`
    conversations.push({ key: session.key, title, file })
    let content: string
    if (format === 'json')
      content = JSON.stringify(
        {
          version: 1,
          exportedAt,
          ...session,
          title,
          messages: history.messages,
        },
        null,
        2,
      )
    else {
      const messages = history.messages.filter(function chatMessage(message) {
        return message.role === 'user' || message.role === 'assistant'
      })
      content =
        format === 'markdown'
          ? toMarkdown(messages, title)
          : toPlainText(messages, title)
    }
    files[file] = encoder.encode(content)
  }
  files['index.json'] = encoder.encode(
    JSON.stringify({ version: 1, exportedAt, format, conversations }, null, 2),
  )
  signal.throwIfAborted()
  onProgress('Compressing ZIP archive…')
  return {
    count: selected.length,
    content: await createExportArchive(files, signal),
  }
}

export async function createExportArchive(
  files: Record<string, Uint8Array>,
  signal: AbortSignal,
): Promise<Blob> {
  signal.throwIfAborted()
  const { zip } = await import('fflate')
  signal.throwIfAborted()
  return new Promise(function compress(resolve, reject) {
    let terminate = function terminatePending() {}
    function abort() {
      terminate()
      reject(
        signal.reason ?? new DOMException('Export cancelled.', 'AbortError'),
      )
    }
    signal.addEventListener('abort', abort, { once: true })
    try {
      terminate = zip(files, { level: 6 }, function complete(error, data) {
        signal.removeEventListener('abort', abort)
        if (signal.aborted) {
          reject(
            signal.reason ??
              new DOMException('Export cancelled.', 'AbortError'),
          )
        } else if (error) reject(error)
        else
          resolve(new Blob([new Uint8Array(data)], { type: 'application/zip' }))
      })
    } catch (error) {
      signal.removeEventListener('abort', abort)
      reject(error)
    }
  })
}
