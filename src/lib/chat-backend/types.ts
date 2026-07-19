import type {
  GatewayMessage,
  HistoryResponse,
  SessionMeta,
  ChatRequestAdvancedSettings,
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
  sourceSessionKey: string
  sourceFriendlyId: string
  messageId: string
}

export type ChatSendMessageResult = {
  runId: string
  sessionKey: string
  userMessageId?: string
  assistantMessageId?: string
  clientId?: string
}

export type ChatConversationResult = SessionMeta & {
  sessionKey: string
  friendlyId: string
  runId?: string
  userMessageId?: string
  assistantMessageId?: string
  clientId?: string
}

export type ChatConversationRunResult = ChatConversationResult & {
  runId: string
}

export type ChatEvent = {
  cursor?: number
  runId?: string
  sessionKey?: string
  friendlyId?: string
  state?: 'delta' | 'final' | 'error' | 'aborted' | 'title' | 'reconcile'
  error?: string
  activeRunIds?: Array<string>
  message?: GatewayMessage
  session?: SessionMeta
}

export type ChatSubscription = {
  sessionKey?: string
  friendlyId?: string
  onEvent: (event: ChatEvent) => void
  onReconnect?: () => void
  onReconcile?: (event: ChatEvent) => void
}

export type ChatBackend = {
  getStatus: () => Promise<ChatStatus>
  listConversations: () => Promise<Array<SessionMeta>>
  getConversationHistory: (input: ChatHistoryInput) => Promise<HistoryResponse>
  createConversation: (
    input?: ChatCreateConversationInput,
  ) => Promise<ChatConversationResult>
  renameConversation: (
    input: ChatRenameConversationInput,
  ) => Promise<ChatConversationResult>
  pinConversation: (input: ChatPinConversationInput) => Promise<SessionMeta>
  deleteConversation: (input: ChatDeleteConversationInput) => Promise<void>
  stopConversation: (input: ChatStopConversationInput) => Promise<void>
  sendMessage: (input: ChatSendMessageInput) => Promise<ChatSendMessageResult>
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
