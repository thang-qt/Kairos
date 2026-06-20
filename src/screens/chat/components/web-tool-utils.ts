import type { ToolPart } from '@/components/prompt-kit/tool'
import type { GatewayMessage } from '../types'

export type SearchSourceCard = {
  title: string
  url: string
  content?: string
}

export function searchSourceCardsFromMessage(
  message: GatewayMessage,
): Array<SearchSourceCard> {
  const details = detailsRecord(message.details)
  if (!details) return []

  const cards = new Map<string, SearchSourceCard>()

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
  const usage = detailsRecord(details.usage)
  const serverToolUse = detailsRecord(usage?.server_tool_use)
  const webSearchRequests = serverToolUse?.web_search_requests

  const hasAnnotations = Boolean(annotations && annotations.length > 0)
  const hasCitations = Boolean(citations && citations.length > 0)
  const hasRequestCount =
    typeof webSearchRequests === 'number' && webSearchRequests > 0

  if (!hasAnnotations && !hasCitations && !hasRequestCount) return null

  const output: Record<string, unknown> = {}
  if (hasRequestCount) output.requests = webSearchRequests
  const sourceCards = searchSourceCardsFromMessage(message)
  if (sourceCards.length > 0) output.sources = sourceCards
  if (hasAnnotations && sourceCards.length === 0)
    output.annotations = annotations
  if (hasCitations && sourceCards.length === 0) output.citations = citations

  return {
    type: 'openrouter:web_search',
    state: 'output-available',
    output,
  }
}

export function searchDetailsSignature(message: GatewayMessage): string {
  const toolPart = mapSearchDetailsToToolPart(message)
  return toolPart ? JSON.stringify(toolPart.output ?? {}) : ''
}

function normalizedString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function detailsRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}
