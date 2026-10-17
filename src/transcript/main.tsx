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
import type { NativeCommand, Presentation } from './protocol'

const modelLabels: ReadonlyMap<string, string> = new Map()

const MessageRow = memo(function MessageRow({
  message,
  toolLabels,
  presentation,
}: {
  message: ConversationTurn
  toolLabels: ReadonlyMap<string, string>
  presentation: Presentation
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
        mcpToolLabels={toolLabels}
        toolResultsByCallId={projection.toolResultsByCallId}
        showAssistantActions={false}
        showAssistantModel={presentation.showModel}
        showAssistantActivity={presentation.showActivity}
        showTimestamp={false}
        onOpenActivity={openActivity}
      />
    </article>
  )
})

const WINDOW_SIZE = 30

function Transcript() {
  const state = useSyncExternalStore(subscribe, getSnapshot)
  const toolLabels = useMemo(
    function labels() {
      return new Map(Object.entries(state.toolLabels))
    },
    [state.toolLabels],
  )
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
  const latestUserIndex = rendered.findLastIndex(function isUser(message) {
    return message.role === 'user'
  })
  const latestUser = rendered[latestUserIndex]
  const latestUserId =
    typeof latestUser?.clientId === 'string' && latestUser.clientId
      ? latestUser.clientId
      : latestUser?.id
  const previousUser = useRef(latestUserId)
  const [pinnedUser, setPinnedUser] = useState<string>()
  const latestTurn = useRef<HTMLDivElement>(null)
  useLayoutEffect(
    function pinNewRequest() {
      if (
        state.scrollPolicy === 'bottom' &&
        latestUserId &&
        latestUserId !== previousUser.current
      ) {
        setFollowBottom(false)
        setPinnedUser(latestUserId)
      }
      previousUser.current = latestUserId
    },
    [latestUserId, state.scrollPolicy],
  )
  useLayoutEffect(
    function alignNewRequest() {
      if (!pinnedUser || pinnedUser !== latestUserId || !latestTurn.current)
        return
      const top =
        latestTurn.current.getBoundingClientRect().top +
        window.scrollY -
        state.insets.top -
        16
      window.scrollTo(0, Math.max(0, top))
    },
    [pinnedUser],
  )
  useLayoutEffect(
    function anchorOverlayReply() {
      if (state.scrollPolicy === 'top') window.scrollTo(0, 0)
    },
    [state.scrollPolicy, state.sessionId, state.messages[0]?.id],
  )
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
      {rendered
        .slice(
          0,
          pinnedUser && latestUserIndex >= 0
            ? latestUserIndex
            : rendered.length,
        )
        .map(function renderMessage(message) {
          return (
            <MessageRow
              key={
                typeof message.clientId === 'string' && message.clientId
                  ? message.clientId
                  : message.id
              }
              message={message}
              toolLabels={toolLabels}
              presentation={state.presentation}
            />
          )
        })}
      {pinnedUser && latestUserIndex >= 0 ? (
        <div
          ref={latestTurn}
          className="flex flex-col gap-6"
          style={{
            minHeight: `calc(100dvh - ${state.insets.top + state.insets.bottom + 32}px)`,
          }}
        >
          {rendered.slice(latestUserIndex).map(function renderLatest(message) {
            return (
              <MessageRow
                key={
                  typeof message.clientId === 'string' && message.clientId
                    ? message.clientId
                    : message.id
                }
                message={message}
                toolLabels={toolLabels}
                presentation={state.presentation}
              />
            )
          })}
        </div>
      ) : null}
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
    if (userScrolling) setFollowBottom(atBottom)
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
let previousContentHeight = 0
new ResizeObserver(function keepPinned() {
  if (getSnapshot().scrollPolicy === 'top') {
    const height = Math.ceil(
      document.querySelector('main')?.getBoundingClientRect().height ?? 0,
    )
    if (height > 0 && height !== previousContentHeight) {
      previousContentHeight = height
      post({ type: 'content-size', height })
    }
  }
  if (followBottom && !userScrolling)
    window.scrollTo(0, document.documentElement.scrollHeight)
}).observe(document.getElementById('root')!)
installInteractions()
createRoot(document.getElementById('root')!).render(<Transcript />)
// Readiness means the command listener is installed, not that Chromium has painted.
// Service-backed assistant windows can defer animation frames until native supplies content.
post({ type: 'ready', firstPaintMs: performance.now() })
