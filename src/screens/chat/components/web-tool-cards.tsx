import { HugeiconsIcon } from '@hugeicons/react'
import { ArrowDown01Icon, LinkSquare02Icon } from '@hugeicons/core-free-icons'
import type { GatewayMessage } from '../types'
import {
  hostnameFromURL,
  searchSourceCardsFromMessage,
  webToolEventCardsFromMessage,
  webToolRequestCount,
} from './web-tool-utils'
import {
  Collapsible,
  CollapsiblePanel,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { Button } from '@/components/ui/button'

export function WebToolCards({ message }: { message: GatewayMessage }) {
  const sources = searchSourceCardsFromMessage(message)
  const events = webToolEventCardsFromMessage(message)
  const requestCount = webToolRequestCount(message)

  if (sources.length === 0 && events.length === 0 && !requestCount) return null

  const runningEvents = events.filter((event) => event.state === 'running')
  const sourceLabel =
    sources.length > 0
      ? `${sources.length} source${sources.length === 1 ? '' : 's'}`
      : null
  const fetchCount = events.filter((event) => event.name === 'web_fetch').length
  const requestLabel = requestCount
    ? `${requestCount} search${requestCount === 1 ? '' : 'es'}`
    : null
  const fetchLabel = fetchCount
    ? `${fetchCount} fetch${fetchCount === 1 ? '' : 'es'}`
    : null
  const latestEvent = runningEvents.at(-1) ?? events.at(-1)
  const latestInput = latestEvent?.query ?? latestEvent?.url
  const latestLabel =
    latestEvent?.name === 'web_fetch' ? 'web_fetch' : 'web_search'
  const latestStatus =
    latestEvent?.state === 'running'
      ? latestEvent.name === 'web_fetch'
        ? 'fetching…'
        : 'searching…'
      : null

  return (
    <div className="w-full max-w-[900px] mt-1">
      <Collapsible defaultOpen={false}>
        <CollapsibleTrigger
          render={
            <Button
              variant="ghost"
              className="group/web-tools h-auto max-w-full gap-1.5 px-1.5 py-0.5 -mx-2 text-left"
            />
          }
        >
          <span className="shrink-0 text-sm font-medium text-primary-900">
            {latestLabel}
          </span>
          {latestStatus ? (
            <>
              <span className="shrink-0 text-primary-400">·</span>
              <span className="shrink-0 text-xs text-primary-500">
                {latestStatus}
              </span>
            </>
          ) : null}
          {latestInput ? (
            <>
              <span className="shrink-0 text-primary-400">·</span>
              <span className="min-w-0 truncate text-xs text-primary-600">
                {latestInput}
              </span>
            </>
          ) : null}
          {[requestLabel, fetchLabel, sourceLabel].filter(Boolean).length > 0 ? (
            <>
              <span className="shrink-0 text-primary-400">·</span>
              <span className="shrink-0 text-xs text-primary-500">
                {[requestLabel, fetchLabel, sourceLabel]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
            </>
          ) : null}
          <HugeiconsIcon
            icon={ArrowDown01Icon}
            size={14}
            strokeWidth={1.5}
            className="shrink-0 text-primary-900 transition-transform duration-150 group-data-panel-open/web-tools:rotate-180"
          />
        </CollapsibleTrigger>

        <CollapsiblePanel className="mt-1">
          <div className="space-y-2 rounded-xl border border-primary-200/70 bg-primary-100/45 p-2 shadow-xs">
            {events.length > 0 ? (
              <div className="rounded-lg border border-primary-200/70 bg-surface p-3 shadow-xs/5">
                <h4 className="mb-2 text-xs font-medium text-primary-600">
                  Calls
                </h4>
                <div className="space-y-1.5 font-mono text-xs text-primary-800">
                  {events.map((event, index) => (
                    <div
                      key={event.id || `${event.name}-${index}`}
                      className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5"
                    >
                      <span className="text-primary-500">
                        {event.name === 'web_fetch' ? 'fetch' : 'search'}:
                      </span>
                      <span className="min-w-0 break-words text-primary-700">
                        {event.query ?? event.url ?? '(no input)'}
                        {event.error ? (
                          <span className="ml-2 text-red-700">failed</span>
                        ) : event.state === 'running' ? (
                          <span className="ml-2 text-primary-400">running…</span>
                        ) : null}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            {sources.length > 0 ? (
              <div className="rounded-lg border border-primary-200/70 bg-surface p-3 shadow-xs/5">
                <h4 className="mb-2 text-xs font-medium text-primary-600">
                  Sources
                </h4>
                <div className="grid gap-2 sm:grid-cols-2">
                  {sources.map((source) => {
                    const host = hostnameFromURL(source.url)
                    return (
                      <a
                        key={source.url}
                        href={source.url}
                        target="_blank"
                        rel="noreferrer"
                        className="group grid grid-cols-[auto_1fr_auto] gap-2 rounded-lg border border-primary-200/80 bg-surface/90 p-2.5 shadow-xs/5 transition-colors hover:border-primary-300 hover:bg-surface"
                      >
                        <div className="flex size-5 items-center justify-center rounded-full bg-surface text-xs font-medium text-primary-700 shadow-xs/5 ring-1 ring-primary-200/80">
                          {sources.indexOf(source) + 1}
                        </div>
                        <div className="min-w-0">
                          <div className="text-sm font-medium text-primary-900 group-hover:underline">
                            <span className="line-clamp-1">{source.title}</span>
                          </div>
                          {host ? (
                            <div className="mt-0.5 truncate font-mono text-xs text-primary-500">
                              {host}
                            </div>
                          ) : null}
                          {source.content ? (
                            <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-primary-700">
                              {source.content}
                            </p>
                          ) : null}
                        </div>
                        <HugeiconsIcon
                          icon={LinkSquare02Icon}
                          size={15}
                          strokeWidth={1.6}
                          className="mt-0.5 shrink-0 text-primary-500"
                        />
                      </a>
                    )
                  })}
                </div>
              </div>
            ) : events.length === 0 ? (
              <div className="rounded-lg border border-primary-200/70 bg-surface p-3 text-sm text-primary-700 shadow-xs/5">
                Web search is enabled for this response.
              </div>
            ) : null}
          </div>
        </CollapsiblePanel>
      </Collapsible>
    </div>
  )
}
