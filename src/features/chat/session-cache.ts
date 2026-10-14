import type { InfiniteData } from '@tanstack/react-query'
import type { SessionMeta, SessionPage } from '@/lib/chat-backend/contracts'

export type SessionCache = InfiniteData<SessionPage, string | null>

export function cachedSessions(value: unknown): Array<SessionMeta> {
  const rows = Array.isArray(value)
    ? (value as Array<SessionMeta>)
    : ((value as SessionCache | undefined)?.pages?.flatMap(
        function pageSessions(page) {
          return page.sessions
        },
      ) ?? [])
  const seen = new Set<string>()
  return rows.filter(function unique(session) {
    if (seen.has(session.key)) return false
    seen.add(session.key)
    return true
  })
}

// Preserve page cursors while mutations optimistically edit the loaded summaries.
// The subsequent query invalidation refreshes their canonical server ordering.
export function mapSessionCache(
  value: unknown,
  update: (sessions: Array<SessionMeta>) => Array<SessionMeta>,
): unknown {
  if (Array.isArray(value)) return update(value)
  const current = value as SessionCache | undefined
  const sessions = update(cachedSessions(value))
  if (!current?.pages?.length)
    return {
      pages: [{ sessions, nextCursor: null }],
      pageParams: [null],
    } satisfies SessionCache
  let offset = 0
  return {
    ...current,
    pages: current.pages.map(function mapPage(page, index) {
      const count =
        index === current.pages.length - 1
          ? sessions.length - offset
          : Math.min(page.sessions.length, sessions.length - offset)
      const pageSessions = sessions.slice(offset, offset + count)
      offset += count
      return { ...page, sessions: pageSessions }
    }),
  } satisfies SessionCache
}
