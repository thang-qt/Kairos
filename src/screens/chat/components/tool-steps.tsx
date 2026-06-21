import { HugeiconsIcon } from '@hugeicons/react'
import {
  Brain03Icon,
  Calculator01Icon,
  GlobalSearchIcon,
  ToolsIcon,
} from '@hugeicons/core-free-icons'
import type { ToolPart } from '@/components/prompt-kit/tool'
import { MessageContent } from '@/components/prompt-kit/message'
import {
  ChainOfThought,
  ChainOfThoughtContent,
  ChainOfThoughtItem,
  ChainOfThoughtStep,
  ChainOfThoughtTrigger,
} from '@/components/prompt-kit/chain-of-thought'
import type { GatewayMessage, RoundSummary } from '../types'
import {
  TooltipContent,
  TooltipProvider,
  TooltipRoot,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import {
  hostnameFromURL,
  searchSourceCardsFromMessage,
  webToolEventCardsFromMessage,
} from './web-tool-utils'

export type ToolStep =
  | {
      kind: 'tool'
      key: string
      toolPart: ToolPart
    }
  | {
      kind: 'web'
      key: string
      message: GatewayMessage
      toolCallIds?: string[]
    }

type ToolStepsProps = {
  steps: Array<ToolStep>
  running?: boolean
  defaultOpen?: boolean
  roundSummaries?: RoundSummary[]
  leadingReasoning?: string
}

type RoundGroup = {
  summary: RoundSummary
  steps: Array<ToolStep>
}

function groupStepsByRound(
  steps: Array<ToolStep>,
  summaries: Array<RoundSummary>,
): Array<RoundGroup> {
  const groups: Array<RoundGroup> = summaries.map((summary) => ({
    summary,
    steps: [],
  }))
  const toolIdToGroupIndex = new Map<string, number>()
  summaries.forEach(function buildMap(summary, groupIndex) {
    for (const id of summary.toolIds ?? []) {
      toolIdToGroupIndex.set(id, groupIndex)
    }
  })
  for (const step of steps) {
    const groupIndex = stepToolCallIds(step)
      .map((callId) => toolIdToGroupIndex.get(callId))
      .find((index) => index !== undefined)
    const group =
      groupIndex !== undefined ? groups[groupIndex] : groups[groups.length - 1]
    if (group) group.steps.push(step)
  }
  return groups
}

type TraceItem =
  | {
      kind: 'reasoning'
      key: string
      title: string
      body: string
    }
  | {
      kind: 'step'
      step: ToolStep
    }

export function ToolSteps({
  steps,
  running = false,
  defaultOpen = false,
  roundSummaries,
  leadingReasoning,
}: ToolStepsProps) {
  const traceItems = buildTraceItems(steps, roundSummaries, leadingReasoning)
  if (traceItems.length === 0) return null
  const traceCount = traceItems.length
  const latest = latestStep(steps)
  const duration = totalDurationMs(steps)
  const triggerText =
    running && latest ? stepTitle(latest) : compactSummary(duration, running)

  return (
    <div className="w-full max-w-[900px] mt-1">
      <ChainOfThought>
        <ChainOfThoughtStep defaultOpen={defaultOpen}>
          <ChainOfThoughtTrigger
            className="px-0 text-primary-500 hover:text-primary-600"
            right={traceCount === 1 ? '1 step' : String(traceCount) + ' steps'}
          >
            {triggerText}
          </ChainOfThoughtTrigger>
          <ChainOfThoughtContent>
            {traceItems.map((item, index) => (
              <ChainOfThoughtItem key={traceItemKey(item, index)}>
                {item.kind === 'reasoning' ? (
                  <ReasoningTraceItem item={item} />
                ) : (
                  <ToolStepItem step={item.step} />
                )}
              </ChainOfThoughtItem>
            ))}
          </ChainOfThoughtContent>
        </ChainOfThoughtStep>
      </ChainOfThought>
    </div>
  )
}

function buildTraceItems(
  steps: Array<ToolStep>,
  roundSummaries: RoundSummary[] | undefined,
  leadingReasoning: string | undefined,
): Array<TraceItem> {
  if (roundSummaries && roundSummaries.length > 0) {
    const groups = groupStepsByRound(steps, roundSummaries)
    return groups.flatMap((group) => {
      const items: Array<TraceItem> = []
      const text = group.summary.text?.trim() ?? ''
      const thinking = group.summary.thinking?.trim() ?? ''
      const body = [text, thinking].filter(Boolean).join('\n\n')
      if (body) {
        items.push({
          kind: 'reasoning',
          key: 'reasoning-round-' + String(group.summary.round),
          title: 'Thinking',
          body,
        })
      }
      items.push(
        ...group.steps.map((step) => ({ kind: 'step' as const, step })),
      )
      return items
    })
  }

  const items: Array<TraceItem> = []
  const reasoning = leadingReasoning?.trim() ?? ''
  if (reasoning) {
    items.push({
      kind: 'reasoning',
      key: 'leading-reasoning',
      title: 'Thinking',
      body: reasoning,
    })
  }
  items.push(...steps.map((step) => ({ kind: 'step' as const, step })))
  return items
}

function traceItemKey(item: TraceItem, index: number) {
  if (item.kind === 'reasoning') return item.key
  return item.step.key || 'step-' + String(index)
}

function ReasoningTraceItem({
  item,
}: {
  item: Extract<TraceItem, { kind: 'reasoning' }>
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex min-w-0 items-start gap-2 text-sm">
        <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary-100 text-primary-600">
          <HugeiconsIcon icon={Brain03Icon} size={13} strokeWidth={1.7} />{' '}
        </span>
        <MessageContent
          markdown
          className="min-w-0 flex-1 bg-transparent p-0 text-sm text-primary-800"
        >
          {item.body}
        </MessageContent>
      </div>
    </div>
  )
}

function ToolStepItem({ step }: { step: ToolStep }) {
  const details = stepDetails(step)
  return (
    <div className="space-y-1.5">
      <div className="flex min-w-0 items-center gap-2 text-sm">
        <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary-100 text-primary-600">
          <HugeiconsIcon icon={stepIcon(step)} size={13} strokeWidth={1.7} />
        </span>
        <span className="min-w-0 flex-1 truncate font-medium text-primary-800">
          {stepTitle(step)}
        </span>
        <StepRightContent step={step} />
      </div>
      {details ? (
        <div className="ml-8 rounded-lg border border-primary-200/70 bg-surface/80 p-3 text-xs text-primary-700 shadow-xs/5">
          {details}
        </div>
      ) : null}
    </div>
  )
}
function StepRightContent({ step }: { step: ToolStep }) {
  if (step.kind === 'web') return <WebResultChips step={step} />
  return (
    <span className="shrink-0 text-xs text-primary-500">
      {stepRightLabel(step)}
    </span>
  )
}

function stepDetails(step: ToolStep) {
  if (step.kind === 'web') return null
  if (step.toolPart.type === 'math_eval') return null
  return <GenericToolStepDetails toolPart={step.toolPart} />
}

function WebResultChips({
  step,
}: {
  step: Extract<ToolStep, { kind: 'web' }>
}) {
  const events = webToolEventCardsFromMessage(step.message, step.toolCallIds)
  const sources = searchSourceCardsFromMessage(step.message, step.toolCallIds)
  const chips = sources.length > 0 ? sources.slice(0, 4) : []
  const event = events[events.length - 1]
  if (chips.length === 0) {
    return (
      <span className="shrink-0 text-xs text-primary-500">
        {stepRightLabel(step)}
      </span>
    )
  }
  return (
    <TooltipProvider>
      <div className="flex min-w-0 shrink-0 items-center gap-1.5">
        {chips.map((source) => (
          <TooltipRoot key={source.url}>
            <TooltipTrigger>
              <a
                href={source.url}
                target="_blank"
                rel="noreferrer"
                className="max-w-[9rem] truncate rounded-full border border-primary-200 bg-surface px-2 py-0.5 text-xs text-primary-700 shadow-xs/5 hover:border-primary-300"
              >
                {hostnameFromURL(source.url) ?? source.title}
              </a>
            </TooltipTrigger>
            <TooltipContent
              side="bottom"
              align="end"
              className="max-w-sm overflow-hidden border-primary-200 bg-surface p-3 text-primary-800 shadow-lg"
            >
              <div className="space-y-1.5">
                <div className="font-medium text-primary-900">
                  {source.title}
                </div>
                <div className="break-all font-mono text-[11px] text-primary-500">
                  {source.url}
                </div>
                {source.content ? (
                  <p className="line-clamp-6 max-h-32 overflow-hidden text-xs leading-relaxed text-primary-700">
                    {truncateSourceContent(source.content)}
                  </p>
                ) : null}
              </div>
            </TooltipContent>
          </TooltipRoot>
        ))}
        {sources.length > chips.length ? (
          <span className="rounded-full bg-primary-100 px-2 py-0.5 text-xs text-primary-500">
            +{sources.length - chips.length}
          </span>
        ) : null}
        {event?.state === 'running' ? (
          <span className="text-xs text-primary-500">running…</span>
        ) : null}
      </div>
    </TooltipProvider>
  )
}

function truncateSourceContent(content: string) {
  const normalized = content.replace(/\s+/g, ' ').trim()
  return normalized.length > 600 ? `${normalized.slice(0, 600)}…` : normalized
}

function GenericToolStepDetails({ toolPart }: { toolPart: ToolPart }) {
  if (toolPart.state === 'output-error') {
    return (
      <div className="text-red-700">{toolPart.errorText || 'Tool failed'}</div>
    )
  }
  const value = toolPart.output ?? toolPart.input
  if (!value) return null
  return <JsonDetails value={value} />
}

function JsonDetails({ value }: { value: unknown }) {
  return (
    <pre className="max-h-52 overflow-auto whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-primary-800">
      {typeof value === 'string' ? value : JSON.stringify(value, null, 2)}
    </pre>
  )
}

function latestStep(steps: Array<ToolStep>) {
  return steps[steps.length - 1]
}

function stepToolCallIds(step: ToolStep): string[] {
  if (step.kind === 'tool') {
    return step.toolPart.toolCallId ? [step.toolPart.toolCallId] : []
  }
  return step.toolCallIds ?? []
}

function totalDurationMs(steps: Array<ToolStep>) {
  return steps.reduce(function sum(total, step) {
    if (step.kind === 'web') {
      return (
        total +
        webToolEventCardsFromMessage(step.message, step.toolCallIds).reduce(
          (eventTotal, event) => eventTotal + (event.durationMs ?? 0),
          0,
        )
      )
    }
    const duration = step.toolPart.output?.durationMs
    return (
      total +
      (typeof duration === 'number' && Number.isFinite(duration) ? duration : 0)
    )
  }, 0)
}

function formatDuration(durationMs: number) {
  if (durationMs < 1000) return `${Math.max(1, Math.round(durationMs))}ms`
  const seconds = durationMs / 1000
  if (seconds < 10) return `${seconds.toFixed(1)}s`
  return `${Math.round(seconds)}s`
}

function stepIcon(step: ToolStep) {
  if (step.kind === 'web') return GlobalSearchIcon
  if (step.toolPart.type === 'math_eval') return Calculator01Icon
  return ToolsIcon
}

function compactSummary(durationMs: number, running: boolean) {
  if (running) return 'Working'
  return durationMs > 0 ? `Worked for ${formatDuration(durationMs)}` : 'Worked'
}

function stepTitle(step: ToolStep) {
  if (step.kind === 'web') {
    return webStepTitle(step, false)
  }

  const input = step.toolPart.input
  if (step.toolPart.type === 'math_eval') {
    const expr = typeof input?.expr === 'string' ? input.expr.trim() : ''
    return expr ? `Calculating: ${expr}` : 'Calculating'
  }

  return step.toolPart.type
}

function webStepTitle(
  step: Extract<ToolStep, { kind: 'web' }>,
  includeRunning: boolean,
) {
  const events = webToolEventCardsFromMessage(step.message, step.toolCallIds)
  if (events.length === 0) return 'Using web'
  const searches = events.filter((event) => event.name === 'web_search')
  const fetches = events.filter((event) => event.name === 'web_fetch')
  const running =
    includeRunning && events.some((event) => event.state === 'running')
  const suffix = running ? '…' : ''
  if (searches.length > 0 && fetches.length > 0) {
    return `Searched ${searches.length} and read ${fetches.length}${suffix}`
  }
  if (searches.length > 1) return `Searched ${searches.length} times${suffix}`
  if (fetches.length > 1) return `Read ${fetches.length} pages${suffix}`
  const event = events[0]
  if (event.name === 'web_fetch') {
    const source = searchSourceCardsFromMessage(
      step.message,
      step.toolCallIds,
    )[0]
    const target =
      source?.title || hostnameFromURL(event.url ?? '') || event.url
    return target ? `Reading${suffix}: ${target}` : `Reading${suffix}`
  }
  const target = event.query || hostnameFromURL(event.url ?? '') || event.url
  return target ? `Searching${suffix}: ${target}` : `Searching${suffix}`
}

function stepRightLabel(step: ToolStep) {
  if (step.kind === 'web') {
    const events = webToolEventCardsFromMessage(step.message, step.toolCallIds)
    const running = events.some((event) => event.state === 'running')
    const errors = events.filter((event) => event.error).length
    if (running) return 'running…'
    if (errors > 0) return `${errors} error${errors === 1 ? '' : 's'}`
    const count = Math.max(1, events.length)
    return `${count} step${count === 1 ? '' : 's'}`
  }

  if (step.toolPart.state === 'output-error') return 'error'
  if (step.toolPart.state === 'output-available') {
    const result = stepResult(step.toolPart)
    return result || 'done'
  }
  return 'running…'
}

function stepResult(toolPart: ToolPart) {
  const result = toolPart.output?.result
  if (typeof result !== 'string') return ''
  const trimmed = result.trim()
  if (!trimmed) return ''
  return trimmed.length > 32 ? `${trimmed.slice(0, 32)}…` : trimmed
}
