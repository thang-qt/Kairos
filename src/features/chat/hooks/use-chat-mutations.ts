import { useState, useCallback } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'

import { createOptimisticMessage } from '../chat-screen-utils'
import {
  appendHistoryMessage,
  chatQueryKeys,
  clearHistoryMessages,
  moveHistoryMessages,
  removeHistoryMessageByClientId,
  updateHistoryMessageByClientId,
  updateHistoryMessages,
  updateSessionLastMessage,
  upsertSessionSummary,
} from '../chat-queries'
import { getGatewayMessageId } from '../utils'
import { setRecentSession } from '../pending-send'
import { beginFreshNewChat } from '../conversation-settings'
import { getChatBackend } from '@/lib/chat-backend'
import { randomUUID } from '@/lib/utils'

import type { CloneMessagePayload } from '../components/chat-message-list'
import type { QueryClient } from '@tanstack/react-query'
import type { AttachmentFile } from '@/features/chat/components/composer/attachment-button'
import type { ChatComposerHelpers } from '../components/chat-composer'
import type { ChatRequestAdvancedSettings, GatewayMessage } from '../types'
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
  resolvedSystemPrompt: string
  resolvedWebSearch: boolean
  resolvedMathTools: boolean
  resolvedAdvancedSettings?: ChatRequestAdvancedSettings
  conversationSettings: ConversationSettings
  beginGeneration: () => void
  finishGeneration: () => void
  startRun: (runId: string) => void
  refreshHistory: () => void
  setPinToTop: (pin: boolean) => void
  storeCloneScrollRestore: () => void
  stashCloneComposerDraft: (targetFriendlyId: string, value: string) => void
  displayMessages: Array<GatewayMessage>
}

export function useChatMutations({
  activeFriendlyId,
  isNewChat,
  forcedSessionKey,
  resolvedSessionKey,
  activeSessionKey,
  onSessionResolved,
  resolvedConversationModel,
  resolvedSystemPrompt,
  resolvedWebSearch,
  resolvedMathTools,
  resolvedAdvancedSettings,
  conversationSettings,
  beginGeneration,
  finishGeneration,
  startRun,
  refreshHistory,
  setPinToTop,
  storeCloneScrollRestore,
  stashCloneComposerDraft,
  displayMessages,
}: UseChatMutationsInput) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const [sending, setSending] = useState(false)
  const [creatingSession, setCreatingSession] = useState(false)
  const [streamError, setStreamError] = useState<string | null>(null)
  const [deletingUserTurn, setDeletingUserTurn] =
    useState<UserTurnDeleteState>(null)

  const hasAvailableModel = resolvedConversationModel.trim().length > 0

  const sendMessage = useCallback(
    function sendMessage(
      sessionKey: string,
      friendlyId: string,
      body: string,
      skipOptimistic = false,
      modelOverride?: string,
      systemPromptOverride?: string,
      webSearchOverride?: boolean,
      mathToolsOverride?: boolean,
      advancedOverride?: ChatRequestAdvancedSettings,
      attachments?: Array<AttachmentFile>,
      clientIdOverride?: string,
    ) {
      let optimisticClientId = ''
      if (!skipOptimistic) {
        const { clientId, optimisticMessage } = createOptimisticMessage(
          body,
          attachments,
        )
        optimisticClientId = clientId
        appendHistoryMessage(
          queryClient,
          friendlyId,
          sessionKey,
          optimisticMessage,
        )
        updateSessionLastMessage(
          queryClient,
          sessionKey,
          friendlyId,
          optimisticMessage,
        )
      }

      beginGeneration()
      setSending(true)
      setStreamError(null)
      setPinToTop(true)

      const attachmentsPayload = attachments
        ?.filter((attachment) => Boolean(attachment.base64))
        .map((attachment) => ({
          mimeType: attachment.file.type,
          content: attachment.base64 as string,
        }))

      const backend = getChatBackend()
      const model = modelOverride?.trim() || resolvedConversationModel
      const systemPrompt =
        systemPromptOverride !== undefined
          ? systemPromptOverride
          : resolvedSystemPrompt
      const webSearch =
        webSearchOverride !== undefined ? webSearchOverride : resolvedWebSearch
      const mathTools =
        mathToolsOverride !== undefined ? mathToolsOverride : resolvedMathTools
      const advanced =
        advancedOverride !== undefined
          ? advancedOverride
          : resolvedAdvancedSettings
      const idempotencyKey =
        clientIdOverride || optimisticClientId || randomUUID()
      void backend
        .sendMessage({
          sessionKey,
          friendlyId,
          message: body,
          model,
          systemPrompt,
          webSearch,
          mathTools,
          advanced,
          idempotencyKey,
          clientId: clientIdOverride || optimisticClientId || undefined,
          attachments: attachmentsPayload,
        })
        .then((payload) => {
          if (
            typeof payload.runId === 'string' &&
            payload.runId.trim().length > 0
          ) {
            startRun(payload.runId.trim())
          }
          refreshHistory()
          void queryClient.invalidateQueries({
            queryKey: chatQueryKeys.sessions,
          })
        })
        .catch((err) => {
          if (optimisticClientId) {
            updateHistoryMessageByClientId(
              queryClient,
              friendlyId,
              sessionKey,
              optimisticClientId,
              function markFailed(message) {
                return { ...message, status: 'error' }
              },
            )
          }
          finishGeneration()
          setPinToTop(false)
          setStreamError(
            err instanceof Error ? err.message : 'The model request failed.',
          )
          throw err
        })
        .finally(() => {
          setSending(false)
        })
    },
    [
      beginGeneration,
      finishGeneration,
      queryClient,
      refreshHistory,
      resolvedConversationModel,
      resolvedSystemPrompt,
      resolvedWebSearch,
      resolvedMathTools,
      resolvedAdvancedSettings,
      setPinToTop,
      startRun,
    ],
  )

  const send = useCallback(
    function send(body: string, helpers: ChatComposerHelpers) {
      const attachments = helpers.attachments
      if (!hasAvailableModel) {
        return
      }
      if (body.length === 0 && (!attachments || attachments.length === 0)) {
        return
      }
      helpers.reset()

      if (isNewChat) {
        const { clientId, optimisticId, optimisticMessage } =
          createOptimisticMessage(body, attachments)
        appendHistoryMessage(queryClient, 'new', 'new', optimisticMessage)
        beginGeneration()
        setSending(true)
        setCreatingSession(true)
        setStreamError(null)
        setPinToTop(true)

        const attachmentsPayload = attachments
          ?.filter((attachment) => Boolean(attachment.base64))
          .map((attachment) => ({
            mimeType: attachment.file.type,
            content: attachment.base64 as string,
          }))

        getChatBackend()
          .createConversation({
            message: body,
            model: resolvedConversationModel,
            systemPrompt: resolvedSystemPrompt,
            webSearch: resolvedWebSearch,
            mathTools: resolvedMathTools,
            advanced: resolvedAdvancedSettings,
            settings: conversationSettings,
            idempotencyKey: clientId,
            clientId,
            attachments: attachmentsPayload,
          })
          .then((result) => {
            const sessionKey = result.sessionKey || result.key
            const friendlyId = result.friendlyId
            if (!sessionKey || !friendlyId) {
              throw new Error('Invalid conversation response')
            }
            beginFreshNewChat()
            setRecentSession(friendlyId)
            upsertSessionSummary(queryClient, {
              ...result,
              key: sessionKey,
              friendlyId,
            })
            moveHistoryMessages(
              queryClient,
              'new',
              'new',
              friendlyId,
              sessionKey,
            )
            updateHistoryMessageByClientId(
              queryClient,
              friendlyId,
              sessionKey,
              clientId,
              function markSent(message) {
                return {
                  ...message,
                  id: result.userMessageId || message.id,
                  status: undefined,
                }
              },
            )
            if (result.runId) {
              startRun(result.runId)
            }
            if (onSessionResolved) {
              onSessionResolved({ sessionKey, friendlyId })
              return
            }
            navigate({
              to: '/chat/$sessionKey',
              params: { sessionKey: friendlyId },
              replace: true,
            })
          })
          .catch(() => {
            removeHistoryMessageByClientId(
              queryClient,
              'new',
              'new',
              clientId,
              optimisticId,
            )
            helpers.setValue(body)
            finishGeneration()
            setPinToTop(false)
          })
          .finally(() => {
            setSending(false)
            setCreatingSession(false)
          })
        return
      }

      const sessionKeyForSend =
        forcedSessionKey ||
        resolvedSessionKey ||
        activeSessionKey ||
        activeFriendlyId
      sendMessage(
        sessionKeyForSend,
        activeFriendlyId,
        body,
        false,
        resolvedConversationModel,
        undefined,
        undefined,
        undefined,
        undefined,
        attachments,
      )
    },
    [
      activeFriendlyId,
      activeSessionKey,
      forcedSessionKey,
      hasAvailableModel,
      isNewChat,
      navigate,
      onSessionResolved,
      queryClient,
      resolvedSessionKey,
      resolvedConversationModel,
      resolvedSystemPrompt,
      resolvedWebSearch,
      resolvedMathTools,
      resolvedAdvancedSettings,
      sendMessage,
      beginGeneration,
      finishGeneration,
      setPinToTop,
      startRun,
    ],
  )

  const handleRetryLastMessage = useCallback(
    function handleRetryLastMessage() {
      const lastUserMessage = [...displayMessages]
        .reverse()
        .find((msg) => msg.role === 'user')
      if (lastUserMessage && Array.isArray(lastUserMessage.content)) {
        const text = lastUserMessage.content
          .filter((part) => part.type === 'text')
          .map((part) => part.text || '')
          .join('')
        if (text.trim()) {
          setStreamError(null)
          sendMessage(
            activeSessionKey || '',
            activeFriendlyId,
            text,
            true,
            resolvedConversationModel,
            undefined,
            undefined,
            resolvedMathTools,
          )
        }
      }
    },
    [
      activeFriendlyId,
      activeSessionKey,
      displayMessages,
      resolvedConversationModel,
      resolvedMathTools,
      sendMessage,
    ],
  )

  const handleStopGeneration = useCallback(
    async function handleStopGeneration() {
      if (isNewChat) return
      const sessionKeyForStop =
        forcedSessionKey ||
        resolvedSessionKey ||
        activeSessionKey ||
        activeFriendlyId
      if (!sessionKeyForStop) return

      try {
        await getChatBackend().stopConversation({
          sessionKey: sessionKeyForStop,
          friendlyId: activeFriendlyId,
        })
      } catch (error) {
        setStreamError(
          error instanceof Error ? error.message : 'Failed to stop response.',
        )
      }
    },
    [
      activeFriendlyId,
      activeSessionKey,
      forcedSessionKey,
      isNewChat,
      resolvedSessionKey,
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
        await queryClient.invalidateQueries({
          queryKey: chatQueryKeys.sessions,
        })
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
          sourceSessionKey: sourceKey,
          sourceFriendlyId: activeFriendlyId,
          messageId,
          message: normalizedMessage,
          model: resolvedConversationModel,
          systemPrompt: resolvedSystemPrompt,
          webSearch: resolvedWebSearch,
          mathTools: resolvedMathTools,
          advanced: resolvedAdvancedSettings,
          clientId,
        })
        updateHistoryMessageByClientId(
          queryClient,
          activeFriendlyId,
          sourceKey,
          clientId,
          function markSent(message) {
            return {
              ...message,
              id: result.userMessageId || message.id,
              status: undefined,
            }
          },
        )
        if (result.runId) {
          startRun(result.runId)
        }
        refreshHistory()
        await queryClient.invalidateQueries({
          queryKey: chatQueryKeys.sessions,
        })
      } catch (err) {
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
      resolvedSystemPrompt,
      resolvedWebSearch,
      resolvedMathTools,
      resolvedAdvancedSettings,
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

      try {
        deleteTurnFromUserMessage(
          queryClient,
          activeFriendlyId,
          sourceKey,
          target.messageId,
        )
        const backend = getChatBackend()
        await backend.deleteUserMessage({
          sourceSessionKey: sourceKey,
          sourceFriendlyId: activeFriendlyId,
          messageId: target.messageId,
        })
        refreshHistory()
        await queryClient.invalidateQueries({
          queryKey: chatQueryKeys.sessions,
        })
      } catch (err) {
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
      const sessionKeyForSend =
        forcedSessionKey ||
        resolvedSessionKey ||
        activeSessionKey ||
        activeFriendlyId
      if (!hasAvailableModel || isNewChat || body.trim().length === 0) return
      sendMessage(
        sessionKeyForSend,
        activeFriendlyId,
        body,
        false,
        resolvedConversationModel,
        undefined,
        undefined,
        resolvedMathTools,
      )
    },
    [
      activeFriendlyId,
      activeSessionKey,
      forcedSessionKey,
      hasAvailableModel,
      isNewChat,
      resolvedConversationModel,
      resolvedMathTools,
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
    handleStopGeneration,
    handleCloneMessage,
    handleOpenDeleteUserTurn,
    handleSaveEditedUserTurn,
    handleConfirmDeleteUserTurn,
  }
}

function findMessageIndexById(
  messages: Array<GatewayMessage>,
  messageId: string,
): number {
  return messages.findIndex(
    (message) => getGatewayMessageId(message) === messageId,
  )
}

function replaceTurnFromUserMessage(
  queryClient: QueryClient,
  friendlyId: string,
  sessionKey: string,
  messageId: string,
  replacementMessage: GatewayMessage,
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
