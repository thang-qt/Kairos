import { describe, expect, it } from 'vitest'
import { cachedSessions, mapSessionCache } from './session-cache'
import type { SessionCache } from './session-cache'

describe('paged session cache', function () {
  it('deduplicates sessions moved between pages while preserving cursor state during optimistic edits', function () {
    const cache: SessionCache = {
      pages: [
        {
          sessions: [{ key: 'a', friendlyId: 'a', title: 'A' }],
          nextCursor: 'page-two',
        },
        {
          sessions: [
            { key: 'a', friendlyId: 'a', title: 'A' },
            { key: 'b', friendlyId: 'b', title: 'B' },
          ],
          nextCursor: 'page-three',
        },
      ],
      pageParams: [null, 'page-two'],
    }
    expect(cachedSessions(cache)).toHaveLength(2)
    const edited = mapSessionCache(cache, function rename(rows) {
      return rows.map(function row(session) {
        return session.key === 'b' ? { ...session, title: 'Renamed' } : session
      })
    }) as SessionCache
    expect(
      edited.pages.map(function cursor(page) {
        return page.nextCursor
      }),
    ).toEqual(['page-two', 'page-three'])
    expect(
      cachedSessions(edited).find(function b(session) {
        return session.key === 'b'
      })?.title,
    ).toBe('Renamed')
    const removed = mapSessionCache(edited, function remove(rows) {
      return rows.filter(function keep(row) {
        return row.key !== 'a'
      })
    })
    expect(cachedSessions(removed)).toHaveLength(1)
  })
})
