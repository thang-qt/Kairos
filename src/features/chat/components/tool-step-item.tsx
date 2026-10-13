import { useState } from 'react'
import {
  AlertCircleIcon,
  Calculator01Icon,
  Globe02Icon,
  PlugSocketIcon,
  Search01Icon,
  ToolsIcon,
} from '@hugeicons/core-free-icons'
import type { ToolPart } from '@/components/prompt-kit/tool'
import { TextShimmer } from '@/components/prompt-kit/text-shimmer'
import type { ConversationTurn, ToolCallContent } from '../types'
import { mapToolCallToToolPart } from './message-item-utils'
import { toolResultLookupKey } from './chat-message-list-utils'
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
  type SearchSourceCard,
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
      message: ConversationTurn
      toolCallIds?: string[]
    }

const VISIBLE_SOURCE_CHIPS = 3

export function ToolStepItem({ step }: { step: ToolStep }) {
  const running = isToolStepRunning(step)
  const title = toolStepTitle(step)
  const meta = stepMeta(step)
  return (
    <div className="min-w-0 space-y-1.5">
      <div className="text-pretty text-sm leading-6 text-primary-800">
        {running ? (
          <TextShimmer className="line-clamp-2 break-words">
            {title}
          </TextShimmer>
        ) : (
          <span className="line-clamp-2 break-words" title={title}>
            {title}
          </span>
        )}
      </div>
      {meta ? (
        <div className="truncate text-xs tabular-nums text-primary-500">
          {meta}
        </div>
      ) : null}
      {step.kind === 'web' ? (
        <WebSources step={step} />
      ) : (
        <ToolDetails toolPart={step.toolPart} />
      )}
    </div>
  )
}

export function toolStepIcon(step: ToolStep) {
  if (isToolStepFailed(step)) return AlertCircleIcon
  if (step.kind === 'web') {
    const events = webToolEventCardsFromMessage(step.message, step.toolCallIds)
    return events.every((event) => event.name === 'web_fetch') &&
      events.length > 0
      ? Globe02Icon
      : Search01Icon
  }
  if (step.toolPart.type === 'math_eval') return Calculator01Icon
  if (isMcpToolPart(step.toolPart)) return PlugSocketIcon
  return ToolsIcon
}

export function isToolStepRunning(step: ToolStep) {
  if (step.kind === 'web') {
    return webToolEventCardsFromMessage(step.message, step.toolCallIds).some(
      (event) => event.state === 'running',
    )
  }
  return (
    step.toolPart.state !== 'output-available' &&
    step.toolPart.state !== 'output-error'
  )
}

// A web step with no completed result yet would only show a placeholder
// title ("Using the web") and then reflow once the query and sources land.
export function isPendingWebStep(step: ToolStep) {
  if (step.kind !== 'web') return false
  const events = webToolEventCardsFromMessage(step.message, step.toolCallIds)
  return (
    events.length === 0 || events.some((event) => event.state === 'running')
  )
}

function isToolStepFailed(step: ToolStep) {
  if (step.kind === 'web') {
    return webToolEventCardsFromMessage(step.message, step.toolCallIds).some(
      (event) => Boolean(event.error),
    )
  }
  return step.toolPart.state === 'output-error'
}

function WebSources({ step }: { step: Extract<ToolStep, { kind: 'web' }> }) {
  const [expanded, setExpanded] = useState(false)
  const sources = searchSourceCardsFromMessage(step.message, step.toolCallIds)
  if (sources.length === 0) return null
  if (expanded) {
    return (
      <div className="space-y-1.5">
        {sources.map((source) => (
          <SourceCard key={source.url} source={source} />
        ))}
        <button
          type="button"
          onClick={() => setExpanded(false)}
          className="text-xs text-primary-500 transition-colors hover:text-primary-800"
        >
          Show less
        </button>
      </div>
    )
  }
  const chips = sources.slice(0, VISIBLE_SOURCE_CHIPS)
  const hidden = sources.length - chips.length
  return (
    <TooltipProvider>
      <div className="flex flex-wrap items-center gap-1">
        {chips.map((source) => (
          <SourceChip key={source.url} source={source} />
        ))}
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="rounded-md px-1.5 py-0.5 text-xs tabular-nums text-primary-500 transition-colors hover:bg-primary-200 hover:text-primary-800"
        >
          {hidden > 0 ? `+${hidden} more` : 'Details'}
        </button>
      </div>
    </TooltipProvider>
  )
}

function SourceChip({ source }: { source: SearchSourceCard }) {
  return (
    <TooltipRoot>
      <TooltipTrigger
        render={
          <a
            href={source.url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex max-w-[10rem] items-center truncate rounded-md bg-surface px-1.5 py-0.5 text-xs text-primary-700 shadow-xs/5 ring-1 ring-primary-200 transition-colors hover:text-primary-950 hover:ring-primary-300"
          />
        }
      >
        <span className="truncate">
          {hostnameFromURL(source.url) ?? source.title}
        </span>
      </TooltipTrigger>
      <TooltipContent
        side="left"
        align="start"
        className="max-w-xs overflow-hidden border-primary-200 bg-surface p-3 text-primary-800 shadow-lg"
      >
        <div className="space-y-1.5">
          <div className="text-balance font-medium text-primary-900">
            {source.title}
          </div>
          <div className="break-all font-mono text-[11px] text-primary-500">
            {source.url}
          </div>
          {source.content ? (
            <p className="line-clamp-6 text-pretty text-xs leading-relaxed text-primary-700">
              {truncateSourceContent(source.content)}
            </p>
          ) : null}
        </div>
      </TooltipContent>
    </TooltipRoot>
  )
}

function SourceCard({ source }: { source: SearchSourceCard }) {
  const host = hostnameFromURL(source.url)
  return (
    <a
      href={source.url}
      target="_blank"
      rel="noreferrer"
      className="group block rounded-lg bg-surface p-2.5 shadow-xs/5 ring-1 ring-primary-200 transition-colors hover:ring-primary-300"
    >
      <div className="line-clamp-2 text-pretty text-sm text-primary-900 group-hover:underline">
        {source.title}
      </div>
      {host ? (
        <div className="mt-0.5 truncate text-xs text-primary-500">{host}</div>
      ) : null}
      {source.content ? (
        <p className="mt-1 line-clamp-2 text-pretty text-xs leading-relaxed text-primary-600">
          {source.content}
        </p>
      ) : null}
    </a>
  )
}

function ToolDetails({ toolPart }: { toolPart: ToolPart }) {
  const [open, setOpen] = useState(false)
  if (toolPart.compact || toolPart.type === 'math_eval') return null
  if (toolPart.state === 'output-error') {
    return (
      <div className="text-pretty rounded-lg bg-surface p-2.5 text-xs text-primary-800 ring-1 ring-primary-200">
        {toolPart.errorText || 'Tool failed'}
      </div>
    )
  }
  const value = toolPart.output ?? toolPart.input
  if (!value) return null
  return (
    <div className="space-y-1.5">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        className="-mx-1.5 rounded-md px-1.5 py-0.5 text-xs text-primary-500 transition-colors hover:bg-primary-200 hover:text-primary-800"
      >
        {open ? 'Hide details' : 'Show details'}
      </button>
      {open ? (
        <pre className="max-h-60 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-surface p-2.5 font-mono text-xs leading-relaxed text-primary-800 ring-1 ring-primary-200">
          {typeof value === 'string' ? value : JSON.stringify(value, null, 2)}
        </pre>
      ) : null}
    </div>
  )
}

function truncateSourceContent(content: string) {
  const normalized = content.replace(/\s+/g, ' ').trim()
  return normalized.length > 600 ? `${normalized.slice(0, 600)}…` : normalized
}

export function toolStepTitle(step: ToolStep) {
  if (step.kind === 'web') return webStepTitle(step)

  const input = step.toolPart.input
  const label = typeof input?.label === 'string' ? input.label.trim() : ''
  if (label) {
    return `${friendlyToolAction(step.toolPart)}: ${label}`
  }
  if (step.toolPart.type === 'math_eval') {
    const expr = typeof input?.expr === 'string' ? input.expr.trim() : ''
    return expr ? `Calculating: ${expr}` : 'Calculating'
  }

  return friendlyToolAction(step.toolPart)
}

function friendlyToolAction(toolPart: ToolPart) {
  const completed = toolPart.state === 'output-available'
  if (isMcpToolPart(toolPart)) {
    const name = toolPart.displayName ?? 'remote tool'
    return completed ? `Called ${name}` : `Calling ${name}`
  }
  if (toolPart.displayName) return toolPart.displayName
  switch (toolPart.type) {
    case 'terminal':
      return completed ? 'Ran command' : 'Running command'
    case 'read_file':
    case 'read':
      return completed ? 'Read file' : 'Reading file'
    case 'list_files':
    case 'list_directory':
      return completed ? 'Listed files' : 'Listing files'
    case 'write_file':
    case 'write':
      return completed ? 'Wrote file' : 'Writing file'
    default:
      return completed
        ? `Used ${humanizeToolName(toolPart.type)}`
        : `Using ${humanizeToolName(toolPart.type)}`
  }
}

export function isMcpToolPart(toolPart: ToolPart) {
  return toolPart.type.startsWith('mcp_')
}

// Short "key: value" preview of a remote call's arguments.
export function argumentSummary(input: ToolPart['input']) {
  if (!input) return ''
  return Object.entries(input)
    .filter(
      ([, value]) => value !== null && value !== undefined && value !== '',
    )
    .map(function entry([key, value]) {
      const text =
        typeof value === 'string' ? value : JSON.stringify(value) || ''
      return `${key}: ${text.length > 40 ? `${text.slice(0, 40)}…` : text}`
    })
    .join(', ')
}

function humanizeToolName(value: string) {
  return value.replaceAll('_', ' ')
}

function webStepTitle(step: Extract<ToolStep, { kind: 'web' }>) {
  const events = webToolEventCardsFromMessage(step.message, step.toolCallIds)
  if (events.length === 0) return 'Using the web'
  const running = events.some((event) => event.state === 'running')
  const searches = events.filter((event) => event.name === 'web_search')
  const fetches = events.filter((event) => event.name === 'web_fetch')
  if (searches.length > 0 && fetches.length > 0) {
    return `${running ? 'Searching' : 'Searched'} ${searches.length}× and read ${fetches.length} pages`
  }
  if (searches.length > 1) {
    return `${running ? 'Searching' : 'Searched'} ${searches.length} queries`
  }
  if (fetches.length > 1) {
    return `${running ? 'Reading' : 'Read'} ${fetches.length} pages`
  }
  const event = events[0]
  if (event.name === 'web_fetch') {
    const source = searchSourceCardsFromMessage(
      step.message,
      step.toolCallIds,
    )[0]
    const target =
      source?.title || hostnameFromURL(event.url ?? '') || event.url
    const verb = running ? 'Reading' : 'Read'
    return target ? `${verb} ${target}` : verb
  }
  const target = event.query || hostnameFromURL(event.url ?? '') || event.url
  const verb = running ? 'Searching' : 'Searched'
  return target ? `${verb} “${target}”` : verb
}

function stepMeta(step: ToolStep) {
  if (step.kind === 'web') {
    const events = webToolEventCardsFromMessage(step.message, step.toolCallIds)
    const errors = events.filter((event) => event.error)
    if (errors.length > 0) return errors[0].error
    const event = events[0]
    if (events.length === 1 && event?.name === 'web_fetch' && event.url) {
      return hostnameFromURL(event.url) ?? event.url
    }
    return ''
  }
  if (step.toolPart.state === 'output-error') return 'Failed'
  if (isMcpToolPart(step.toolPart)) return argumentSummary(step.toolPart.input)
  if (step.toolPart.state !== 'output-available') return ''
  return stepResult(step.toolPart)
}

function stepResult(toolPart: ToolPart) {
  const result = toolPart.output?.result
  if (typeof result !== 'string') return ''
  const trimmed = result.trim()
  if (!trimmed) return ''
  return trimmed.length > 48 ? `= ${trimmed.slice(0, 48)}…` : `= ${trimmed}`
}

export function toolStepFromPart(
  part: ToolCallContent,
  index: number,
  message: ConversationTurn,
  toolResultsByCallId?: Map<string, ConversationTurn>,
  mcpToolLabels?: ReadonlyMap<string, string>,
): ToolStep {
  const resultMessage = part.id
    ? (toolResultsByCallId?.get(toolResultLookupKey(message, part.id)) ??
      toolResultsByCallId?.get(part.id))
    : undefined
  return (part.name === 'web_search' || part.name === 'web_fetch') &&
    part.status === undefined
    ? {
        kind: 'web',
        key: `web-tool-${part.id || index}`,
        message: resultMessage ?? message,
        toolCallIds: part.id ? [part.id] : undefined,
      }
    : {
        kind: 'tool',
        key: `tool-${part.id || index}`,
        toolPart: withMcpLabel(
          mapToolCallToToolPart(part, resultMessage, message),
          mcpToolLabels,
        ),
      }
}

function withMcpLabel(
  toolPart: ToolPart,
  mcpToolLabels?: ReadonlyMap<string, string>,
): ToolPart {
  if (toolPart.displayName || !isMcpToolPart(toolPart)) return toolPart
  const displayName = mcpToolLabels?.get(toolPart.type)
  return displayName ? { ...toolPart, displayName } : toolPart
}
