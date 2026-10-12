export type { SessionSearchResult } from './contracts'

import type {
  ConversationTurn,
  HistoryResponse,
  SessionMeta,
  SessionSearchResult,
  ChatRequestAdvancedSettings,
  ConversationSettings,
} from './contracts'

export type ChatAttachmentPayload = {
  mimeType: string
  content: string
}

export type ChatStatus = {
  ok: boolean
  mode: 'http'
  provider: string
  detail?: string
}

export type ChatHistoryInput = {
  sessionKey: string
  friendlyId: string
}

export type ChatSendMessageInput = {
  expectedRevision?: number
  sessionKey: string
  friendlyId: string
  message: string
  model?: string
  systemPrompt?: string
  webSearch?: boolean
  mathTools?: boolean
  advanced?: ChatRequestAdvancedSettings
  idempotencyKey?: string
  clientId?: string
  clientTime?: string
  clientTimeZone?: string
  attachments?: Array<ChatAttachmentPayload>
}

export type ChatSendEphemeralMessageInput = Omit<
  ChatSendMessageInput,
  'sessionKey' | 'friendlyId' | 'idempotencyKey'
> & {
  history: Array<ConversationTurn>
  signal?: AbortSignal
}

export type ChatCreateConversationInput = {
  label?: string
  message?: string
  model?: string
  systemPrompt?: string
  webSearch?: boolean
  mathTools?: boolean
  advanced?: ChatRequestAdvancedSettings
  idempotencyKey?: string
  clientId?: string
  clientTime?: string
  clientTimeZone?: string
  attachments?: Array<ChatAttachmentPayload>
  settings?: ConversationSettings
}

export type ChatUpdateConversationSettingsInput = {
  sessionKey: string
  friendlyId: string
  settings: ConversationSettings
}

export type ChatRenameConversationInput = {
  sessionKey: string
  friendlyId?: string
  label: string
}

export type ChatDeleteConversationInput = {
  sessionKey: string
  friendlyId?: string
}

export type ChatPinConversationInput = {
  sessionKey: string
  friendlyId: string
  isPinned: boolean
}

export type ChatStopConversationInput = {
  sessionKey: string
  friendlyId?: string
}

export type ChatCloneConversationInput = {
  sourceSessionKey: string
  sourceFriendlyId: string
  cloneAtMessageId: string
}

export type ChatEditUserMessageInput = {
  idempotencyKey?: string
  expectedRevision?: number
  sourceSessionKey: string
  sourceFriendlyId: string
  messageId: string
  message: string
  model?: string
  systemPrompt?: string
  webSearch?: boolean
  mathTools?: boolean
  advanced?: ChatRequestAdvancedSettings
  clientId?: string
  clientTime?: string
  clientTimeZone?: string
}

export type ChatDeleteUserMessageInput = {
  expectedRevision?: number
  sourceSessionKey: string
  sourceFriendlyId: string
  messageId: string
}

export type ConversationCommandAck = {
  revision?: number
  userTurn?: ConversationTurn
  invalidatedRunIds?: Array<string>
  removedTurnIds?: Array<string>
}

export type ChatSendMessageResult = ConversationCommandAck & {
  runId: string
  sessionKey: string
  userTurnId?: string
  assistantTurnId?: string
  clientId?: string
}

export type ChatConversationResult = SessionMeta &
  ConversationCommandAck & {
    sessionKey: string
    friendlyId: string
    runId?: string
    userTurnId?: string
    assistantTurnId?: string
    clientId?: string
  }

export type ChatConversationRunResult = ChatConversationResult & {
  runId: string
}

export type ConversationEvent = {
  snapshot?: HistoryResponse
  revision?: number
  turnId?: string
  cursor?: number
  runId?: string
  sessionKey?: string
  friendlyId?: string
  state?:
    | 'delta'
    | 'final'
    | 'error'
    | 'aborted'
    | 'title'
    | 'reconcile'
    | 'heartbeat'
    | 'user'
  error?: string
  activeRunIds?: Array<string>
  message?: ConversationTurn
  session?: SessionMeta
}

export type ChatSubscription = {
  sessionKey?: string
  friendlyId?: string
  onEvent: (event: ConversationEvent) => void
  onReconnect?: () => void
  onReconcile?: (event: ConversationEvent) => void
}

export type ChatBackend = {
  retryRun: (input: {
    friendlyId: string
    runId: string
    idempotencyKey: string
    expectedRevision?: number
  }) => Promise<ChatSendMessageResult>
  getStatus: () => Promise<ChatStatus>
  listConversations: () => Promise<Array<SessionMeta>>
  searchConversations: (
    query: string,
    signal?: AbortSignal,
  ) => Promise<Array<SessionSearchResult>>
  getConversationHistory: (input: ChatHistoryInput) => Promise<HistoryResponse>
  createConversation: (
    input?: ChatCreateConversationInput,
  ) => Promise<ChatConversationResult>
  renameConversation: (
    input: ChatRenameConversationInput,
  ) => Promise<ChatConversationResult>
  updateConversationSettings: (
    input: ChatUpdateConversationSettingsInput,
  ) => Promise<SessionMeta>
  pinConversation: (input: ChatPinConversationInput) => Promise<SessionMeta>
  deleteConversation: (input: ChatDeleteConversationInput) => Promise<void>
  stopConversation: (input: ChatStopConversationInput) => Promise<void>
  sendMessage: (input: ChatSendMessageInput) => Promise<ChatSendMessageResult>
  streamEphemeralMessage: (
    input: ChatSendEphemeralMessageInput,
    onEvent: (event: ConversationEvent) => void,
  ) => Promise<void>
  cloneConversation: (
    input: ChatCloneConversationInput,
  ) => Promise<ChatConversationResult>
  editUserMessage: (
    input: ChatEditUserMessageInput,
  ) => Promise<ChatConversationRunResult>
  deleteUserMessage: (
    input: ChatDeleteUserMessageInput,
  ) => Promise<ChatConversationResult>
  subscribeToConversation: (subscription: ChatSubscription) => () => void
}
