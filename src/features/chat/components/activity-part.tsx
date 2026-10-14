import { useState } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import { ArrowDown01Icon, Brain01Icon } from '@hugeicons/core-free-icons'
import type {
  ConversationTurn,
  MessageContent as MessageContentPart,
} from '../types'
import { LazyMarkdown } from '@/components/prompt-kit/lazy-markdown'
import { TextShimmer } from '@/components/prompt-kit/text-shimmer'
import type { ReasoningCollapseMode } from '@/components/prompt-kit/thinking'
import { useChatSettingsStore } from '@/app/preferences/app-preferences'
import { cn } from '@/lib/utils'
import {
  ToolStepItem,
  isToolStepRunning,
  isPendingWebStep,
  toolStepFromPart,
  toolStepIcon,
  toolStepTitle,
} from './tool-step-item'

type ActivityPartProps = {
  part: MessageContentPart
  index: number
  message: ConversationTurn
  streaming: boolean
  isLast: boolean
  toolResultsByCallId?: Map<string, ConversationTurn>
  mcpToolLabels?: ReadonlyMap<string, string>
}

export function ActivityPart({
  part,
  index,
  message,
  streaming,
  isLast,
  toolResultsByCallId,
  mcpToolLabels,
}: ActivityPartProps) {
  if (part.type === 'thinking') {
    return (
      <TimelineStep icon={Brain01Icon} active={streaming} isLast={isLast}>
        <ThinkingStep
          content={String(part.thinking ?? '')}
          streaming={streaming}
          blockRemoteImages={Boolean(message.details?.importSource)}
        />
      </TimelineStep>
    )
  }

  if (part.type === 'text') {
    return (
      <TimelineStep isLast={isLast}>
        <LazyMarkdown
          blockRemoteImages={Boolean(message.details?.importSource)}
          className="text-pretty text-sm leading-6 text-primary-700 [&_p]:text-primary-700"
        >
          {String(part.text ?? '')}
        </LazyMarkdown>
      </TimelineStep>
    )
  }

  if (part.type !== 'toolCall') return null

  const step = toolStepFromPart(
    part,
    index,
    message,
    toolResultsByCallId,
    mcpToolLabels,
  )
  return (
    <TimelineStep
      icon={toolStepIcon(step)}
      active={isToolStepRunning(step)}
      isLast={isLast}
    >
      <ToolStepItem step={step} />
    </TimelineStep>
  )
}

function TimelineStep({
  icon,
  active = false,
  isLast,
  children,
}: {
  icon?: Parameters<typeof HugeiconsIcon>[0]['icon']
  active?: boolean
  isLast: boolean
  children: React.ReactNode
}) {
  return (
    <li className="relative flex gap-3 pb-5 last:pb-0">
      {isLast ? null : (
        <span
          aria-hidden
          className="absolute bottom-0 left-3 top-7 w-px -translate-x-1/2 bg-primary-200"
        />
      )}
      <span
        aria-hidden
        className={cn(
          'relative flex size-6 shrink-0 items-center justify-center text-primary-500',
          active && 'text-primary-800',
        )}
      >
        {icon ? (
          <HugeiconsIcon
            icon={icon}
            size={20}
            strokeWidth={1.5}
            className={cn(active && 'animate-pulse')}
          />
        ) : (
          <span className="size-1.5 rounded-full bg-primary-300" />
        )}
      </span>
      <div className="min-w-0 flex-1 pt-px">{children}</div>
    </li>
  )
}

function ThinkingStep({
  content,
  streaming,
  blockRemoteImages,
}: {
  content: string
  streaming: boolean
  blockRemoteImages: boolean
}) {
  const reasoningCollapseMode = useChatSettingsStore(
    (state) => state.settings.reasoningCollapseMode,
  )
  // A manual toggle sticks until the streaming state changes, then the
  // collapse preference takes over again.
  const [choice, setChoice] = useState<{
    streaming: boolean
    open: boolean
  } | null>(null)
  const open =
    choice?.streaming === streaming
      ? choice.open
      : defaultThinkingOpen(reasoningCollapseMode, streaming)

  return (
    <div className="min-w-0">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setChoice({ streaming, open: !open })}
        className="group/thinking -mx-1.5 inline-flex items-center gap-1 rounded-md px-1.5 text-sm leading-6 text-primary-800 transition-colors hover:bg-primary-200"
      >
        {streaming ? <TextShimmer>Thinking…</TextShimmer> : 'Thought'}
        <HugeiconsIcon
          icon={ArrowDown01Icon}
          size={14}
          strokeWidth={1.5}
          className={cn(
            'text-primary-500 transition-transform duration-150',
            open && 'rotate-180',
          )}
        />
      </button>
      {open ? (
        <LazyMarkdown
          blockRemoteImages={blockRemoteImages}
          className="mt-1 text-pretty text-sm leading-6 text-primary-600 [&_li]:text-primary-600 [&_p]:text-primary-600 [&_strong]:text-primary-700"
        >
          {content}
        </LazyMarkdown>
      ) : (
        <button
          type="button"
          onClick={() => setChoice({ streaming, open: true })}
          className="mt-0.5 block w-full text-left"
        >
          <p className="line-clamp-2 text-pretty text-sm leading-6 text-primary-500">
            {plainPreview(content)}
          </p>
        </button>
      )}
    </div>
  )
}

function defaultThinkingOpen(mode: ReasoningCollapseMode, streaming: boolean) {
  if (mode === 'collapsed') return false
  if (mode === 'expanded') return true
  return streaming
}

function plainPreview(markdown: string) {
  return markdown
    .replace(/[`*_#>[\]]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

// Activity steps worth showing right now. While a turn streams, web steps
// are held back until their results arrive so they appear once, complete.
export function visibleActivityIndexes(
  message: ConversationTurn,
  activityIndexes: Array<number>,
  streaming: boolean,
  toolResultsByCallId?: Map<string, ConversationTurn>,
): Array<number> {
  if (!streaming) return activityIndexes
  const parts = Array.isArray(message.content) ? message.content : []
  return activityIndexes.filter(function isSettled(index) {
    const part = parts[index]
    if (part.type !== 'toolCall') return true
    return !isPendingWebStep(
      toolStepFromPart(part, index, message, toolResultsByCallId),
    )
  })
}

// One-line summary of the newest activity step, shown on the in-chat chip
// while a turn is still working.
export function latestActivityLabel(
  message: ConversationTurn,
  activityIndexes: Array<number>,
  toolResultsByCallId?: Map<string, ConversationTurn>,
  mcpToolLabels?: ReadonlyMap<string, string>,
): string {
  const parts = Array.isArray(message.content) ? message.content : []
  const index = visibleActivityIndexes(
    message,
    activityIndexes,
    true,
    toolResultsByCallId,
  ).at(-1)
  if (index === undefined) return ''
  const part = parts[index]
  if (part.type === 'thinking') return 'Thinking…'
  if (part.type === 'text') return plainPreview(String(part.text ?? ''))
  if (part.type !== 'toolCall') return ''
  return toolStepTitle(
    toolStepFromPart(part, index, message, toolResultsByCallId, mcpToolLabels),
  )
}
