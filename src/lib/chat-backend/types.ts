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
  mode: 'mock' | 'http'
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
  thinking?: string
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

export type ChatSendMessageResult = {
  runId: string
  sessionKey: string
}

export type ChatConversationResult = {
  sessionKey: string
  friendlyId: string
}

export type ChatEvent = {
  runId?: string
  sessionKey?: string
  friendlyId?: string
  state?: 'delta' | 'final' | 'error' | 'aborted'
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
  deleteConversation: (input: ChatDeleteConversationInput) => Promise<void>
  sendMessage: (input: ChatSendMessageInput) => Promise<ChatSendMessageResult>
  subscribeToConversation: (subscription: ChatSubscription) => () => void
}
