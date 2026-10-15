// @vitest-environment jsdom

import { cleanup, render } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import type { ConversationTurn } from '../types'
import { ChatMessageList } from './chat-message-list'

// Keep the scroll viewport deterministic while exercising the real message rows.
vi.mock('@/components/prompt-kit/chat-container', function () {
  return {
    ChatContainerRoot: function Root({ children }: { children: ReactNode }) {
      return <div data-testid="viewport">{children}</div>
    },
    ChatContainerContent: function Content({
      children,
    }: {
      children: ReactNode
    }) {
      return <div>{children}</div>
    },
    ChatContainerScrollAnchor: function Anchor() {
      return <div />
    },
  }
})

afterEach(cleanup)

it('retains the first message and image DOM through chat creation and history refresh', function () {
  const pending: ConversationTurn = {
    role: 'user',
    clientId: 'command',
    __optimisticId: 'opt-command',
    status: 'sending',
    content: [
      {
        type: 'image',
        source: { type: 'base64', media_type: 'image/png', data: 'preview' },
      },
    ],
  }
  const saved: ConversationTurn = {
    id: 'server-id',
    role: 'user',
    clientId: 'command',
    content: [
      {
        type: 'image',
        source: { type: 'asset', media_type: 'image/png', assetId: 'stored' },
      },
    ],
  }
  const props = {
    loading: false,
    empty: false,
    waitingForResponse: true,
    pinToTop: true,
    pinGroupMinHeight: 500,
    headerHeight: 56,
    modelLabelById: new Map<string, string>(),
  }
  const { getByRole, getByTestId, container, rerender } = render(
    <ChatMessageList {...props} messages={[pending]} sessionKey="new" />,
  )
  const image = getByRole('img')
  const viewport = getByTestId('viewport')
  const row = container.querySelector('[data-message-item]')
  rerender(
    <ChatMessageList {...props} messages={[saved]} sessionKey="session" />,
  )
  expect(getByRole('img')).toBe(image)
  expect(getByTestId('viewport')).toBe(viewport)
  expect(container.querySelector('[data-message-item]')).toBe(row)
  expect(row?.getAttribute('data-message-id')).toBe('server-id')
  expect(image.getAttribute('src')).toBe('data:image/png;base64,preview')
  rerender(
    <ChatMessageList
      {...props}
      messages={[structuredClone(saved)]}
      sessionKey="session"
    />,
  )
  expect(getByRole('img')).toBe(image)
  expect(image.getAttribute('src')).toBe('data:image/png;base64,preview')
})
