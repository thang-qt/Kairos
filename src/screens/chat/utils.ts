import type {
  GatewayMessage,
  SessionMeta,
  SessionSummary,
  ToolCallContent,
} from './types'

export function deriveFriendlyIdFromKey(key: string | undefined): string {
  if (!key) return 'main'
  const trimmed = key.trim()
  if (trimmed.length === 0) return 'main'
  const parts = trimmed.split(':')
  const tail = parts[parts.length - 1] ?? ''
  const tailTrimmed = tail.trim()
  return tailTrimmed.length > 0 ? tailTrimmed : trimmed
}

export function textFromMessage(msg: GatewayMessage): string {
  const parts = Array.isArray(msg.content) ? msg.content : []
  return parts
    .map((part) => (part.type === 'text' ? String(part.text ?? '') : ''))
    .join('')
    .trim()
}

export function countApproximateTokens(text: string): number {
  const normalized = text.trim()
  if (!normalized) return 0
  return Math.max(1, Math.round(normalized.length / 4))
}

export function countConversationTokens(
  messages: Array<GatewayMessage>,
): number {
  return messages.reduce(function count(total, message) {
    const parts = Array.isArray(message.content) ? message.content : []
    const messageText = parts
      .filter((part) => part.type === 'text')
      .map((part) => ('text' in part ? String(part.text ?? '') : ''))
      .join(' ')

    return total + countApproximateTokens(messageText)
  }, 0)
}

export function getToolCallsFromMessage(
  msg: GatewayMessage,
): Array<ToolCallContent> {
  const parts = Array.isArray(msg.content) ? msg.content : []
  return parts.filter(
    (part): part is ToolCallContent => part.type === 'toolCall',
  )
}

export function getGatewayMessageId(message: GatewayMessage): string | null {
  const id = message.id
  return typeof id === 'string' && id.trim().length > 0 ? id : null
}

export function normalizeMessageTimestamp(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    if (value < 1_000_000_000_000) return value * 1000
    return value
  }
  if (typeof value === 'string') {
    const parsed = Date.parse(value)
    if (!Number.isNaN(parsed)) return parsed
  }
  return null
}

export function getRawMessageTimestamp(message: GatewayMessage): number | null {
  const candidates = [
    message.createdAt,
    message.created_at,
    message.timestamp,
    message.time,
    message.ts,
  ]

  for (const candidate of candidates) {
    const normalized = normalizeMessageTimestamp(candidate)
    if (normalized) return normalized
  }

  return null
}

export function getMessageTimestamp(message: GatewayMessage): number {
  return getRawMessageTimestamp(message) ?? Date.now()
}

export function normalizeSessions(
  rows: Array<SessionSummary> | undefined,
): Array<SessionMeta> {
  if (!Array.isArray(rows)) return []
  return rows.map((session) => {
    const key =
      typeof session.key === 'string' && session.key.trim().length > 0
        ? session.key.trim()
        : deriveFriendlyIdFromKey(session.friendlyId ?? session.key)
    const friendlyIdCandidate =
      typeof session.friendlyId === 'string' &&
      session.friendlyId.trim().length > 0
        ? session.friendlyId.trim()
        : deriveFriendlyIdFromKey(key)

    return {
      key,
      friendlyId: friendlyIdCandidate,
      title: typeof session.title === 'string' ? session.title : undefined,
      derivedTitle:
        typeof session.derivedTitle === 'string'
          ? session.derivedTitle
          : undefined,
      label: typeof session.label === 'string' ? session.label : undefined,
      isPinned:
        typeof session.isPinned === 'boolean' ? session.isPinned : undefined,
      updatedAt:
        typeof session.updatedAt === 'number' ? session.updatedAt : undefined,
      lastMessage: session.lastMessage ?? null,
      totalTokens:
        typeof session.totalTokens === 'number'
          ? session.totalTokens
          : undefined,
      contextTokens:
        typeof session.contextTokens === 'number'
          ? session.contextTokens
          : undefined,
    }
  })
}

export function isSessionNotFound(message: string): boolean {
  if (!message) return false
  const normalized = message.toLowerCase()
  if (normalized.includes('session not found')) return true
  if (normalized.includes('unknown session')) return true
  if (normalized.includes('chat not found')) return true
  if (normalized.includes('not found') && normalized.includes('session')) {
    return true
  }
  return false
}
