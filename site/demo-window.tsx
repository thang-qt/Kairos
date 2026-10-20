import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import type { CSSProperties } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  Add01Icon,
  ArrowDown01Icon,
  ArrowUp02Icon,
  ReloadIcon,
} from '@hugeicons/core-free-icons'
// Load the real renderer with the demo so its first reply doesn't flash.
import '@/components/prompt-kit/markdown'
import { MessageItem } from '@/features/chat/components/message-item'
import { ActivitySidebar } from '@/features/chat/components/activity-sidebar'
import { projectConversationTurns } from '@/features/chat/components/chat-message-list-utils'
import { activityKeyFromMessage } from '@/features/chat/components/message-item-utils'
import type { ConversationTurn } from '@/features/chat/types'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { buildDemoFrames } from './demo-script'

const modelLabels: ReadonlyMap<string, string> = new Map([
  ['demo-model', 'Your model'],
])

function prefersReducedMotion() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

type Playback = {
  startedAt: number
  index: number
}

export function DemoWindow() {
  const [startedAt, setStartedAt] = useState(() => Date.now())
  const frames = useMemo(
    function frames() {
      return buildDemoFrames(startedAt)
    },
    [startedAt],
  )
  const [playback, setPlayback] = useState<Playback>(() => ({
    startedAt,
    index: prefersReducedMotion() ? frames.length - 1 : 0,
  }))
  // A replay changes startedAt; the stale position then reads as the start.
  const index = playback.startedAt === startedAt ? playback.index : 0
  const frame = frames[index]
  const done = index === frames.length - 1

  useEffect(
    function advance() {
      if (done) return
      const timer = window.setTimeout(function next() {
        setPlayback({ startedAt, index: index + 1 })
      }, frame.wait)
      return function cancel() {
        window.clearTimeout(timer)
      }
    },
    [done, frame.wait, index, startedAt],
  )

  const [activityKey, setActivityKey] = useState<string>()
  const replay = useCallback(function replay() {
    setActivityKey(undefined)
    setStartedAt(Date.now())
  }, [])
  const openActivity = useCallback(function openActivity(key: string) {
    setActivityKey(function toggle(current) {
      return current === key ? undefined : key
    })
  }, [])
  const closeActivity = useCallback(function closeActivity() {
    setActivityKey(undefined)
  }, [])

  const scrollRef = useRef<HTMLDivElement>(null)
  useLayoutEffect(
    function followStream() {
      const node = scrollRef.current
      if (!node) return
      if (!done) {
        node.scrollTop = node.scrollHeight
        return
      }
      // Once the live steps collapse into the chip, bring the chip into view.
      const timer = window.setTimeout(function revealChip() {
        const reply = node.querySelector<HTMLElement>('[data-demo-reply]')
        if (reply) {
          node.scrollTo({ top: reply.offsetTop - 16, behavior: 'smooth' })
        }
      }, 400)
      return function cancel() {
        window.clearTimeout(timer)
      }
    },
    [frame, done],
  )

  return (
    <div
      className="relative overflow-hidden rounded-2xl border border-primary-200 bg-surface shadow-2xl shadow-primary-950/10"
      style={{ '--right-sidebar-width': '320px' } as CSSProperties}
    >
      <div className="flex h-12 items-center gap-3 border-b border-primary-200 bg-primary-50 px-4">
        <div className="flex items-center gap-1.5" aria-hidden>
          <span className="size-2.5 rounded-full bg-primary-300" />
          <span className="size-2.5 rounded-full bg-primary-300" />
          <span className="size-2.5 rounded-full bg-primary-300" />
        </div>
        <p className="min-w-0 flex-1 truncate text-sm text-primary-800">
          SQLite or Postgres?
        </p>
        <span className="hidden items-center gap-1 text-sm text-primary-700 sm:inline-flex">
          Your model
          <HugeiconsIcon icon={ArrowDown01Icon} size={20} strokeWidth={1.5} />
        </span>
        <Button
          variant="ghost"
          size="sm"
          onClick={replay}
          className={cn(
            'transition-opacity',
            done ? 'opacity-100' : 'pointer-events-none opacity-0',
          )}
          tabIndex={done ? 0 : -1}
        >
          <HugeiconsIcon icon={ReloadIcon} size={20} strokeWidth={1.5} />
          Replay
        </Button>
      </div>

      <div className="relative h-120 sm:h-136">
        <div
          ref={scrollRef}
          className={cn(
            'relative h-full overflow-y-auto px-4 pt-6 pb-28 transition-[padding] duration-200 sm:px-8',
            activityKey ? 'md:pr-(--right-sidebar-width)' : null,
          )}
        >
          <DemoMessages
            turns={frame.turns}
            activityKey={activityKey}
            onOpenActivity={openActivity}
          />
        </div>
        <DemoComposer
          text={frame.composer}
          activityOpen={Boolean(activityKey)}
        />
        <ActivitySidebar
          isOpen={Boolean(activityKey)}
          messages={frame.turns}
          selectedKey={activityKey}
          onClose={closeActivity}
        />
      </div>
    </div>
  )
}

const DemoMessages = memo(function DemoMessages({
  turns,
  activityKey,
  onOpenActivity,
}: {
  turns: Array<ConversationTurn>
  activityKey?: string
  onOpenActivity: (key: string) => void
}) {
  const { toolResultsByCallId } = useMemo(
    function project() {
      return projectConversationTurns(turns)
    },
    [turns],
  )
  if (turns.length === 0) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-balance text-center font-serif text-2xl text-primary-500">
          What are we thinking about?
        </p>
      </div>
    )
  }
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      {turns.map(function renderTurn(turn) {
        const key = activityKeyFromMessage(turn)
        return (
          <article
            key={turn.id}
            data-demo-reply={turn.role === 'assistant' ? '' : undefined}
            className="min-w-0 text-pretty"
          >
            <MessageItem
              message={turn}
              modelLabelById={modelLabels}
              toolResultsByCallId={toolResultsByCallId}
              showAssistantActions={false}
              showAssistantActivity
              showTimestamp={false}
              activitySelected={Boolean(key) && key === activityKey}
              onOpenActivity={onOpenActivity}
            />
          </article>
        )
      })}
    </div>
  )
})

function DemoComposer({
  text,
  activityOpen,
}: {
  text: string
  activityOpen: boolean
}) {
  return (
    <div
      className={cn(
        'pointer-events-none absolute inset-x-0 bottom-0 bg-linear-to-t from-surface via-surface to-transparent px-4 pt-8 pb-4 transition-[padding] duration-200 sm:px-8',
        activityOpen ? 'md:pr-(--right-sidebar-width)' : null,
      )}
    >
      <div className="mx-auto flex max-w-2xl items-center gap-3 rounded-2xl border border-primary-200 bg-primary-50 py-2 pr-2 pl-3 shadow-sm">
        <HugeiconsIcon
          icon={Add01Icon}
          size={20}
          strokeWidth={1.5}
          className="shrink-0 text-primary-600"
        />
        <p
          className={cn(
            'min-w-0 flex-1 truncate text-sm',
            text ? 'text-primary-950' : 'text-primary-500',
          )}
        >
          {text || 'Type a message…'}
        </p>
        <span
          className={cn(
            'flex size-8 shrink-0 items-center justify-center rounded-full transition-colors',
            text
              ? 'bg-primary-950 text-primary-50'
              : 'bg-primary-200 text-primary-500',
          )}
        >
          <HugeiconsIcon icon={ArrowUp02Icon} size={20} strokeWidth={1.5} />
        </span>
      </div>
    </div>
  )
}
