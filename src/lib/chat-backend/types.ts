import type {
  GatewayMessage,
  HistoryResponse,
  SessionMeta,
} from '@/screens/chat/types'

export type ChatConversation = SessionMeta

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
  thinking?: string
  temperature?: number
  topP?: number
  maxOutputTokens?: number
  idempotencyKey?: string
  attachments?: Array<ChatAttachmentPayload>
}

export type ChatCreateConversationInput = {
  label?: string
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

export type ChatForkConversationInput = {
  sourceSessionKey: string
  sourceFriendlyId: string
  forkAtMessageId: string
}

export type ChatEditUserMessageInput = {
  sourceSessionKey: string
  sourceFriendlyId: string
  messageId: string
  message: string
  model?: string
  thinking?: string
  temperature?: number
  topP?: number
  maxOutputTokens?: number
}

export type ChatDeleteUserMessageInput = {
  sourceSessionKey: string
  sourceFriendlyId: string
  messageId: string
}

export type ChatSendMessageResult = {
  runId: string
  sessionKey: string
  assistantMessageId?: string
}

export type ChatConversationResult = {
  sessionKey: string
  friendlyId: string
}

export type ChatConversationRunResult = ChatConversationResult & {
  runId: string
}

export type ChatEvent = {
  runId?: string
  sessionKey?: string
  friendlyId?: string
  state?: 'delta' | 'final' | 'error' | 'aborted'
  error?: string
  message?: GatewayMessage
}

export type ChatSubscription = {
  sessionKey?: string
  friendlyId?: string
  onEvent: (event: ChatEvent) => void
}

export type ChatBackend = {
  getStatus: () => Promise<ChatStatus>
  listConversations: () => Promise<Array<ChatConversation>>
  getConversationHistory: (input: ChatHistoryInput) => Promise<HistoryResponse>
  createConversation: (
    input?: ChatCreateConversationInput,
  ) => Promise<ChatConversationResult>
  renameConversation: (
    input: ChatRenameConversationInput,
  ) => Promise<ChatConversationResult>
  pinConversation: (
    input: ChatPinConversationInput,
  ) => Promise<ChatConversation>
  deleteConversation: (input: ChatDeleteConversationInput) => Promise<void>
  stopConversation: (input: ChatStopConversationInput) => Promise<void>
  sendMessage: (input: ChatSendMessageInput) => Promise<ChatSendMessageResult>
  forkConversation: (
    input: ChatForkConversationInput,
  ) => Promise<ChatConversationResult>
  editUserMessage: (
    input: ChatEditUserMessageInput,
  ) => Promise<ChatConversationRunResult>
  deleteUserMessage: (
    input: ChatDeleteUserMessageInput,
  ) => Promise<ChatConversationResult>
  subscribeToConversation: (subscription: ChatSubscription) => () => void
}
