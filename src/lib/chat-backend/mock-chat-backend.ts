import type { GatewayMessage, HistoryResponse, SessionMeta } from '@/screens/chat/types'
import type {
  ChatAttachmentPayload,
  ChatBackend,
  ChatCreateConversationInput,
  ChatDeleteConversationInput,
  ChatDeleteUserMessageInput,
  ChatEditUserMessageInput,
  ChatEvent,
  ChatForkConversationInput,
  ChatHistoryInput,
  ChatRenameConversationInput,
  ChatSendMessageInput,
  ChatSubscription,
} from './types'
import { randomUUID } from '@/lib/utils'

type StoredConversation = {
  key: string
  friendlyId: string
  title?: string
  derivedTitle?: string
  label?: string
  updatedAt: number
  lastMessage?: GatewayMessage | null
  totalTokens?: number
  contextTokens?: number
  messages: Array<GatewayMessage>
  parentSessionKey?: string
  parentFriendlyId?: string
  forkPointMessageId?: string
  forkDepth?: number
}

type StoredState = {
  conversations: Array<StoredConversation>
}

type PendingRun = {
  runId: string
  sessionKey: string
  friendlyId: string
  timers: Array<number>
}

const STORAGE_KEY = 'kairos.mock-chat-backend.v1'
const DEFAULT_CONTEXT_TOKENS = 32768
const streamSubscribers = new Set<ChatSubscription>()
const pendingRuns = new Map<string, PendingRun>()

let stateCache: StoredState | null = null

function loadState(): StoredState {
  if (stateCache) return stateCache
  const emptyState: StoredState = { conversations: [] }

  if (typeof window === 'undefined') {
    stateCache = emptyState
    return stateCache
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      stateCache = emptyState
      return stateCache
    }
    const parsed = JSON.parse(raw) as Partial<StoredState>
    stateCache = {
      conversations: Array.isArray(parsed.conversations)
        ? parsed.conversations.map(normalizeConversation)
        : [],
    }
    return stateCache
  } catch {
    stateCache = emptyState
    return stateCache
  }
}

function saveState(state: StoredState) {
  stateCache = state
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  }
}

function normalizeConversation(value: StoredConversation): StoredConversation {
  const key =
    typeof value.key === 'string' && value.key.trim().length > 0
      ? value.key.trim()
      : randomUUID()
  const friendlyId =
    typeof value.friendlyId === 'string' && value.friendlyId.trim().length > 0
      ? value.friendlyId.trim()
      : key
  const messages = Array.isArray(value.messages)
    ? value.messages.map(normalizeMessage)
    : []
  const lastMessage = value.lastMessage
    ? normalizeMessage(value.lastMessage)
    : messages.at(-1) ?? null

  return {
    key,
    friendlyId,
    title: typeof value.title === 'string' ? value.title : undefined,
    derivedTitle:
      typeof value.derivedTitle === 'string' ? value.derivedTitle : undefined,
    label: typeof value.label === 'string' ? value.label : undefined,
    updatedAt:
      typeof value.updatedAt === 'number' && Number.isFinite(value.updatedAt)
        ? value.updatedAt
        : getMessageTimestamp(lastMessage) || Date.now(),
    lastMessage,
    totalTokens:
      typeof value.totalTokens === 'number' ? value.totalTokens : undefined,
    contextTokens:
      typeof value.contextTokens === 'number'
        ? value.contextTokens
        : DEFAULT_CONTEXT_TOKENS,
    messages,
    parentSessionKey:
      typeof value.parentSessionKey === 'string'
        ? value.parentSessionKey
        : undefined,
    parentFriendlyId:
      typeof value.parentFriendlyId === 'string'
        ? value.parentFriendlyId
        : undefined,
    forkPointMessageId:
      typeof value.forkPointMessageId === 'string'
        ? value.forkPointMessageId
        : undefined,
    forkDepth:
      typeof value.forkDepth === 'number' ? value.forkDepth : undefined,
  }
}

function normalizeMessage(message: GatewayMessage): GatewayMessage {
  return {
    ...message,
    content: Array.isArray(message.content) ? message.content : [],
  }
}

function toSessionMeta(conversation: StoredConversation): SessionMeta {
  return {
    key: conversation.key,
    friendlyId: conversation.friendlyId,
    title: conversation.title,
    derivedTitle: conversation.derivedTitle,
    label: conversation.label,
    updatedAt: conversation.updatedAt,
    lastMessage: conversation.lastMessage ?? null,
    totalTokens: conversation.totalTokens,
    contextTokens: conversation.contextTokens ?? DEFAULT_CONTEXT_TOKENS,
    parentSessionKey: conversation.parentSessionKey,
    parentFriendlyId: conversation.parentFriendlyId,
    forkPointMessageId: conversation.forkPointMessageId,
    forkDepth: conversation.forkDepth,
  }
}

function getMessageTimestamp(message: GatewayMessage | null | undefined): number {
  if (!message) return Date.now()
  const timestamp = message.timestamp
  return typeof timestamp === 'number' && Number.isFinite(timestamp)
    ? timestamp
    : Date.now()
}

function cloneHistory(conversation: StoredConversation): HistoryResponse {
  return {
    sessionKey: conversation.key,
    messages: conversation.messages.map((message) => ({ ...message })),
  }
}

function findConversationIndex(
  state: StoredState,
  input: { sessionKey?: string; friendlyId?: string },
): number {
  const sessionKey = input.sessionKey?.trim() ?? ''
  const friendlyId = input.friendlyId?.trim() ?? ''
  return state.conversations.findIndex((conversation) => {
    if (sessionKey && conversation.key === sessionKey) return true
    if (friendlyId && conversation.friendlyId === friendlyId) return true
    return false
  })
}

function requireConversation(
  input: ChatHistoryInput | ChatSendMessageInput | ChatDeleteConversationInput | ChatRenameConversationInput,
): { state: StoredState; index: number; conversation: StoredConversation } {
  const state = loadState()
  const index = findConversationIndex(state, input)
  if (index < 0) {
    throw new Error('conversation not found')
  }
  return {
    state,
    index,
    conversation: state.conversations[index],
  }
}

function updateConversation(
  index: number,
  updater: (conversation: StoredConversation) => StoredConversation,
) {
  const state = loadState()
  const current = state.conversations.at(index)
  if (!current) {
    throw new Error('conversation not found')
  }
  const nextConversation = normalizeConversation(updater(current))
  const nextState: StoredState = {
    conversations: state.conversations.map((conversation, conversationIndex) =>
      conversationIndex === index ? nextConversation : conversation,
    ),
  }
  saveState(sortState(nextState))
  return nextConversation
}

function sortState(state: StoredState): StoredState {
  return {
    conversations: [...state.conversations].sort(
      (left, right) => right.updatedAt - left.updatedAt,
    ),
  }
}

function emitEvent(event: ChatEvent) {
  for (const subscription of streamSubscribers) {
    const matchesSession =
      subscription.sessionKey && event.sessionKey
        ? subscription.sessionKey === event.sessionKey
        : false
    const matchesFriendly =
      subscription.friendlyId && event.friendlyId
        ? subscription.friendlyId === event.friendlyId
        : false
    if (!matchesSession && !matchesFriendly) continue
    subscription.onEvent(event)
  }
}

function createUserMessage(
  prompt: string,
  attachments?: Array<ChatAttachmentPayload>,
): GatewayMessage {
  const content: Array<any> = []

  if (Array.isArray(attachments)) {
    for (const attachment of attachments) {
      content.push({
        type: 'image',
        source: {
          type: 'base64',
          media_type: attachment.mimeType,
          data: attachment.content,
        },
      })
    }
  }

  content.push({
    type: 'text',
    text: prompt,
  })

  return {
    id: randomUUID(),
    role: 'user',
    content,
    timestamp: Date.now(),
  }
}

function summarizePrompt(message: string): string {
  const normalized = message.replace(/\s+/g, ' ').trim()
  if (!normalized) return 'your latest message'
  if (normalized.length <= 120) return normalized
  return normalized.slice(0, 117).trimEnd() + '...'
}

function textFromMessage(message: GatewayMessage): string {
  const content = Array.isArray(message.content) ? message.content : []
  return content
    .map((part) => (part.type === 'text' ? String(part.text ?? '') : ''))
    .join('')
    .trim()
}

function deriveTitleFromMessages(messages: Array<GatewayMessage>): string | undefined {
  const firstUserMessage = messages.find((message) => message.role === 'user')
  if (!firstUserMessage) return undefined
  const firstText = firstUserMessage.content?.find((part) => part.type === 'text')
  const title =
    firstText && 'text' in firstText ? String(firstText.text ?? '') : ''
  const normalized = title.replace(/\s+/g, ' ').trim()
  if (!normalized) return undefined
  return normalized.slice(0, 48)
}

function countApproximateTokens(text: string): number {
  const normalized = text.trim()
  if (!normalized) return 0
  return Math.max(1, Math.round(normalized.length / 4))
}

function countConversationTokens(messages: Array<GatewayMessage>): number {
  return messages.reduce(function count(total, message) {
    if (message.role !== 'user') return total
    return total + countApproximateTokens(textFromMessage(message))
  }, 0)
}

function cloneMessage(message: GatewayMessage): GatewayMessage {
  return {
    ...message,
    content: Array.isArray(message.content)
      ? message.content.map((part) => ({ ...part }))
      : [],
  }
}

function extractAttachmentsFromMessage(
  message: GatewayMessage,
): Array<ChatAttachmentPayload> {
  const content = Array.isArray(message.content) ? message.content : []
  return content.flatMap(function mapPart(part) {
    const imagePart = part as {
      type?: string
      source?: {
        media_type?: unknown
        data?: unknown
      }
    }
    if (
      imagePart.type !== 'image' ||
      !imagePart.source ||
      typeof imagePart.source !== 'object'
    ) {
      return []
    }
    const source = imagePart.source
    if (
      typeof source.media_type !== 'string' ||
      typeof source.data !== 'string' ||
      source.data.trim().length === 0
    ) {
      return []
    }
    return [
      {
        mimeType: source.media_type,
        content: source.data,
      },
    ]
  })
}

function createForkedConversation(
  source: StoredConversation,
  input: {
    messages: Array<GatewayMessage>
    forkPointMessageId?: string
  },
): StoredConversation {
  const key = randomUUID()
  const friendlyId = randomUUID().slice(0, 8)
  const now = Date.now()
  const parentDepth = source.forkDepth ?? 0
  const messages = input.messages.map(cloneMessage)

  return normalizeConversation({
    key,
    friendlyId,
    title: undefined,
    label: undefined,
    derivedTitle: deriveTitleFromMessages(messages),
    updatedAt: now,
    lastMessage: messages.at(-1) ?? null,
    totalTokens: countConversationTokens(messages),
    contextTokens: source.contextTokens ?? DEFAULT_CONTEXT_TOKENS,
    messages,
    parentSessionKey: source.key,
    parentFriendlyId: source.friendlyId,
    forkPointMessageId: input.forkPointMessageId,
    forkDepth: parentDepth + 1,
  })
}

function saveForkedConversation(conversation: StoredConversation) {
  const state = loadState()
  saveState(
    sortState({
      conversations: [conversation, ...state.conversations],
    }),
  )
}

function findMessageIndex(
  conversation: StoredConversation,
  messageId: string,
): number {
  return conversation.messages.findIndex(function findMessage(message) {
    return (message as { id?: unknown }).id === messageId
  })
}

function buildAssistantDraft(input: ChatSendMessageInput): {
  thinking: string
  answer: string
} {
  const summary = summarizePrompt(input.message)
  const attachmentCount = Array.isArray(input.attachments)
    ? input.attachments.length
    : 0
  const attachmentNote =
    attachmentCount > 0
      ? ` I also noticed ${attachmentCount} attachment${attachmentCount > 1 ? 's' : ''} in the request.`
      : ''

  const thinking =
    input.thinking === 'high'
      ? `Reviewing the prompt, the requested depth, and the available context for "${summary}".`
      : input.thinking === 'low'
        ? `Preparing a concise reply for "${summary}".`
        : `Planning a direct response for "${summary}".`

  const answer =
    `Here is a mock Kairos response based on "${summary}".` +
    attachmentNote +
    ' This placeholder backend is designed to mirror a real chat flow, so the UI can be wired to an HTTP service later without another state rewrite.'

  return { thinking, answer }
}

function scheduleRun(input: {
  runId: string
  sessionKey: string
  friendlyId: string
  thinking: string
  answer: string
}) {
  const assistantMessageId = randomUUID()
  const thinkingMessage: GatewayMessage = {
    id: assistantMessageId,
    role: 'assistant',
    timestamp: Date.now(),
    content: [
      {
        type: 'thinking',
        thinking: input.thinking,
      },
    ],
  }
  const answerChunks = chunkText(input.answer)
  const timers: Array<number> = []
  const pendingRun: PendingRun = {
    runId: input.runId,
    sessionKey: input.sessionKey,
    friendlyId: input.friendlyId,
    timers,
  }
  pendingRuns.set(input.runId, pendingRun)

  timers.push(
    window.setTimeout(() => {
      emitEvent({
        runId: input.runId,
        sessionKey: input.sessionKey,
        friendlyId: input.friendlyId,
        state: 'delta',
        message: thinkingMessage,
      })
    }, 120),
  )

  answerChunks.forEach((_chunk, index) => {
    const partialText = answerChunks.slice(0, index + 1).join('')
    timers.push(
      window.setTimeout(() => {
        emitEvent({
          runId: input.runId,
          sessionKey: input.sessionKey,
          friendlyId: input.friendlyId,
          state: 'delta',
          message: {
            id: assistantMessageId,
            role: 'assistant',
            timestamp: Date.now(),
            content: [
              {
                type: 'thinking',
                thinking: input.thinking,
              },
              {
                type: 'text',
                text: partialText,
              },
            ],
          },
        })
      }, 300 + index * 160),
    )
  })

  timers.push(
    window.setTimeout(() => {
      const finalMessage: GatewayMessage = {
        id: assistantMessageId,
        role: 'assistant',
        timestamp: Date.now(),
        content: [
          {
            type: 'thinking',
            thinking: input.thinking,
          },
          {
            type: 'text',
            text: input.answer,
          },
        ],
      }

      const { index } = requireConversation({
        sessionKey: input.sessionKey,
        friendlyId: input.friendlyId,
      })

      updateConversation(index, function appendAssistantMessage(conversation) {
        const messages = [...conversation.messages, finalMessage]
        const totalTokens = messages.reduce((sum, message) => {
          const messageText = message.content
            ?.filter((part) => part.type === 'text')
            .map((part) => ('text' in part ? String(part.text ?? '') : ''))
            .join(' ')
          return sum + countApproximateTokens(messageText ?? '')
        }, 0)

        return {
          ...conversation,
          messages,
          lastMessage: finalMessage,
          updatedAt: getMessageTimestamp(finalMessage),
          derivedTitle:
            conversation.derivedTitle ?? deriveTitleFromMessages(messages),
          totalTokens,
        }
      })

      emitEvent({
        runId: input.runId,
        sessionKey: input.sessionKey,
        friendlyId: input.friendlyId,
        state: 'final',
        message: finalMessage,
      })

      clearPendingRun(input.runId)
    }, 600 + answerChunks.length * 160),
  )
}

function clearPendingRun(runId: string) {
  const pendingRun = pendingRuns.get(runId)
  if (!pendingRun) return
  for (const timer of pendingRun.timers) {
    window.clearTimeout(timer)
  }
  pendingRuns.delete(runId)
}

function chunkText(text: string): Array<string> {
  const chunkSize = 30
  const chunks: Array<string> = []
  for (let index = 0; index < text.length; index += chunkSize) {
    chunks.push(text.slice(index, index + chunkSize))
  }
  return chunks.length > 0 ? chunks : ['']
}

export function createMockChatBackend(): ChatBackend {
  return {
    getStatus() {
      return Promise.resolve({
        ok: true,
        mode: 'mock',
        provider: 'Kairos Mock Backend',
        detail: 'In-browser persisted chat backend',
      })
    },
    listConversations() {
      return Promise.resolve(loadState().conversations.map(toSessionMeta))
    },
    getConversationHistory(input) {
      const { conversation } = requireConversation(input)
      return Promise.resolve(cloneHistory(conversation))
    },
    createConversation(input?: ChatCreateConversationInput) {
      const key = randomUUID()
      const friendlyId = randomUUID().slice(0, 8)
      const now = Date.now()
      const conversation: StoredConversation = normalizeConversation({
        key,
        friendlyId,
        title: input?.label?.trim() || undefined,
        label: input?.label?.trim() || undefined,
        derivedTitle: input?.label?.trim() || undefined,
        updatedAt: now,
        lastMessage: null,
        totalTokens: 0,
        contextTokens: DEFAULT_CONTEXT_TOKENS,
        messages: [],
      })
      const state = loadState()
      saveState(
        sortState({
          conversations: [conversation, ...state.conversations],
        }),
      )
      return Promise.resolve({
        sessionKey: conversation.key,
        friendlyId: conversation.friendlyId,
      })
    },
    renameConversation(input: ChatRenameConversationInput) {
      const { index, conversation } = requireConversation(input)
      const label = input.label.trim()
      const nextConversation = updateConversation(index, function rename(current) {
        return {
          ...current,
          title: label,
          label,
          derivedTitle: current.derivedTitle ?? conversation.derivedTitle,
        }
      })
      return Promise.resolve({
        sessionKey: nextConversation.key,
        friendlyId: nextConversation.friendlyId,
      })
    },
    deleteConversation(input: ChatDeleteConversationInput) {
      const state = loadState()
      const index = findConversationIndex(state, input)
      if (index < 0) {
        throw new Error('conversation not found')
      }
      const nextState: StoredState = {
        conversations: state.conversations.filter(
          (_conversation, conversationIndex) => conversationIndex !== index,
        ),
      }
      saveState(nextState)
      return Promise.resolve()
    },
    sendMessage(input: ChatSendMessageInput) {
      const { index } = requireConversation(input)
      const userMessage = createUserMessage(input.message, input.attachments)
      updateConversation(index, function appendUserMessage(conversation) {
        const messages = [...conversation.messages, userMessage]
        return {
          ...conversation,
          messages,
          lastMessage: userMessage,
          updatedAt: getMessageTimestamp(userMessage),
          derivedTitle:
            conversation.derivedTitle ?? deriveTitleFromMessages(messages),
          totalTokens:
            (conversation.totalTokens ?? 0) +
            countApproximateTokens(input.message),
        }
      })

      const runId = randomUUID()
      const draft = buildAssistantDraft(input)
      scheduleRun({
        runId,
        sessionKey: input.sessionKey,
        friendlyId: input.friendlyId,
        thinking: draft.thinking,
        answer: draft.answer,
      })

      return Promise.resolve({
        runId,
        sessionKey: input.sessionKey,
      })
    },
    subscribeToConversation(subscription: ChatSubscription) {
      streamSubscribers.add(subscription)
      return function unsubscribe() {
        streamSubscribers.delete(subscription)
      }
    },
    forkConversation(input: ChatForkConversationInput) {
      const { conversation: source } = requireConversation({
        sessionKey: input.sourceSessionKey,
        friendlyId: input.sourceFriendlyId,
      })

      const forkIndex = findMessageIndex(source, input.forkAtMessageId)
      if (forkIndex < 0) {
        throw new Error('Fork point message not found')
      }

      const forkedConversation = createForkedConversation(source, {
        messages: source.messages.slice(0, forkIndex + 1),
        forkPointMessageId: input.forkAtMessageId,
      })
      saveForkedConversation(forkedConversation)

      return Promise.resolve({
        sessionKey: forkedConversation.key,
        friendlyId: forkedConversation.friendlyId,
      })
    },
    editUserMessage(input: ChatEditUserMessageInput) {
      const { conversation: source } = requireConversation({
        sessionKey: input.sourceSessionKey,
        friendlyId: input.sourceFriendlyId,
      })
      const messageIndex = findMessageIndex(source, input.messageId)
      if (messageIndex < 0) {
        throw new Error('User message not found')
      }
      const existingMessage = source.messages[messageIndex]
      if (existingMessage.role !== 'user') {
        throw new Error('Only user messages can be edited')
      }

      const forkPointMessage = source.messages.at(messageIndex - 1)
      const forkPointMessageId =
        forkPointMessage &&
        typeof (forkPointMessage as { id?: unknown }).id === 'string'
          ? (forkPointMessage as { id: string }).id
          : undefined
      const editedMessage = createUserMessage(
        input.message,
        extractAttachmentsFromMessage(existingMessage),
      )
      const forkedConversation = createForkedConversation(source, {
        messages: [...source.messages.slice(0, messageIndex), editedMessage],
        forkPointMessageId,
      })
      saveForkedConversation(forkedConversation)

      const runId = randomUUID()
      const draft = buildAssistantDraft({
        sessionKey: forkedConversation.key,
        friendlyId: forkedConversation.friendlyId,
        message: input.message,
        thinking: input.thinking,
        attachments: extractAttachmentsFromMessage(existingMessage),
      })
      scheduleRun({
        runId,
        sessionKey: forkedConversation.key,
        friendlyId: forkedConversation.friendlyId,
        thinking: draft.thinking,
        answer: draft.answer,
      })

      return Promise.resolve({
        sessionKey: forkedConversation.key,
        friendlyId: forkedConversation.friendlyId,
        runId,
      })
    },
    deleteUserMessage(input: ChatDeleteUserMessageInput) {
      const { conversation: source } = requireConversation({
        sessionKey: input.sourceSessionKey,
        friendlyId: input.sourceFriendlyId,
      })
      const messageIndex = findMessageIndex(source, input.messageId)
      if (messageIndex < 0) {
        throw new Error('User message not found')
      }
      const existingMessage = source.messages[messageIndex]
      if (existingMessage.role !== 'user') {
        throw new Error('Only user messages can be deleted')
      }

      const forkPointMessage = source.messages.at(messageIndex - 1)
      const forkPointMessageId =
        forkPointMessage &&
        typeof (forkPointMessage as { id?: unknown }).id === 'string'
          ? (forkPointMessage as { id: string }).id
          : undefined
      const forkedConversation = createForkedConversation(source, {
        messages: source.messages.slice(0, messageIndex),
        forkPointMessageId,
      })
      saveForkedConversation(forkedConversation)

      return Promise.resolve({
        sessionKey: forkedConversation.key,
        friendlyId: forkedConversation.friendlyId,
      })
    },
  }
}
