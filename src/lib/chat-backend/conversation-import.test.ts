// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  importConversationArchive,
  isLocalChatImportHost,
  importConversationWithProgress,
} from './http-chat-backend'

afterEach(function cleanup() {
  vi.unstubAllGlobals()
})

type FakeImportRequest = {
  status: number
  responseText: string
  upload: {
    onprogress: ((event: ProgressEvent) => void) | null
    onload: (() => void) | null
  }
  onprogress: (() => void) | null
  onload: (() => void) | null
  onerror: (() => void) | null
  onabort: (() => void) | null
  open: ReturnType<typeof vi.fn>
  send: ReturnType<typeof vi.fn>
  abort: ReturnType<typeof vi.fn>
  setRequestHeader: ReturnType<typeof vi.fn>
}

function fakeImportRequest(): FakeImportRequest {
  const request: FakeImportRequest = {
    status: 200,
    responseText: '',
    upload: { onprogress: null, onload: null },
    onprogress: null,
    onload: null,
    onerror: null,
    onabort: null,
    open: vi.fn(),
    send: vi.fn(),
    abort: vi.fn(),
    setRequestHeader: vi.fn(),
  }
  vi.stubGlobal('XMLHttpRequest', function Request() {
    return request
  })
  return request
}

describe('live import progress', function () {
  it('reports actual upload bytes and handles split import events', async function () {
    vi.stubGlobal('window', { location: { hostname: 'localhost' } })
    const request = fakeImportRequest()
    const file = new File(['synthetic'], 'export.zip')
    const progress = vi.fn()
    const done = importConversationWithProgress(
      'chatgpt',
      file,
      new AbortController().signal,
      progress,
    )
    expect(request.send).toHaveBeenCalledWith(file)
    expect(request.open).toHaveBeenCalledWith(
      'POST',
      '/api/imports/chatgpt?mode=import',
    )
    request.upload.onprogress?.(
      new ProgressEvent('progress', {
        loaded: 4,
        total: file.size,
        lengthComputable: true,
      }),
    )
    expect(progress).toHaveBeenLastCalledWith({
      stage: 'uploading',
      loaded: 4,
      total: file.size,
    })
    request.upload.onload?.()
    expect(progress).toHaveBeenLastCalledWith({ stage: 'validating' })
    request.responseText = 'data: {"stage":"importing","imported":'
    request.onprogress?.()
    request.responseText += '1,"total":2}\n\n'
    request.onprogress?.()
    expect(progress).toHaveBeenLastCalledWith({
      stage: 'importing',
      imported: 1,
      total: 2,
    })
    request.responseText +=
      'data: {"stage":"complete","report":{"imported":2,"failed":false}}\n\n'
    request.onload?.()
    await expect(done).resolves.toEqual({ imported: 2, failed: false })
  })

  it('aborts the upload when cancelled', async function () {
    vi.stubGlobal('window', { location: { hostname: 'localhost' } })
    const request = fakeImportRequest()
    const controller = new AbortController()
    const done = importConversationWithProgress(
      'chatgpt',
      new File(['synthetic'], 'export.zip'),
      controller.signal,
      vi.fn(),
    )
    controller.abort()
    await expect(done).rejects.toThrow('cancelled')
    expect(request.abort).toHaveBeenCalledOnce()
  })

  it('rejects a truncated progress stream without claiming completion', async function () {
    vi.stubGlobal('window', { location: { hostname: 'localhost' } })
    const request = fakeImportRequest()
    const done = importConversationWithProgress(
      'chatgpt',
      new File(['synthetic'], 'export.zip'),
      new AbortController().signal,
      vi.fn(),
    )
    request.responseText =
      'data: {"stage":"importing","imported":1,"total":2}\n\n'
    request.onload?.()
    await expect(done).rejects.toThrow('ended unexpectedly')
  })

  it('refuses remote uploads before creating a request', async function () {
    vi.stubGlobal('window', {
      location: { hostname: 'remote.example.invalid' },
    })
    const request = fakeImportRequest()
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(new Response(JSON.stringify({ enabled: false }))),
    )
    await expect(
      importConversationWithProgress(
        'chatgpt',
        new File(['synthetic'], 'export.zip'),
        new AbortController().signal,
        vi.fn(),
      ),
    ).rejects.toThrow('localhost')
    expect(request.open).not.toHaveBeenCalled()
  })
})

describe('conversation import transport', function () {
  it('sends the file directly to the selected local adapter with redirects blocked', async function () {
    const report = { conversations: 1, imported: 0 }
    const request = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify(report)))
    vi.stubGlobal('fetch', request)
    vi.stubGlobal('window', { location: { hostname: 'localhost' } })
    const file = new File(['synthetic archive'], 'export.zip')
    const signal = new AbortController().signal
    await expect(
      importConversationArchive('future-format', file, 'preview', signal),
    ).resolves.toEqual(report)
    expect(request).toHaveBeenCalledWith(
      '/api/imports/future-format?mode=preview',
      expect.objectContaining({ body: file, redirect: 'error', signal }),
    )
  })

  it('refuses remote origins before sending data', async function () {
    const request = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ enabled: false })))
    vi.stubGlobal('fetch', request)
    vi.stubGlobal('window', {
      location: { hostname: 'remote.example.invalid' },
    })
    await expect(
      importConversationArchive(
        'chatgpt',
        new File(['synthetic'], 'export.zip'),
        'preview',
        new AbortController().signal,
      ),
    ).rejects.toThrow('localhost')
    expect(request).toHaveBeenCalledOnce()
    expect(request).toHaveBeenCalledWith('/api/imports', expect.anything())
  })

  it('allows remote uploads when enabled by the server', async function () {
    const request = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ enabled: true })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ imported: 1 })))
    vi.stubGlobal('fetch', request)
    vi.stubGlobal('window', {
      location: { hostname: 'remote.example.invalid' },
    })
    const file = new File(['synthetic'], 'export.zip')
    await expect(
      importConversationArchive(
        'chatgpt',
        file,
        'import',
        new AbortController().signal,
      ),
    ).resolves.toEqual({ imported: 1 })
    expect(request).toHaveBeenLastCalledWith(
      '/api/imports/chatgpt?mode=import',
      expect.objectContaining({ body: file }),
    )
  })

  it('rejects oversized files before sending data', async function () {
    const request = vi.fn()
    vi.stubGlobal('fetch', request)
    vi.stubGlobal('window', { location: { hostname: 'localhost' } })
    const file = new File([], 'large.zip')
    Object.defineProperty(file, 'size', { value: 513 * 1024 * 1024 })
    await expect(
      importConversationArchive(
        'chatgpt',
        file,
        'preview',
        new AbortController().signal,
      ),
    ).rejects.toThrow('512 MiB')
    expect(request).not.toHaveBeenCalled()
  })

  it('accepts loopback addresses only', function () {
    expect(isLocalChatImportHost('127.0.0.1')).toBe(true)
    expect(isLocalChatImportHost('[::1]')).toBe(true)
    expect(isLocalChatImportHost('localhost.example.invalid')).toBe(false)
  })
})
