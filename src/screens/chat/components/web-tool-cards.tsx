import { HugeiconsIcon } from '@hugeicons/react'
import {
  ArrowDown01Icon,
  LinkSquare02Icon,
  Search01Icon,
} from '@hugeicons/core-free-icons'
import type { GatewayMessage } from '../types'
import {
  hostnameFromURL,
  searchSourceCardsFromMessage,
  webToolRequestCount,
} from './web-tool-utils'
import {
  Collapsible,
  CollapsiblePanel,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'

export function WebToolCards({ message }: { message: GatewayMessage }) {
  const sources = searchSourceCardsFromMessage(message)
  const requestCount = webToolRequestCount(message)

  if (sources.length === 0 && !requestCount) return null

  const sourceLabel =
    sources.length > 0
      ? `${sources.length} source${sources.length === 1 ? '' : 's'}`
      : 'used'
  const requestLabel = requestCount
    ? `${requestCount} search${requestCount === 1 ? '' : 'es'}`
    : null

  return (
    <div className="w-full max-w-[900px] mt-2">
      <Collapsible defaultOpen={false}>
        <CollapsibleTrigger className="group/web-tools -mx-1 inline-flex h-8 max-w-full items-center gap-2 rounded-full border border-primary-200 bg-primary-50/80 px-3 py-1 text-sm text-primary-700 shadow-xs hover:border-primary-300 hover:bg-primary-100 hover:text-primary-900 data-panel-open:rounded-lg">
          <HugeiconsIcon icon={Search01Icon} size={15} strokeWidth={1.6} />
          <span className="font-medium text-primary-900">Web tools</span>
          <span className="text-primary-500">·</span>
          <span className="truncate text-xs text-primary-600">
            {[requestLabel, sourceLabel].filter(Boolean).join(' · ')}
          </span>
          <HugeiconsIcon
            icon={ArrowDown01Icon}
            size={14}
            strokeWidth={1.5}
            className="ml-0.5 text-primary-600 transition-transform duration-150 group-data-panel-open/web-tools:rotate-180"
          />
        </CollapsibleTrigger>

        <CollapsiblePanel className="mt-1" contentClassName="pt-1">
          <div className="rounded-xl border border-primary-200 bg-primary-50/70 p-3 shadow-xs">
            {sources.length > 0 ? (
              <div className="grid gap-2 sm:grid-cols-2">
                {sources.map((source) => {
                  const host = hostnameFromURL(source.url)
                  return (
                    <a
                      key={source.url}
                      href={source.url}
                      target="_blank"
                      rel="noreferrer"
                      className="group rounded-lg border border-primary-200 bg-white/70 p-3 transition-colors hover:border-primary-300 hover:bg-white"
                    >
                      <div className="mb-1 flex items-start justify-between gap-2">
                        <div className="min-w-0 text-sm font-medium text-primary-900 group-hover:underline">
                          <span className="line-clamp-2">{source.title}</span>
                        </div>
                        <HugeiconsIcon
                          icon={LinkSquare02Icon}
                          size={15}
                          strokeWidth={1.6}
                          className="mt-0.5 shrink-0 text-primary-500"
                        />
                      </div>
                      {host ? (
                        <div className="mb-2 truncate font-mono text-xs text-primary-500">
                          {host}
                        </div>
                      ) : null}
                      {source.content ? (
                        <p className="line-clamp-3 text-xs leading-relaxed text-primary-700">
                          {source.content}
                        </p>
                      ) : null}
                    </a>
                  )
                })}
              </div>
            ) : (
              <div className="rounded-lg border border-primary-200 bg-white/70 px-3 py-2 text-sm text-primary-700">
                Search was used for this response.
              </div>
            )}
          </div>
        </CollapsiblePanel>
      </Collapsible>
    </div>
  )
}
