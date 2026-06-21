import type { ToolPart } from '@/components/prompt-kit/tool'
import type { GatewayMessage } from '../types'

export type SearchSourceCard = {
  title: string
  url: string
  content?: string
}

export type WebToolEventCard = {
  id?: string
  name: string
  query?: string
  url?: string
  error?: string
  state: 'running' | 'complete'
}

export function webToolEventCardsFromMessage(
  message: GatewayMessage,
): Array<WebToolEventCard> {
  const events: Array<WebToolEventCard> = []
  const seen = new Set<string>()
  const details = detailsRecord(message.details)

  if (details) {
    for (const event of webToolEventsFromDetails(details)) {
      const args = detailsRecord(event.arguments)
      const result = detailsRecord(event.result)
      const id = normalizedString(event.id) ?? undefined
      if (id) seen.add(id)
      events.push({
        id,
        name: normalizedString(event.name) ?? 'web_tool',
        query:
          normalizedString(args?.query) ??
          normalizedString(result?.query) ??
          undefined,
        url: normalizedString(args?.url) ?? normalizedString(result?.url) ?? undefined,
        error: normalizedString(event.error) ?? undefined,
        state: 'complete',
      })
    }
  }

  const content = Array.isArray(message.content) ? message.content : []
  for (const part of content) {
    if (
      part.type !== 'toolCall' ||
      (part.name !== 'web_search' && part.name !== 'web_fetch')
    ) {
      continue
    }
    if (part.id && seen.has(part.id)) continue
    const args = part.arguments ?? parsePartialJsonObject(part.partialJson)
    events.push({
      id: part.id,
      name: part.name,
      query: normalizedString(args?.query) ?? undefined,
      url: normalizedString(args?.url) ?? undefined,
      state: 'running',
    })
  }

  return events
}

export function searchSourceCardsFromMessage(
  message: GatewayMessage,
): Array<SearchSourceCard> {
  const details = detailsRecord(message.details)
  if (!details) return []

  const cards = new Map<string, SearchSourceCard>()

  for (const event of webToolEventsFromDetails(details)) {
    const name = normalizedString(event.name)
    if (name !== 'web_search') continue
    const result = detailsRecord(event.result)
    const results = Array.isArray(result?.results) ? result.results : []
    for (const item of results) {
      const record = detailsRecord(item)
      const url = normalizedString(record?.url)
      if (!url || cards.has(url)) continue
      cards.set(url, {
        title: normalizedString(record?.title) ?? hostnameFromURL(url) ?? url,
        url,
        content: normalizedString(record?.snippet) ?? undefined,
      })
    }
  }

  const annotations = Array.isArray(details.annotations)
    ? details.annotations
    : []
  for (const annotation of annotations) {
    const annotationRecord = detailsRecord(annotation)
    const citation = detailsRecord(annotationRecord?.urlCitation)
    const url = normalizedString(citation?.url)
    if (!url) continue
    cards.set(url, {
      title: normalizedString(citation?.title) ?? hostnameFromURL(url) ?? url,
      url,
      content: normalizedString(citation?.content) ?? undefined,
    })
  }

  const citations = Array.isArray(details.citations) ? details.citations : []
  for (const citation of citations) {
    if (typeof citation !== 'string') continue
    const url = citation.trim()
    if (!url || cards.has(url)) continue
    cards.set(url, {
      title: hostnameFromURL(url) ?? url,
      url,
    })
  }

  return Array.from(cards.values())
}

export function webToolRequestCount(message: GatewayMessage): number | null {
  const details = detailsRecord(message.details)
  const webToolSearches = webToolEventCardsFromMessage(message).filter(
    function isSearch(event) {
      return event.name === 'web_search'
    },
  ).length
  if (webToolSearches > 0) return webToolSearches

  const usage = detailsRecord(details?.usage)
  const serverToolUse = detailsRecord(usage?.server_tool_use)
  const webSearchRequests = serverToolUse?.web_search_requests
  if (typeof webSearchRequests === 'number' && webSearchRequests > 0) {
    return webSearchRequests
  }
  return null
}

export function hostnameFromURL(value: string): string | null {
  try {
    return new URL(value).hostname.replace(/^www\./, '')
  } catch {
    return null
  }
}

export function mapSearchDetailsToToolPart(
  message: GatewayMessage,
): ToolPart | null {
  const details = detailsRecord(message.details)
  if (!details) return null

  const annotations = Array.isArray(details.annotations)
    ? details.annotations
    : undefined
  const citations = Array.isArray(details.citations)
    ? details.citations
    : undefined
  const webToolEvents = webToolEventsFromDetails(details)
  const usage = detailsRecord(details.usage)
  const serverToolUse = detailsRecord(usage?.server_tool_use)
  const webSearchRequests = serverToolUse?.web_search_requests

  const hasAnnotations = Boolean(annotations && annotations.length > 0)
  const hasCitations = Boolean(citations && citations.length > 0)
  const hasRequestCount =
    typeof webSearchRequests === 'number' && webSearchRequests > 0
  const hasWebToolEvents = webToolEvents.length > 0

  if (!hasAnnotations && !hasCitations && !hasRequestCount && !hasWebToolEvents)
    return null

  const output: Record<string, unknown> = {}
  if (hasRequestCount) output.requests = webSearchRequests
  if (hasWebToolEvents) output.webTools = webToolEvents
  const sourceCards = searchSourceCardsFromMessage(message)
  if (sourceCards.length > 0) output.sources = sourceCards
  if (hasAnnotations && sourceCards.length === 0)
    output.annotations = annotations
  if (hasCitations && sourceCards.length === 0) output.citations = citations

  return {
    type: 'web_tools',
    state: 'output-available',
    output,
  }
}

export function searchDetailsSignature(message: GatewayMessage): string {
  const toolPart = mapSearchDetailsToToolPart(message)
  return toolPart ? JSON.stringify(toolPart.output ?? {}) : ''
}

function parsePartialJsonObject(
  value: string | undefined,
): Record<string, unknown> | undefined {
  if (!value) return undefined
  try {
    const parsed = JSON.parse(value)
    return detailsRecord(parsed) ?? undefined
  } catch {
    return undefined
  }
}

function normalizedString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function webToolEventsFromDetails(
  details: Record<string, unknown>,
): Array<Record<string, unknown>> {
  const events = Array.isArray(details.webTools) ? details.webTools : []
  return events
    .map((event) => detailsRecord(event))
    .filter((event): event is Record<string, unknown> => Boolean(event))
}

function detailsRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}
