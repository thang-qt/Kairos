// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ConversationImportPanel } from './conversation-import-panel'

const { upload } = vi.hoisted(function mocks() {
  return { upload: vi.fn() }
})

vi.mock('@/lib/chat-backend/http-chat-backend', function backend() {
  return {
    importConversationWithProgress: upload,
    isLocalChatImportHost: function local() {
      return true
    },
  }
})

afterEach(function reset() {
  cleanup()
  vi.resetAllMocks()
})

const counts = {
  conversations: 1,
  messages: 3,
  images: 1,
  imageBytes: 1024,
  skippedImages: 0,
  skippedAttachments: 1,
  skippedMessages: 0,
  alternateNodes: 1,
  duplicates: 0,
  imported: 0,
  failed: false,
}

function mount() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  render(
    <QueryClientProvider client={client}>
      <ConversationImportPanel />
    </QueryClientProvider>,
  )
  fireEvent.change(screen.getByLabelText('ChatGPT export ZIP'), {
    target: { files: [new File(['synthetic'], 'export.zip')] },
  })
}

describe('ConversationImportPanel', function () {
  it('imports directly and reports completion', async function () {
    upload.mockResolvedValueOnce({ ...counts, imported: 1 })
    mount()
    expect(screen.queryByRole('button', { name: 'Preview archive' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Import' }))
    await screen.findByText('Imported 1 conversations.')
    expect(upload).toHaveBeenCalledTimes(1)
    expect(upload.mock.calls[0][0]).toBe('chatgpt')
  })

  it('shows upload percentage and committed conversation progress', async function () {
    let progress: (value: unknown) => void = function ignore() {}
    upload.mockImplementation(
      function pending(_source, _file, _signal, onProgress) {
        progress = onProgress
        return new Promise(function wait() {})
      },
    )
    mount()
    fireEvent.click(screen.getByRole('button', { name: 'Import' }))
    act(function uploading() {
      progress({ stage: 'uploading', loaded: 50, total: 100 })
    })
    expect(screen.getByText('Uploading archive… 50%')).toBeTruthy()
    expect(
      screen
        .getByRole('progressbar', { name: 'Upload progress' })
        .getAttribute('value'),
    ).toBe('50')
    act(function validating() {
      progress({ stage: 'validating' })
    })
    expect(
      screen.getByText('Preparing import… Checking conversations.'),
    ).toBeTruthy()
    act(function importing() {
      progress({ stage: 'importing', imported: 3, total: 10 })
    })
    expect(
      screen.getByText('Importing conversations… 3 of 10 (30%)'),
    ).toBeTruthy()
    expect(
      screen
        .getByRole('progressbar', { name: 'Import progress' })
        .getAttribute('value'),
    ).toBe('30')
  })

  it('cancels active imports and allows retry', async function () {
    upload.mockImplementation(function pending(
      _source,
      _file,
      signal: AbortSignal,
    ) {
      return new Promise(function wait(_resolve, reject) {
        signal.addEventListener('abort', function abort() {
          reject(new DOMException('Cancelled', 'AbortError'))
        })
      })
    })
    mount()
    fireEvent.click(screen.getByRole('button', { name: 'Import' }))
    await act(async function cancel() {
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    })
    await waitFor(function verify() {
      expect(screen.getByText(/Cancelled\./)).toBeTruthy()
    })
    expect(
      screen.getByRole('button', { name: 'Import' }).hasAttribute('disabled'),
    ).toBe(false)
  })
})
