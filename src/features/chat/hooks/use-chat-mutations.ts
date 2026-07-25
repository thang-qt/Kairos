import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'

import { createOptimisticMessage } from '../chat-screen-utils'
import { reduceChatEventMessages } from '../chat-event-reducer'
import {
  appendHistoryMessage,
  clearHistoryMessages,
  invalidateChatSessionQueries,
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
import { ApiError } from '@/lib/api-client'
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

type RetryableNetworkSend = {
  sessionKey: string
  friendlyId: string
  message: string
  model: string
  systemPrompt: string
  webSearch: boolean
  mathTools: boolean
  advanced?: ChatRequestAdvancedSettings
  attachments?: Array<AttachmentFile>
  clientId?: string
  idempotencyKey: string
}

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
  throwawayMode,
}: UseChatMutationsInput) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const [sending, setSending] = useState(false)
  const [creatingSession, setCreatingSession] = useState(false)
  const [streamError, setStreamError] = useState<string | null>(null)
  const [retryableNetworkSend, setRetryableNetworkSend] =
    useState<RetryableNetworkSend | null>(null)
  const [deletingUserTurn, setDeletingUserTurn] =
    useState<UserTurnDeleteState>(null)
  const ephemeralAbortRef = useRef<AbortController | null>(null)

  const hasAvailableModel = resolvedConversationModel.trim().length > 0

  useEffect(
    function cancelEphemeralOnScopeChange() {
      return function cancelEphemeralRequest() {
        ephemeralAbortRef.current?.abort()
        ephemeralAbortRef.current = null
      }
    },
    [activeFriendlyId, isNewChat, throwawayMode],
  )

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
      idempotencyKeyOverride?: string,
    ) {
      if (!skipOptimistic) {
        setRetryableNetworkSend(null)
      }
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
      const clientId = clientIdOverride || optimisticClientId || undefined
      const idempotencyKey = idempotencyKeyOverride || clientId || randomUUID()
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
          clientId,
          attachments: attachmentsPayload,
        })
        .then((payload) => {
          setRetryableNetworkSend(function clearMatchingRetryableSend(current) {
            return current?.idempotencyKey === idempotencyKey ? null : current
          })
          if (
            typeof payload.runId === 'string' &&
            payload.runId.trim().length > 0
          ) {
            startRun(payload.runId.trim())
          }
          refreshHistory()
          void invalidateChatSessionQueries(queryClient)
        })
        .catch((err) => {
          if (!(err instanceof ApiError)) {
            setRetryableNetworkSend({
              sessionKey,
              friendlyId,
              message: body,
              model,
              systemPrompt,
              webSearch,
              mathTools,
              advanced,
              attachments,
              clientId,
              idempotencyKey,
            })
          }
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

      if (isNewChat && throwawayMode) {
        const { clientId, optimisticId, optimisticMessage } =
          createOptimisticMessage(body, attachments)
        appendHistoryMessage(queryClient, 'new', 'new', optimisticMessage)
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

        const abortController = new AbortController()
        ephemeralAbortRef.current = abortController
        let receivedStreamEvent = false
        getChatBackend()
          .streamEphemeralMessage(
            {
              history: displayMessages,
              message: body,
              model: resolvedConversationModel,
              systemPrompt: resolvedSystemPrompt,
              webSearch: resolvedWebSearch,
              mathTools: resolvedMathTools,
              advanced: resolvedAdvancedSettings,
              clientId,
              attachments: attachmentsPayload,
              signal: abortController.signal,
            },
            function handleEphemeralEvent(event) {
              receivedStreamEvent = true
              updateHistoryMessageByClientId(
                queryClient,
                'new',
                'new',
                clientId,
                function markAccepted(message) {
                  return { ...message, status: undefined }
                },
              )
              updateHistoryMessages(
                queryClient,
                'new',
                'new',
                function reduceEphemeralEvent(messages) {
                  return reduceChatEventMessages(messages, event, {
                    retainRunMessagesOnTerminal: true,
                  })
                },
              )
              if (event.state === 'error') {
                setStreamError(
                  event.error?.trim() || 'The model request failed.',
                )
              }
            },
          )
          .then(() => {
            updateHistoryMessageByClientId(
              queryClient,
              'new',
              'new',
              clientId,
              function markSent(message) {
                return { ...message, status: undefined }
              },
            )
            finishGeneration()
            setPinToTop(false)
          })
          .catch((error) => {
            const aborted =
              error instanceof DOMException && error.name === 'AbortError'
            if (aborted) {
              updateHistoryMessageByClientId(
                queryClient,
                'new',
                'new',
                clientId,
                function markStopped(message) {
                  return { ...message, status: undefined }
                },
              )
            } else if (!receivedStreamEvent) {
              removeHistoryMessageByClientId(
                queryClient,
                'new',
                'new',
                clientId,
                optimisticId,
              )
              helpers.setValue(body)
            } else {
              updateHistoryMessageByClientId(
                queryClient,
                'new',
                'new',
                clientId,
                function markAccepted(message) {
                  return { ...message, status: undefined }
                },
              )
            }
            finishGeneration()
            setPinToTop(false)
            if (aborted) return
            setStreamError(
              error instanceof Error
                ? error.message
                : 'The model request failed.',
            )
          })
          .finally(() => {
            if (ephemeralAbortRef.current === abortController) {
              ephemeralAbortRef.current = null
            }
            setSending(false)
          })
        return
      }

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
            settings: {
              ...conversationSettings,
              model: resolvedConversationModel,
            },
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
            void invalidateChatSessionQueries(queryClient)
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
      throwawayMode,
      displayMessages,
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

      if (
        retryableNetworkSend &&
        retryableNetworkSend.friendlyId === activeFriendlyId
      ) {
        setStreamError(null)
        sendMessage(
          retryableNetworkSend.sessionKey,
          retryableNetworkSend.friendlyId,
          retryableNetworkSend.message,
          true,
          retryableNetworkSend.model,
          retryableNetworkSend.systemPrompt,
          retryableNetworkSend.webSearch,
          retryableNetworkSend.mathTools,
          retryableNetworkSend.advanced,
          retryableNetworkSend.attachments,
          retryableNetworkSend.clientId,
          retryableNetworkSend.idempotencyKey,
        )
        return
      }

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
      isNewChat,
      queryClient,
      retryableNetworkSend,
      resolvedConversationModel,
      resolvedMathTools,
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
        ephemeralAbortRef.current?.abort()
        return
      }
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
        await invalidateChatSessionQueries(queryClient)
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
        await invalidateChatSessionQueries(queryClient)
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
    clearRetryableNetworkSend,
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

function findLastUserMessageIndex(messages: Array<GatewayMessage>): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].role === 'user') return index
  }
  return -1
}

function messageText(message: GatewayMessage): string {
  if (!Array.isArray(message.content)) return ''
  return message.content
    .filter((part) => part.type === 'text')
    .map((part) => part.text || '')
    .join('')
}

function attachmentFilesFromMessage(
  message: GatewayMessage,
): Array<AttachmentFile> {
  if (!Array.isArray(message.content)) return []
  return message.content.flatMap(function mapAttachment(part) {
    if (part.type !== 'image') return []
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
