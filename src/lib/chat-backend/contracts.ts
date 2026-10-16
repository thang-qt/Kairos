export type ToolCallContent = {
  type: 'toolCall'
  id?: string
  name?: string
  arguments?: Record<string, unknown>
  partialJson?: string
  status?: string
  emoji?: string
}

export type ToolResultContent = {
  type: 'toolResult'
  toolCallId?: string
  toolName?: string
  content?: Array<{ type?: string; text?: string }>
  details?: Record<string, unknown>
  isError?: boolean
}

export type TextContent = {
  phase?: 'commentary' | 'final_answer'
  phaseSource?: 'provider' | 'derived'
  type: 'text'
  text?: string
  textSignature?: string
}

export type ThinkingContent = {
  type: 'thinking'
  thinking?: string
  thinkingSignature?: string
}

export type ImageContent = {
  type: 'image'
  source:
    | { type: 'base64'; media_type: string; data: string }
    | { type: 'asset'; media_type: string; assetId: string }
}

export type MessageContent =
  | TextContent
  | ToolCallContent
  | ThinkingContent
  | ImageContent

export type ConversationTurn = {
  canRetry?: boolean
  steps?: Array<ConversationTurn>
  status?: string
  revision?: number
  error?: string
  id?: string
  role?: string
  model?: string
  modelName?: string
  modelDescription?: string
  content?: Array<MessageContent>
  toolCallId?: string
  toolName?: string
  details?: Record<string, unknown>
  isError?: boolean
  completedAt?: number
  timestamp?: number
  runId?: string
  roundIndex?: number
  messageIndex?: number
  [key: string]: unknown
  __optimisticId?: string
  __streamRunId?: string | null
}

export type ConversationAdvancedSettings = {
  reasoning: boolean
  reasoningEffort: ReasoningEffort
  sampling: boolean
  temperature: number
  topP: number
  topK: number
  penalties: boolean
  frequencyPenalty: number
  presencePenalty: number
  maxTokens: boolean
  maxTokensValue: number
}

export type ConversationSettings = {
  model: string
  systemPrompt: string
  webSearch: boolean
  mathTools: boolean
  advanced: ConversationAdvancedSettings
}

export type SessionSummary = {
  revision?: number
  key?: string
  label?: string
  title?: string
  derivedTitle?: string
  isPinned?: boolean
  updatedAt?: number
  lastMessage?: ConversationTurn | null
  friendlyId?: string
  totalTokens?: number
  contextTokens?: number
  settings?: ConversationSettings
}

export type SessionListResponse = {
  sessions?: Array<SessionSummary>
  nextCursor?: string | null
}

export type SessionPage = {
  sessions: Array<SessionMeta>
  nextCursor: string | null
}

export type HistoryResponse = {
  revision?: number
  cursor?: number
  activeRunIds?: Array<string>
  sessionKey: string
  sessionId?: string
  messages: Array<ConversationTurn>
}

export type SessionMeta = {
  revision?: number
  key: string
  friendlyId: string
  title?: string
  derivedTitle?: string
  label?: string
  isPinned?: boolean
  updatedAt?: number
  lastMessage?: ConversationTurn | null
  totalTokens?: number
  contextTokens?: number
  settings?: ConversationSettings
}

export type SessionSearchResult = Pick<
  SessionMeta,
  'key' | 'friendlyId' | 'title' | 'derivedTitle' | 'label' | 'updatedAt'
> & {
  messageId?: string
  snippet?: string
}

export type ReasoningEffort =
  | 'none'
  | 'minimal'
  | 'low'
  | 'medium'
  | 'high'
  | 'xhigh'
  | 'max'

export type ChatRequestAdvancedSettings = {
  reasoning?: {
    effort?: ReasoningEffort
  }
  sampling?: {
    temperature?: number
    topP?: number
    topK?: number
  }
  penalties?: {
    frequencyPenalty?: number
    presencePenalty?: number
  }
  maxTokens?: number
}
