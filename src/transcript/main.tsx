import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import { createRoot } from 'react-dom/client'
import { MessageItem } from '@/features/chat/components/message-item'
import { projectConversationTurns } from '@/features/chat/components/chat-message-list-utils'
import type { ConversationTurn } from '@/features/chat/types'
// Eagerly load the real renderer before announcing readiness (MessageContent uses it lazily).
import '@/components/prompt-kit/markdown'
import '@/styles.css'
import './transcript.css'
import { installInteractions } from './touch'
import {
  followBottom,
  getSnapshot,
  post,
  receive,
  setFollowBottom,
  subscribe,
} from './store'
import type { NativeCommand } from './protocol'

const modelLabels: ReadonlyMap<string, string> = new Map()

const MessageRow = memo(function MessageRow({
  message,
}: {
  message: ConversationTurn
}) {
  const projection = useMemo(
    function tools() {
      return projectConversationTurns([message])
    },
    [message],
  )
  const openActivity = useCallback(
    function openActivity() {
      if (message.id) post({ type: 'activity', id: message.id })
    },
    [message.id],
  )
  return (
    <article className="min-w-0 text-pretty">
      <MessageItem
        message={message}
        modelLabelById={modelLabels}
        toolResultsByCallId={projection.toolResultsByCallId}
        showAssistantActions={false}
        showTimestamp={false}
        onOpenActivity={openActivity}
      />
    </article>
  )
})

const WINDOW_SIZE = 30

function Transcript() {
  const state = useSyncExternalStore(subscribe, getSnapshot)
  // The web renders a sliding window that grows upward as the reader approaches
  // the top; the offline transcript mirrors that so long conversations stay snappy.
  const [visibleCount, setVisibleCount] = useState(WINDOW_SIZE)
  const sessionChanged = useRef(state.sessionId)
  useEffect(
    function resetWindowOnSessionChange() {
      if (sessionChanged.current === state.sessionId) return
      sessionChanged.current = state.sessionId
      setVisibleCount(WINDOW_SIZE)
    },
    [state.sessionId],
  )
  const rendered = useMemo(
    function windowMessages() {
      return state.messages.slice(
        Math.max(0, state.messages.length - visibleCount),
      )
    },
    [state.messages, visibleCount],
  )
  const loadOlder = useCallback(function expandWindow() {
    setVisibleCount(function grow(count) {
      return count + WINDOW_SIZE
    })
  }, [])
  useLayoutEffect(
    function followAndAcknowledge() {
      if (followBottom)
        window.scrollTo(0, document.documentElement.scrollHeight)
      // A second frame gives Chromium an opportunity to paint the committed React tree.
      requestAnimationFrame(function nextFrame() {
        requestAnimationFrame(function acknowledge() {
          if (followBottom)
            window.scrollTo(0, document.documentElement.scrollHeight)
        })
      })
    },
    [state],
  )
  return (
    <main
      className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4"
      style={{
        paddingTop: state.insets.top + 16,
        paddingBottom: state.insets.bottom + 16,
      }}
    >
      {rendered.map(function renderMessage(message) {
        return <MessageRow key={message.id} message={message} />
      })}
      {rendered.length < state.messages.length ? (
        <LoadOlderSentinel onLoadOlder={loadOlder} />
      ) : null}
    </main>
  )
}

/** Expands the window as the reader scrolls within one viewport of the top. */
function LoadOlderSentinel({ onLoadOlder }: { onLoadOlder: () => void }) {
  const ref = useRef<HTMLDivElement | null>(null)
  const loadingRef = useRef(false)
  useEffect(function observeSentinel() {
    const node = ref.current
    if (!node) return
    const observer = new IntersectionObserver(
      function reachTop(entries) {
        if (!entries.some((entry) => entry.isIntersecting)) return
        if (loadingRef.current) return
        loadingRef.current = true
        const previousHeight = document.documentElement.scrollHeight
        const previousTop = window.scrollY
        onLoadOlder()
        requestAnimationFrame(function restorePosition() {
          requestAnimationFrame(function settlePosition() {
            const nextHeight = document.documentElement.scrollHeight
            if (nextHeight > previousHeight)
              window.scrollTo(0, previousTop + (nextHeight - previousHeight))
            loadingRef.current = false
          })
        })
      },
      { rootMargin: '0px 0px 25% 0px' },
    )
    observer.observe(node)
    return function disconnect() {
      observer.disconnect()
    }
  })
  return <div ref={ref} aria-hidden className="h-1" />
}

window.addEventListener('message', function nativeMessage(event) {
  // Android-originated WebMessage events have no source Window and may have an empty origin.
  // Native enforces the exact target origin; the page cannot load frames or remote scripts.
  if (event.source !== null) return
  try {
    receive(JSON.parse(event.data) as NativeCommand)
  } catch {
    console.warn('Invalid Kairos bridge message')
  }
})
let previousBottom = true
let userScrolling = false
let touchStartX = 0
let touchStartY = 0
window.addEventListener(
  'touchstart',
  function startScroll(event) {
    const touch = event.touches[0]
    if (!touch) return
    touchStartX = touch.clientX
    touchStartY = touch.clientY
  },
  { passive: true },
)
window.addEventListener(
  'touchmove',
  function userScroll(event) {
    const touch = event.touches[0]
    if (!touch) return
    const dx = touch.clientX - touchStartX
    const dy = touch.clientY - touchStartY
    if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) {
      userScrolling = true
      setFollowBottom(false)
    }
  },
  { passive: true },
)
window.addEventListener(
  'scroll',
  function reportBottom() {
    const atBottom =
      window.scrollY + window.innerHeight >=
      document.documentElement.scrollHeight - 48
    if (userScrolling || atBottom) setFollowBottom(atBottom)
    if (atBottom !== previousBottom) {
      previousBottom = atBottom
      post({ type: 'atBottom', value: atBottom })
    }
  },
  { passive: true },
)
window.addEventListener(
  'touchend',
  function endScroll() {
    window.setTimeout(function settleScroll() {
      userScrolling = false
    }, 150)
  },
  { passive: true },
)
new ResizeObserver(function keepPinned() {
  if (followBottom && !userScrolling)
    window.scrollTo(0, document.documentElement.scrollHeight)
}).observe(document.getElementById('root')!)
installInteractions()
createRoot(document.getElementById('root')!).render(<Transcript />)
requestAnimationFrame(function firstFrame() {
  requestAnimationFrame(function ready() {
    post({ type: 'ready', firstPaintMs: performance.now() })
  })
})
