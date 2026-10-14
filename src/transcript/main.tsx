import { memo, useLayoutEffect, useSyncExternalStore } from 'react'
import { createRoot } from 'react-dom/client'
import { Message, MessageContent } from '@/components/prompt-kit/message'
// Eagerly load the real renderer before announcing readiness (MessageContent uses it lazily).
import '@/components/prompt-kit/markdown'
import '@/styles.css'
import './transcript.css'
import { cn } from '@/lib/utils'
import { installInteractions } from './touch'
import {
  followBottom,
  getSnapshot,
  pendingPaints,
  post,
  receive,
  setFollowBottom,
  subscribe,
} from './store'
import type { Message as TranscriptMessage, NativeCommand } from './protocol'

const MessageRow = memo(function MessageRow({
  message,
}: {
  message: TranscriptMessage
}) {
  const isUser = message.role === 'user'
  return (
    <article
      data-message-id={message.id}
      className={cn(
        'flex min-w-0 flex-col gap-2 text-pretty',
        isUser ? 'items-end' : 'items-start',
      )}
    >
      {!isUser && (
        <span className="font-mono text-sm font-medium text-primary-900">
          {message.model ?? 'Kairos'}
        </span>
      )}
      <Message className={cn(isUser && 'flex-row-reverse')}>
        <MessageContent
          markdown={!isUser}
          className={cn(
            'text-primary-950 text-pretty',
            isUser
              ? 'text-primary-900 max-w-[85%] bg-primary-100 px-4 py-2.5 whitespace-pre-wrap'
              : 'w-full',
          )}
        >
          {isUser ? (
            <div className="flex flex-col gap-2">
              {message.attachment && (
                <img
                  src={message.attachment.url}
                  width={message.attachment.width}
                  height={message.attachment.height}
                  alt="Attached screen"
                  className="max-h-72 max-w-full rounded-lg object-contain"
                />
              )}
              {message.text && (
                <p className="whitespace-pre-wrap text-pretty">
                  {message.text}
                </p>
              )}
            </div>
          ) : (
            message.text
          )}
        </MessageContent>
      </Message>
      {message.streaming && (
        <span className="rounded-lg bg-primary-100 px-2 py-1 text-xs text-primary-700">
          Generating…
        </span>
      )}
    </article>
  )
})

function Transcript() {
  const state = useSyncExternalStore(subscribe, getSnapshot)
  useLayoutEffect(
    function followAndAcknowledge() {
      const traces = pendingPaints.splice(0)
      if (followBottom)
        window.scrollTo(0, document.documentElement.scrollHeight)
      // A second frame gives Chromium an opportunity to paint the committed React tree.
      requestAnimationFrame(function nextFrame() {
        requestAnimationFrame(function acknowledge() {
          if (followBottom)
            window.scrollTo(0, document.documentElement.scrollHeight)
          traces.forEach(function acknowledgeTrace(trace) {
            post({
              type: 'paint',
              trace: trace.trace,
              stage: trace.stage,
              elapsedMs: performance.now() - trace.received,
            })
          })
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
      {state.messages.map(function renderMessage(message) {
        return <MessageRow key={message.id} message={message} />
      })}
    </main>
  )
}

window.addEventListener('message', function nativeMessage(event) {
  // Android-originated WebMessage events have no source Window and may have an empty origin.
  // Native enforces the exact target origin; the page cannot load frames or remote scripts.
  if (event.source !== null) return
  try {
    receive(JSON.parse(event.data) as NativeCommand)
  } catch (error) {
    console.warn('Invalid Kairos bridge message', error)
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
