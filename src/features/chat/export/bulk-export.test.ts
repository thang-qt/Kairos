import { describe, expect, it, vi } from 'vitest'
import { strFromU8, unzipSync } from 'fflate'
import { buildBulkExport, selectExportSessions } from './bulk-export'
import type { ExportSelection } from './bulk-export'
import type { ChatBackend } from '@/lib/chat-backend/types'
import type { SessionMeta } from '@/lib/chat-backend/contracts'

const selection: ExportSelection = { scope: 'all', from: '', to: '', limit: 1 }
function session(key: string, date: string, isPinned = false): SessionMeta {
  return { key, friendlyId: key, updatedAt: new Date(date).getTime(), isPinned }
}
const sessions = [
  session('old', '2026-01-01T12:00:00', true),
  session('new', '2026-01-03T00:00:00'),
  session('middle', '2026-01-02T23:59:59'),
]

describe('bulk export', function () {
  it('selects an inclusive local date range', function () {
    expect(
      selectExportSessions(sessions, {
        ...selection,
        scope: 'range',
        from: '2026-01-01',
        to: '2026-01-02',
      }).map(function key(item) {
        return item.key
      }),
    ).toEqual(['middle', 'old'])
  })
  it('selects most recent conversations regardless of pins', function () {
    expect(
      selectExportSessions(sessions, { ...selection, scope: 'recent' }).map(
        function key(item) {
          return item.key
        },
      ),
    ).toEqual(['new'])
  })
  it('loads every page, deduplicates sessions, and fetches uncached history', async function () {
    const backend = {
      listConversationPage: vi
        .fn()
        .mockResolvedValueOnce({ sessions: [sessions[0]], nextCursor: 'next' })
        .mockResolvedValueOnce({ sessions, nextCursor: null }),
      getConversationHistory: vi
        .fn()
        .mockResolvedValue({ messages: [{ role: 'user', content: 'Hello' }] }),
    } as unknown as ChatBackend
    const result = await buildBulkExport(
      backend,
      selection,
      'json',
      new AbortController().signal,
      vi.fn(),
    )
    expect(result.count).toBe(3)
    expect(backend.getConversationHistory).toHaveBeenCalledTimes(3)
    expect(result.content.type).toBe('application/zip')
    const archive = unzipSync(
      new Uint8Array(await result.content.arrayBuffer()),
    )
    const index = JSON.parse(strFromU8(archive['index.json']))
    expect(index.conversations).toHaveLength(3)
    expect(
      JSON.parse(strFromU8(archive[index.conversations[0].file])),
    ).toMatchObject({
      key: 'new',
      messages: [{ role: 'user', content: 'Hello' }],
    })
  })
  it.each(['json', 'markdown', 'text'] as const)(
    'archives separate %s files with safe, unique filenames',
    async function (format) {
      const backend = {
        listConversationPage: vi.fn().mockResolvedValue({
          sessions: sessions.map(function titled(item) {
            return { ...item, title: '../../Same: title' }
          }),
          nextCursor: null,
        }),
        getConversationHistory: vi.fn().mockResolvedValue({
          messages: [
            { role: 'user', content: [{ type: 'text', text: 'Hello 世界' }] },
            { role: 'assistant', content: [{ type: 'text', text: 'Answer' }] },
          ],
        }),
      } as unknown as ChatBackend
      const result = await buildBulkExport(
        backend,
        selection,
        format,
        new AbortController().signal,
        vi.fn(),
      )
      const archive = unzipSync(
        new Uint8Array(await result.content.arrayBuffer()),
      )
      const index = JSON.parse(strFromU8(archive['index.json']))
      const extension =
        format === 'markdown' ? 'md' : format === 'text' ? 'txt' : 'json'
      expect(Object.keys(archive)).toHaveLength(4)
      expect(index.format).toBe(format)
      for (const [position, entry] of index.conversations.entries()) {
        expect(entry.file).toBe(
          `conversations/${String(position + 1).padStart(4, '0')}-same-title.${extension}`,
        )
        const content = strFromU8(archive[entry.file])
        expect(content).toContain('Hello 世界')
        expect(content).toContain('Answer')
        if (format === 'json')
          expect(JSON.parse(content).title).toBe('../../Same: title')
        if (format === 'markdown')
          expect(content).toContain('# ../../Same: title')
      }
    },
  )
  it('cancels when archive compression starts', async function () {
    const controller = new AbortController()
    const backend = {
      listConversationPage: vi
        .fn()
        .mockResolvedValue({ sessions: [sessions[0]], nextCursor: null }),
      getConversationHistory: vi.fn().mockResolvedValue({ messages: [] }),
    } as unknown as ChatBackend
    await expect(
      buildBulkExport(
        backend,
        selection,
        'json',
        controller.signal,
        function progress(message) {
          if (message === 'Compressing ZIP archive…') controller.abort()
        },
      ),
    ).rejects.toThrow()
  })
  it('does not download a partial export after a history failure', async function () {
    const backend = {
      listConversationPage: vi
        .fn()
        .mockResolvedValue({ sessions, nextCursor: null }),
      getConversationHistory: vi
        .fn()
        .mockRejectedValue(new Error('Unavailable')),
    } as unknown as ChatBackend
    await expect(
      buildBulkExport(
        backend,
        selection,
        'json',
        new AbortController().signal,
        vi.fn(),
      ),
    ).rejects.toThrow('Unavailable')
  })
  it('stops before fetching history when cancelled', async function () {
    const controller = new AbortController()
    const backend = {
      listConversationPage: vi.fn(function page() {
        controller.abort()
        return Promise.resolve({ sessions, nextCursor: null })
      }),
      getConversationHistory: vi.fn(),
    } as unknown as ChatBackend
    await expect(
      buildBulkExport(backend, selection, 'json', controller.signal, vi.fn()),
    ).rejects.toThrow()
    expect(backend.getConversationHistory).not.toHaveBeenCalled()
  })
})
