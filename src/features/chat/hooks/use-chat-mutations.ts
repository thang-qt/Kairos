import { useCallback, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'

import { createOptimisticMessage } from '../chat-screen-utils'
import {
  chatQueryKeys,
  acceptConversationCommand,
  clearHistoryMessages,
  invalidateChatSessionQueries,
  updateHistoryMessageByClientId,
  updateHistoryMessages,
} from '../chat-queries'
import { getTurnId } from '../utils'
import { resolveConversationSessionKey } from '../conversation-identity'
import { sendPersistedMessage } from './persisted-message-command'
import {
  attachmentFilesFromCreateRequest,
  useChatConversationCreation,
} from './use-chat-conversation-creation'
import type {
  PersistedMessageCommand,
  RetryableNetworkSend,
} from './persisted-message-command'
import { useChatEphemeralGeneration } from './use-chat-ephemeral-generation'
import {
  beginFreshNewChat,
  useConversationSettingsStore,
} from '../conversation-settings'
import { getChatBackend } from '@/lib/chat-backend'
import { randomUUID } from '@/lib/utils'

import type { CloneMessagePayload } from '../components/chat-message-list'
import type { QueryClient } from '@tanstack/react-query'
import type { AttachmentFile } from '@/features/chat/components/composer/attachment-button'
import type { ChatComposerHelpers } from '../components/chat-composer'
import type { ConversationTurn, HistoryResponse } from '../types'
import type { ConversationSettings } from '../conversation-settings'

type UserTurnDeleteState = {
  messageId: string
  currentText: string
} | null

type UseChatMutationsInput = {
  activeFriendlyId: string
  isNewChat: boolean
  forcedSessionKey?: string
  resolvedSessionKey?: string
  activeSessionKey?: string
  onSessionResolved?: (payload: {
    sessionKey: string
    friendlyId: string
  }) => void
  resolvedConversationModel: string
  conversationSettings: ConversationSettings
  beginGeneration: () => void
  finishGeneration: () => void
  startRun: (runId: string) => void
  refreshHistory: () => void
  setPinToTop: (pin: boolean) => void
  storeCloneScrollRestore: () => void
  stashCloneComposerDraft: (targetFriendlyId: string, value: string) => void
  activeRunIds: ReadonlySet<string>
  displayMessages: Array<ConversationTurn>
  throwawayMode: boolean
}

export function useChatMutations({
  activeFriendlyId,
  isNewChat,
  forcedSessionKey,
  resolvedSessionKey,
  activeSessionKey,
  onSessionResolved,
  resolvedConversationModel,
  conversationSettings,
  beginGeneration,
  finishGeneration,
  startRun,
  refreshHistory,
  setPinToTop,
  storeCloneScrollRestore,
  stashCloneComposerDraft,
  activeRunIds,
  displayMessages,
  throwawayMode,
}: UseChatMutationsInput) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const newChatGeneration = useConversationSettingsStore(
    (state) => state.generation,
  )

  const [sending, setSending] = useState(false)
  const [creatingSession, setCreatingSession] = useState(false)
  const [creationStateGeneration, setCreationStateGeneration] =
    useState(newChatGeneration)
  const [streamError, setStreamError] = useState<string | null>(null)
  const [retryableNetworkSend, setRetryableNetworkSend] =
    useState<RetryableNetworkSend | null>(null)
  const [deletingUserTurn, setDeletingUserTurn] =
    useState<UserTurnDeleteState>(null)

  if (creationStateGeneration !== newChatGeneration) {
    setCreationStateGeneration(newChatGeneration)
    setSending(false)
    setCreatingSession(false)
  }

  const hasAvailableModel = resolvedConversationModel.trim().length > 0

  const { sendEphemeralMessage, stopEphemeralGeneration } =
    useChatEphemeralGeneration({
      activeFriendlyId,
      isNewChat,
      throwawayMode,
      queryClient,
      displayMessages,
      conversationSettings,
      beginGeneration,
      finishGeneration,
      setSending,
      setStreamError,
      setPinToTop,
    })
  const {
    createConversation: createNewConversation,
    getRetryableNewConversation,
  } = useChatConversationCreation({
    queryClient,
    newChatGeneration,
    conversationSettings,
    beginGeneration,
    finishGeneration,
    startRun,
    setSending,
    setCreatingSession,
    setStreamError,
    setPinToTop,
    onSessionResolved,
  })

  const sendMessage = useCallback(
    function sendMessage(command: PersistedMessageCommand) {
      sendPersistedMessage(command, {
        queryClient,
        conversationSettings,
        beginGeneration,
        finishGeneration,
        startRun,
        refreshHistory,
        setPinToTop,
        setSending,
        setStreamError,
        setRetryableNetworkSend,
      })
    },
    [
      beginGeneration,
      finishGeneration,
      queryClient,
      refreshHistory,
      resolvedConversationModel,
      conversationSettings,
      setPinToTop,
      startRun,
    ],
  )

  const send = useCallback(
    function send(
      body: string,
      helpers: ChatComposerHelpers,
      retryCreation = false,
    ) {
      const attachments = helpers.attachments
      if (!hasAvailableModel) {
        return
      }
      if (body.length === 0 && (!attachments || attachments.length === 0)) {
        return
      }
      helpers.reset()

      if (isNewChat && throwawayMode) {
        sendEphemeralMessage(body, helpers)
        return
      }

      if (isNewChat) {
        createNewConversation(body, attachments, helpers, retryCreation)
        return
      }

      const sessionKeyForSend = resolveConversationSessionKey({
        activeFriendlyId,
        activeSessionKey,
        forcedSessionKey,
        resolvedSessionKey,
      })
      sendMessage({
        sessionKey: sessionKeyForSend,
        friendlyId: activeFriendlyId,
        message: body,
        attachments,
      })
    },
    [
      activeFriendlyId,
      activeSessionKey,
      forcedSessionKey,
      hasAvailableModel,
      isNewChat,
      resolvedSessionKey,
      resolvedConversationModel,
      conversationSettings,
      sendMessage,
      throwawayMode,
      createNewConversation,
      sendEphemeralMessage,
    ],
  )

  const handleRetryLastMessage = useCallback(
    function handleRetryLastMessage() {
      if (isNewChat && throwawayMode) {
        const lastUserIndex = findLastUserMessageIndex(displayMessages)
        if (lastUserIndex < 0) return
        const lastUserMessage = displayMessages[lastUserIndex]
        const text = messageText(lastUserMessage)
        const attachments = attachmentFilesFromMessage(lastUserMessage)
        if (!text.trim() && attachments.length === 0) return
        updateHistoryMessages(
          queryClient,
          'new',
          'new',
          function removeFailedTurn(messages) {
            return messages.slice(0, lastUserIndex)
          },
        )
        setStreamError(null)
        send(text, {
          attachments,
          reset: function resetRetryComposer() {},
          setValue: function restoreRetryComposer() {},
        })
        return
      }

      const retryableNewConversation = getRetryableNewConversation()
      if (isNewChat && retryableNewConversation) {
        const request = retryableNewConversation.request
        setStreamError(null)
        send(
          request.message ?? '',
          {
            attachments: attachmentFilesFromCreateRequest(request),
            reset: function resetRetryComposer() {},
            setValue: function restoreRetryComposer() {},
          },
          true,
        )
        return
      }

      if (
        retryableNetworkSend &&
        retryableNetworkSend.friendlyId === activeFriendlyId
      ) {
        setStreamError(null)
        sendMessage({
          sessionKey: retryableNetworkSend.sessionKey,
          friendlyId: retryableNetworkSend.friendlyId,
          message: retryableNetworkSend.message,
          skipOptimistic: true,
          model: retryableNetworkSend.model,
          systemPrompt: retryableNetworkSend.systemPrompt,
          webSearch: retryableNetworkSend.webSearch,
          mathTools: retryableNetworkSend.mathTools,
          advanced: retryableNetworkSend.advanced,
          settings: retryableNetworkSend.settings,
          attachments: retryableNetworkSend.attachments,
          clientId: retryableNetworkSend.clientId,
          idempotencyKey: retryableNetworkSend.idempotencyKey,
        })
        return
      }

      const turn = [...displayMessages]
        .reverse()
        .find(function lastAssistant(message) {
          return message.role === 'assistant'
        })
      if (!turn?.runId || turn.canRetry === false) return
      setStreamError(null)
      beginGeneration()
      getChatBackend()
        .retryRun({
          friendlyId: activeFriendlyId,
          runId: turn.runId,
          idempotencyKey: randomUUID(),
          expectedRevision: queryClient.getQueryData<HistoryResponse>(
            chatQueryKeys.history(
              activeFriendlyId,
              resolvedSessionKey || activeSessionKey || '',
            ),
          )?.revision,
        })
        .then(function accepted(result) {
          startRun(result.runId)
          refreshHistory()
        })
        .catch(function failed(error) {
          finishGeneration()
          setStreamError(
            error instanceof Error ? error.message : 'Retry failed',
          )
        })
    },
    [
      beginGeneration,
      finishGeneration,
      startRun,
      refreshHistory,
      resolvedSessionKey,
      activeFriendlyId,
      activeSessionKey,
      displayMessages,
      isNewChat,
      queryClient,
      getRetryableNewConversation,
      retryableNetworkSend,
      send,
      sendMessage,
      throwawayMode,
    ],
  )

  function clearRetryableNetworkSend() {
    setRetryableNetworkSend(null)
  }

  const handleStopGeneration = useCallback(
    async function handleStopGeneration() {
      if (isNewChat && throwawayMode) {
        stopEphemeralGeneration()
        return
      }
      if (isNewChat) return
      const sessionKeyForStop = resolveConversationSessionKey({
        activeFriendlyId,
        activeSessionKey,
        forcedSessionKey,
        resolvedSessionKey,
      })
      if (!sessionKeyForStop) return

      const runId =
        [...displayMessages].reverse().find(function activeTurn(turn) {
          return (
            turn.role === 'assistant' &&
            turn.runId &&
            ['queued', 'preparing', 'running'].includes(turn.status ?? '')
          )
        })?.runId ?? [...activeRunIds][0]
      if (!runId) return
      try {
        await getChatBackend().stopConversation({
          sessionKey: sessionKeyForStop,
          runId,
          friendlyId: activeFriendlyId,
        })
      } catch (error) {
        setStreamError(
          error instanceof Error ? error.message : 'Failed to stop response.',
        )
      }
    },
    [
      displayMessages,
      activeRunIds,
      activeFriendlyId,
      activeSessionKey,
      forcedSessionKey,
      isNewChat,
      resolvedSessionKey,
      stopEphemeralGeneration,
      throwawayMode,
    ],
  )

  const handleCloneMessage = useCallback(
    async function handleCloneMessage(payload: CloneMessagePayload) {
      const sourceKey = activeSessionKey || resolvedSessionKey
      const messageId =
        typeof (payload.message as { id?: unknown }).id === 'string'
          ? (payload.message as { id: string }).id
          : ''
      const isUserTurn = payload.message.role === 'user'
      const cloneAtMessageId = isUserTurn
        ? payload.previousMessageId
        : messageId

      if (isUserTurn && !cloneAtMessageId) {
        stashCloneComposerDraft('new', payload.currentText)
        beginFreshNewChat()
        clearHistoryMessages(queryClient, 'new', 'new')
        storeCloneScrollRestore()
        navigate({ to: '/new' })
        return
      }

      if (!sourceKey || !cloneAtMessageId) return
      try {
        const backend = getChatBackend()
        const result = await backend.cloneConversation({
          sourceSessionKey: sourceKey,
          sourceFriendlyId: activeFriendlyId,
          cloneAtMessageId,
        })
        if (isUserTurn) {
          stashCloneComposerDraft(result.friendlyId, payload.currentText)
        }
        await invalidateChatSessionQueries(queryClient)
        storeCloneScrollRestore()
        navigate({
          to: '/chat/$sessionKey',
          params: { sessionKey: result.friendlyId },
        })
      } catch (err) {
        console.error('Clone failed:', err)
      }
    },
    [
      activeSessionKey,
      resolvedSessionKey,
      activeFriendlyId,
      queryClient,
      navigate,
      storeCloneScrollRestore,
      stashCloneComposerDraft,
    ],
  )

  const handleOpenDeleteUserTurn = useCallback(
    function handleOpenDeleteUserTurn(messageId: string, currentText: string) {
      setDeletingUserTurn({ messageId, currentText })
    },
    [],
  )

  const handleSaveEditedUserTurn = useCallback(
    async function handleSaveEditedUserTurn(
      messageId: string,
      nextMessage: string,
    ) {
      const sourceKey = activeSessionKey || resolvedSessionKey
      const normalizedMessage = nextMessage.trim()
      if (!sourceKey || !messageId || normalizedMessage.length === 0) {
        return
      }

      const historyKey = chatQueryKeys.history(activeFriendlyId, sourceKey)
      const previousHistory =
        queryClient.getQueryData<HistoryResponse>(historyKey)
      try {
        const { clientId, optimisticMessage } =
          createOptimisticMessage(normalizedMessage)
        replaceTurnFromUserMessage(
          queryClient,
          activeFriendlyId,
          sourceKey,
          messageId,
          optimisticMessage,
        )
        beginGeneration()
        setSending(true)
        setStreamError(null)
        setPinToTop(true)

        const backend = getChatBackend()
        const result = await backend.editUserMessage({
          expectedRevision: queryClient.getQueryData<HistoryResponse>(
            chatQueryKeys.history(
              activeFriendlyId,
              resolvedSessionKey || activeSessionKey || '',
            ),
          )?.revision,
          sourceSessionKey: sourceKey,
          sourceFriendlyId: activeFriendlyId,
          messageId,
          message: normalizedMessage,
          settings: conversationSettings,
          idempotencyKey: clientId,
          clientId,
        })
        acceptConversationCommand(
          queryClient,
          activeFriendlyId,
          sourceKey,
          result,
        )
        updateHistoryMessageByClientId(
          queryClient,
          activeFriendlyId,
          sourceKey,
          clientId,
          function markSent(message) {
            return {
              ...message,
              id: result.userTurnId || message.id,
              status: undefined,
            }
          },
        )
        if (result.runId) {
          startRun(result.runId)
        }
        refreshHistory()
        await invalidateChatSessionQueries(queryClient)
      } catch (err) {
        queryClient.setQueryData(historyKey, previousHistory)
        refreshHistory()
        finishGeneration()
        setPinToTop(false)
        setStreamError(
          err instanceof Error ? err.message : 'Failed to edit message.',
        )
        console.error('Edit user turn failed:', err)
      } finally {
        setSending(false)
      }
    },
    [
      activeFriendlyId,
      activeSessionKey,
      beginGeneration,
      finishGeneration,
      queryClient,
      refreshHistory,
      resolvedSessionKey,
      resolvedConversationModel,
      conversationSettings,
      setPinToTop,
      startRun,
    ],
  )

  const handleConfirmDeleteUserTurn = useCallback(
    async function handleConfirmDeleteUserTurn() {
      const sourceKey = activeSessionKey || resolvedSessionKey
      const target = deletingUserTurn
      if (!sourceKey || !target) return

      setDeletingUserTurn(null)

      const historyKey = chatQueryKeys.history(activeFriendlyId, sourceKey)
      const previousHistory =
        queryClient.getQueryData<HistoryResponse>(historyKey)
      try {
        deleteTurnFromUserMessage(
          queryClient,
          activeFriendlyId,
          sourceKey,
          target.messageId,
        )
        const backend = getChatBackend()
        const result = await backend.deleteUserMessage({
          expectedRevision: queryClient.getQueryData<HistoryResponse>(
            chatQueryKeys.history(
              activeFriendlyId,
              resolvedSessionKey || activeSessionKey || '',
            ),
          )?.revision,
          sourceSessionKey: sourceKey,
          sourceFriendlyId: activeFriendlyId,
          messageId: target.messageId,
        })
        acceptConversationCommand(
          queryClient,
          activeFriendlyId,
          sourceKey,
          result,
        )
        refreshHistory()
        await invalidateChatSessionQueries(queryClient)
      } catch (err) {
        queryClient.setQueryData(historyKey, previousHistory)
        refreshHistory()
        setStreamError(
          err instanceof Error ? err.message : 'Failed to delete message.',
        )
        console.error('Delete user turn failed:', err)
      }
    },
    [
      activeFriendlyId,
      activeSessionKey,
      deletingUserTurn,
      queryClient,
      refreshHistory,
      resolvedSessionKey,
    ],
  )

  const sendProgrammaticMessage = useCallback(
    function sendProgrammaticMessage(body: string) {
      const sessionKeyForSend = resolveConversationSessionKey({
        activeFriendlyId,
        activeSessionKey,
        forcedSessionKey,
        resolvedSessionKey,
      })
      if (!hasAvailableModel || isNewChat || body.trim().length === 0) return
      sendMessage({
        sessionKey: sessionKeyForSend,
        friendlyId: activeFriendlyId,
        message: body,
      })
    },
    [
      activeFriendlyId,
      activeSessionKey,
      forcedSessionKey,
      hasAvailableModel,
      isNewChat,
      resolvedConversationModel,
      conversationSettings,
      resolvedSessionKey,
      sendMessage,
    ],
  )

  return {
    sending,
    creatingSession,
    streamError,
    setStreamError,
    deletingUserTurn,
    setDeletingUserTurn,
    hasAvailableModel,
    send,
    sendMessage,
    sendProgrammaticMessage,
    handleRetryLastMessage,
    clearRetryableNetworkSend,
    handleStopGeneration,
    handleCloneMessage,
    handleOpenDeleteUserTurn,
    handleSaveEditedUserTurn,
    handleConfirmDeleteUserTurn,
  }
}

function findMessageIndexById(
  messages: Array<ConversationTurn>,
  messageId: string,
): number {
  return messages.findIndex((message) => getTurnId(message) === messageId)
}

function findLastUserMessageIndex(messages: Array<ConversationTurn>): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].role === 'user') return index
  }
  return -1
}

function messageText(message: ConversationTurn): string {
  if (!Array.isArray(message.content)) return ''
  return message.content
    .filter((part) => part.type === 'text')
    .map((part) => part.text || '')
    .join('')
}

function attachmentFilesFromMessage(
  message: ConversationTurn,
): Array<AttachmentFile> {
  if (!Array.isArray(message.content)) return []
  return message.content.flatMap(function mapAttachment(part) {
    if (part.type !== 'image' || part.source.type !== 'base64') return []
    const mimeType = part.source?.media_type?.trim()
    const base64 = part.source?.data?.trim()
    if (!mimeType || !base64) return []
    return [
      {
        id: randomUUID(),
        file: new File([], 'throwaway-retry-image', { type: mimeType }),
        preview: `data:${mimeType};base64,${base64}`,
        type: 'image' as const,
        base64,
      },
    ]
  })
}

function replaceTurnFromUserMessage(
  queryClient: QueryClient,
  friendlyId: string,
  sessionKey: string,
  messageId: string,
  replacementMessage: ConversationTurn,
) {
  updateHistoryMessages(
    queryClient,
    friendlyId,
    sessionKey,
    function replace(messages) {
      const messageIndex = findMessageIndexById(messages, messageId)
      if (messageIndex < 0) return messages

      return [...messages.slice(0, messageIndex), replacementMessage]
    },
  )
}

function deleteTurnFromUserMessage(
  queryClient: QueryClient,
  friendlyId: string,
  sessionKey: string,
  messageId: string,
) {
  updateHistoryMessages(
    queryClient,
    friendlyId,
    sessionKey,
    function remove(messages) {
      const messageIndex = findMessageIndexById(messages, messageId)
      if (messageIndex < 0) return messages

      return messages.slice(0, messageIndex)
    },
  )
}
