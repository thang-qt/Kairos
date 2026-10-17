// @vitest-environment jsdom

import { Blob as NodeBlob } from 'node:buffer'
import { act, renderHook } from '@testing-library/react'
import { QueryClient } from '@tanstack/react-query'
import { afterEach, expect, it, vi } from 'vitest'
import { useConversationExport } from './use-conversation-export'
import { chatQueryKeys } from '../chat-queries'
import { setChatBackend } from '@/lib/chat-backend'
import type { ChatBackend } from '@/lib/chat-backend'

afterEach(function restore() {
  setChatBackend(null as unknown as ChatBackend)
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

it('exports complete server history instead of partial cached or optimistic turns', async function () {
  const client = new QueryClient()
  client.setQueryData(chatQueryKeys.history('friendly', 'session'), {
    sessionKey: 'session',
    messages: [
      { role: 'user', content: [{ type: 'text', text: 'local optimism' }] },
    ],
  })
  const getConversationHistory = vi.fn().mockResolvedValue({
    sessionKey: 'session',
    messages: [
      { role: 'user', content: [{ type: 'text', text: 'server question' }] },
      {
        role: 'assistant',
        content: [{ type: 'text', text: 'complete server answer' }],
      },
    ],
  })
  setChatBackend({ getConversationHistory } as unknown as ChatBackend)
  const createObjectURL = vi.fn().mockReturnValue('blob:export')
  vi.stubGlobal('Blob', NodeBlob)
  vi.stubGlobal('URL', { createObjectURL, revokeObjectURL: vi.fn() })
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(
    function click() {},
  )
  const hook = renderHook(function useExport() {
    return useConversationExport({
      currentFriendlyId: 'friendly',
      currentSessionKey: 'session',
      sessionTitle: 'Title',
    })
  })
  await act(async function exportJSON() {
    await hook.result.current.exportConversation('json')
  })
  expect(getConversationHistory).toHaveBeenCalledWith({
    friendlyId: 'friendly',
    sessionKey: 'session',
  })
  const blob = createObjectURL.mock.calls[0]?.[0] as NodeBlob
  const exported = JSON.parse(await blob.text())
  expect(
    exported.messages.map((message: { text: string }) => message.text),
  ).toEqual(['server question', 'complete server answer'])
  expect(hook.result.current.exportError).toBeNull()
  hook.unmount()
})

it('reports a history fetch failure and does not download partial history', async function () {
  const getConversationHistory = vi
    .fn()
    .mockRejectedValue(new Error('History unavailable'))
  setChatBackend({ getConversationHistory } as unknown as ChatBackend)
  const createObjectURL = vi.fn()
  vi.stubGlobal('URL', { createObjectURL })
  const hook = renderHook(function useExport() {
    return useConversationExport({
      currentFriendlyId: 'friendly',
      currentSessionKey: 'session',
      sessionTitle: 'Title',
    })
  })
  await act(async function exportJSON() {
    await hook.result.current.exportConversation('json')
  })
  expect(hook.result.current.exportError).toBe('History unavailable')
  expect(createObjectURL).not.toHaveBeenCalled()
  hook.unmount()
})
