// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode, RefObject } from 'react'
import type { SessionMeta } from '../../types'
import { SidebarSessions } from './sidebar-sessions'

const { layout, pin } = vi.hoisted(function fixture() {
  return {
    layout: { height: 1000, callbacks: new Map<Element, () => void>() },
    pin: vi.fn(),
  }
})

vi.mock('../../hooks/use-pin-session', function pinHook() {
  return {
    usePinSession: function usePinSession() {
      return { pinSession: pin }
    },
  }
})
vi.mock('./session-item', function sessionRow() {
  return {
    SessionItem: function SessionItem({ session }: { session: SessionMeta }) {
      return (
        <a data-session-row href={`#${session.friendlyId}`}>
          {session.title}
        </a>
      )
    },
  }
})
vi.mock('@/components/ui/collapsible', function sections() {
  return {
    Collapsible: function Collapsible({ children }: { children: ReactNode }) {
      return <section>{children}</section>
    },
    CollapsibleTrigger: function Trigger({
      children,
    }: {
      children: ReactNode
    }) {
      return <button>{children}</button>
    },
    CollapsiblePanel: function Panel({ children }: { children: ReactNode }) {
      return <div>{children}</div>
    },
  }
})
vi.mock('@/components/ui/scroll-area', function scrollShell() {
  return {
    ScrollAreaRoot: function Root({ children }: { children: ReactNode }) {
      return <div>{children}</div>
    },
    ScrollAreaViewport: function Viewport({
      children,
      ref,
    }: {
      children: ReactNode
      ref: RefObject<HTMLDivElement | null>
    }) {
      return (
        <div
          data-testid="session-viewport"
          ref={function attach(node) {
            if (node) {
              Object.defineProperty(node, 'clientHeight', {
                configurable: true,
                get: function viewportHeight() {
                  return layout.height
                },
              })
              Object.defineProperty(node, 'scrollHeight', {
                configurable: true,
                get: function contentHeight() {
                  return (
                    node.querySelectorAll('[data-session-row]').length * 32 +
                    120
                  )
                },
              })
            }
            ref.current = node
          }}
        >
          {children}
        </div>
      )
    },
    ScrollAreaScrollbar: function Scrollbar() {
      return null
    },
    ScrollAreaThumb: function Thumb() {
      return null
    },
  }
})

beforeEach(function setup() {
  layout.height = 1000
  layout.callbacks.clear()
  vi.stubGlobal(
    'ResizeObserver',
    function ResizeObserver(callback: () => void) {
      return {
        observe: function observe(element: Element) {
          layout.callbacks.set(element, callback)
        },
        disconnect: function disconnect() {},
        unobserve: function unobserve(element: Element) {
          layout.callbacks.delete(element)
        },
      }
    },
  )
})
afterEach(function reset() {
  cleanup()
  vi.unstubAllGlobals()
})

function sessions(): Array<SessionMeta> {
  const now = new Date()
  const today = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
  ).getTime()
  return Array.from({ length: 80 }, function session(_, index) {
    return {
      key: `session-${index}`,
      friendlyId: `chat-${index}`,
      title: `Synthetic chat ${index}`,
      isPinned: index < 6,
      updatedAt: today - (index < 8 ? 1 : index < 40 ? 3 : 60) * 86400000,
    }
  })
}
function mount() {
  return render(
    <SidebarSessions
      sessions={sessions()}
      activeFriendlyId="new"
      onRename={function rename() {}}
      onDelete={function remove() {}}
    />,
  )
}

describe('sidebar session batching', function () {
  it('loads past the first 20 rows when they do not fill the sidebar', async function () {
    mount()
    await waitFor(function filled() {
      expect(screen.getAllByRole('link')).toHaveLength(40)
    })
    expect(screen.getByRole('button', { name: 'Yesterday' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Last 7 Days' })).toBeTruthy()
    expect(screen.getByText('Synthetic chat 39')).toBeTruthy()
  })

  it('loads another batch when scrolling to the bottom', async function () {
    mount()
    await waitFor(function filled() {
      expect(screen.getAllByRole('link')).toHaveLength(40)
    })
    const viewport = screen.getByTestId('session-viewport')
    viewport.scrollTop = viewport.scrollHeight - viewport.clientHeight
    fireEvent.scroll(viewport)
    await waitFor(function nextBatch() {
      expect(screen.getAllByRole('link')).toHaveLength(60)
    })
  })

  it('fills newly available space after resizing', async function () {
    mount()
    await waitFor(function filled() {
      expect(screen.getAllByRole('link')).toHaveLength(40)
    })
    act(function resize() {
      layout.height = 2000
      layout.callbacks.get(screen.getByTestId('session-viewport'))?.()
    })
    await waitFor(function expanded() {
      expect(screen.getAllByRole('link')).toHaveLength(60)
    })
  })

  it('lets users request more rows without any scroll event', async function () {
    mount()
    await waitFor(function filled() {
      expect(screen.getAllByRole('link')).toHaveLength(40)
    })
    fireEvent.click(
      screen.getByRole('button', { name: 'Show more conversations' }),
    )
    await waitFor(function expanded() {
      expect(screen.getAllByRole('link')).toHaveLength(60)
    })
  })
})
