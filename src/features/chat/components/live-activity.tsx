import { useLayoutEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import { motion, useIsPresent } from 'motion/react'
import type { ConversationTurn } from '../types'
import { ActivityPart, visibleActivityIndexes } from './activity-part'
import { TypingIndicator } from '@/components/prompt-kit/typing-indicator'

// Shared by the collapsing steps and the chip that replaces them, so the two
// trade height in lockstep.
export const ACTIVITY_COLLAPSE_TRANSITION = {
  duration: 0.3,
  ease: [0.32, 0.72, 0, 1],
} as const

type LiveActivityProps = {
  message: ConversationTurn
  activityIndexes: Array<number>
  toolResultsByCallId?: Map<string, ConversationTurn>
  mcpToolLabels?: ReadonlyMap<string, string>
}

// A working turn's steps, shown in the chat in place of its activity chip
// until the turn completes. Then the chip appears and the steps live in the
// activity panel.
export function LiveActivity({
  message,
  activityIndexes,
  toolResultsByCallId,
  mcpToolLabels,
}: LiveActivityProps) {
  const parts = Array.isArray(message.content) ? message.content : []
  const stepIndexes = visibleActivityIndexes(
    message,
    activityIndexes,
    true,
    toolResultsByCallId,
  )
  // Running web steps are held back until their results land; keep showing
  // that the turn is working meanwhile.
  if (stepIndexes.length === 0) return <TypingIndicator className="py-1" />

  return (
    <ol className="w-full py-2">
      {stepIndexes.map(function renderStep(partIndex, order) {
        const isLast = order === stepIndexes.length - 1
        return (
          <ActivityPart
            key={`${partIndex}-${parts[partIndex].type}`}
            part={parts[partIndex]}
            index={partIndex}
            message={message}
            streaming={isLast}
            isLast={isLast}
            toolResultsByCallId={toolResultsByCallId}
            mcpToolLabels={mcpToolLabels}
          />
        )
      })}
    </ol>
  )
}

// Wraps the live steps inside AnimatePresence so they fold away when the turn
// completes. If the reader has scrolled past where the steps begin, they're
// reading the answer, so the answer is held in place while everything above
// it collapses. Otherwise the collapse flows normally and the answer rises.
export function LiveActivityCollapse({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const isPresent = useIsPresent()

  useLayoutEffect(
    function holdAnswerWhileCollapsing() {
      if (isPresent) return
      const element = ref.current
      const message = element?.closest('[data-message-item]')
      const viewport = element ? scrollParent(element) : null
      if (!element || !message || !viewport) return
      // Our own correction replaces the browser's scroll anchoring, which
      // only some browsers have and which would fight it here.
      const previousAnchor = viewport.style.overflowAnchor
      viewport.style.overflowAnchor = 'none'
      let frame = 0
      const startBottom = message.getBoundingClientRect().bottom
      function hold() {
        if (!message || !viewport) return
        const drift = message.getBoundingClientRect().bottom - startBottom
        if (drift !== 0) viewport.scrollTop += drift
        frame = requestAnimationFrame(hold)
      }
      const reading =
        element.getBoundingClientRect().top <
        viewport.getBoundingClientRect().top
      if (reading) hold()
      return function release() {
        cancelAnimationFrame(frame)
        viewport.style.overflowAnchor = previousAnchor
      }
    },
    [isPresent],
  )

  return (
    <motion.div
      ref={ref}
      className="w-full overflow-hidden"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ height: 0, opacity: 0 }}
      transition={ACTIVITY_COLLAPSE_TRANSITION}
    >
      {children}
    </motion.div>
  )
}

function scrollParent(element: HTMLElement): HTMLElement | null {
  for (let node = element.parentElement; node; node = node.parentElement) {
    const overflow = getComputedStyle(node).overflowY
    if (overflow === 'auto' || overflow === 'scroll') return node
  }
  return null
}
