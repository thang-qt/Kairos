import { useCallback, useRef } from 'react'
import { useNavigate } from '@tanstack/react-router'

import { createOptimisticMessage } from '../chat-screen-utils'
import {
  acceptConversationCommand,
  appendHistoryMessage,
  chatQueryKeys,
  invalidateChatSessionQueries,
  moveHistoryMessages,
  removeHistoryMessageByClientId,
  updateHistoryMessageByClientId,
  upsertSessionSummary,
} from '../chat-queries'
import { setRecentSession } from '../pending-send'
import {
  beginFreshNewChat,
  useConversationSettingsStore,
} from '../conversation-settings'
import { getChatBackend } from '@/lib/chat-backend'
import { ApiError } from '@/lib/api-client'

import type { Dispatch, SetStateAction } from 'react'
import type { QueryClient } from '@tanstack/react-query'
import type { AttachmentFile } from '@/features/chat/components/composer/attachment-button'
import type { ChatComposerHelpers } from '../components/chat-composer'
import type { ChatCreateConversationInput } from '@/lib/chat-backend/types'
import type { ChatRequestAdvancedSettings } from '../types'
import type { ConversationSettings } from '../conversation-settings'

export type RetryableNewConversation = {
  message: string
  clientId: string
  generation: number
  reuseKey: boolean
  request: ChatCreateConversationInput
}

type UseChatConversationCreationInput = {
  queryClient: QueryClient
  newChatGeneration: number
  conversationSettings: ConversationSettings
  resolvedConversationModel: string
  resolvedSystemPrompt: string
  resolvedWebSearch: boolean
  resolvedMathTools: boolean
  resolvedAdvancedSettings?: ChatRequestAdvancedSettings
  beginGeneration: () => void
  finishGeneration: () => void
  startRun: (runId: string) => void
  setSending: Dispatch<SetStateAction<boolean>>
  setCreatingSession: Dispatch<SetStateAction<boolean>>
  setStreamError: Dispatch<SetStateAction<string | null>>
  setPinToTop: (pin: boolean) => void
  onSessionResolved?: (payload: {
    sessionKey: string
    friendlyId: string
  }) => void
}

export function useChatConversationCreation({
  queryClient,
  newChatGeneration,
  conversationSettings,
  resolvedConversationModel,
  resolvedSystemPrompt,
  resolvedWebSearch,
  resolvedMathTools,
  resolvedAdvancedSettings,
  beginGeneration,
  finishGeneration,
  startRun,
  setSending,
  setCreatingSession,
  setStreamError,
  setPinToTop,
  onSessionResolved,
}: UseChatConversationCreationInput) {
  const navigate = useNavigate()
  const retryableConversationRef = useRef<RetryableNewConversation | null>(null)
  const creationAttemptRef = useRef(0)

  const createConversation = useCallback(
    function createConversation(
      body: string,
      attachments: Array<AttachmentFile> | undefined,
      helpers: ChatComposerHelpers,
      retryCreation = false,
    ) {
      const attachmentsPayload = attachments
        ?.filter((attachment) => Boolean(attachment.base64))
        .map((attachment) => ({
          mimeType: attachment.file.type,
          content: attachment.base64 as string,
        }))
      const currentRequest: ChatCreateConversationInput = {
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
        attachments: attachmentsPayload,
      }
      const pendingCreation = retryableConversationRef.current
      const retryableNewConversation =
        pendingCreation &&
        (retryCreation ||
          (pendingCreation.reuseKey &&
            matchesRetryableNewConversation(
              pendingCreation,
              currentRequest,
              newChatGeneration,
              attachmentsPayload,
            )))
          ? pendingCreation
          : null
      retryableConversationRef.current = retryableNewConversation
      const optimisticAttachments = retryableNewConversation
        ? attachmentFilesFromCreateRequest(retryableNewConversation.request)
        : attachments
      const optimistic = createOptimisticMessage(body, optimisticAttachments)
      const clientId = retryableNewConversation?.reuseKey
        ? retryableNewConversation.clientId
        : optimistic.clientId
      const optimisticId = optimistic.optimisticId
      const optimisticMessage =
        clientId === optimistic.clientId
          ? optimistic.optimisticMessage
          : { ...optimistic.optimisticMessage, clientId }
      appendHistoryMessage(queryClient, 'new', 'new', optimisticMessage)
      beginGeneration()
      setSending(true)
      setCreatingSession(true)
      setStreamError(null)
      setPinToTop(true)

      const createRequest = retryableNewConversation
        ? {
            ...retryableNewConversation.request,
            idempotencyKey: clientId,
            clientId,
          }
        : { ...currentRequest, idempotencyKey: clientId, clientId }
      const creationGeneration = newChatGeneration
      const creationAttempt = ++creationAttemptRef.current

      function isCurrentCreation(): boolean {
        return (
          creationAttempt === creationAttemptRef.current &&
          creationGeneration ===
            useConversationSettingsStore.getState().generation
        )
      }

      getChatBackend()
        .createConversation(createRequest)
        .then((result) => {
          if (!isCurrentCreation()) {
            void invalidateChatSessionQueries(queryClient)
            return
          }
          retryableConversationRef.current = null
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
            true,
          )
          acceptConversationCommand(queryClient, friendlyId, sessionKey, result)
          updateHistoryMessageByClientId(
            queryClient,
            friendlyId,
            sessionKey,
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
          if (onSessionResolved) {
            onSessionResolved({ sessionKey, friendlyId })
            return
          }
          void navigate({
            to: '/chat/$sessionKey',
            params: { sessionKey: friendlyId },
            replace: true,
          }).then(function releaseDraftHistory() {
            queryClient.removeQueries({
              queryKey: chatQueryKeys.history('new', 'new'),
              exact: true,
              type: 'inactive',
            })
          })
        })
        .catch((error) => {
          if (!isCurrentCreation()) return
          const uncertain =
            !(error instanceof ApiError) ||
            error.status === 408 ||
            error.status >= 500
          retryableConversationRef.current = {
            message: body,
            clientId,
            generation: newChatGeneration,
            reuseKey: uncertain,
            request: createRequest,
          }
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
          setStreamError(
            error instanceof Error
              ? error.message
              : 'Unable to create the conversation.',
          )
        })
        .finally(() => {
          if (!isCurrentCreation()) return
          setSending(false)
          setCreatingSession(false)
        })
    },
    [
      beginGeneration,
      conversationSettings,
      finishGeneration,
      navigate,
      newChatGeneration,
      onSessionResolved,
      queryClient,
      resolvedAdvancedSettings,
      resolvedConversationModel,
      resolvedMathTools,
      resolvedSystemPrompt,
      resolvedWebSearch,
      setCreatingSession,
      setPinToTop,
      setSending,
      setStreamError,
      startRun,
    ],
  )

  const getRetryableNewConversation = useCallback(
    function getRetryableNewConversation() {
      const pending = retryableConversationRef.current
      return pending?.generation === newChatGeneration ? pending : null
    },
    [newChatGeneration],
  )

  return { createConversation, getRetryableNewConversation }
}

export function attachmentFilesFromCreateRequest(
  request: ChatCreateConversationInput,
): Array<AttachmentFile> {
  return (request.attachments ?? []).map(
    function mapAttachment(attachment, index) {
      return {
        id: `retry-${index}`,
        file: new File([], 'retry-attachment', { type: attachment.mimeType }),
        preview: `data:${attachment.mimeType};base64,${attachment.content}`,
        type: 'image' as const,
        base64: attachment.content,
      }
    },
  )
}

function matchesRetryableNewConversation(
  pending: RetryableNewConversation,
  current: ChatCreateConversationInput,
  generation: number,
  currentAttachments?: ChatCreateConversationInput['attachments'],
): boolean {
  if (
    pending.generation !== generation ||
    pending.message !== current.message ||
    pending.request.model !== current.model ||
    pending.request.systemPrompt !== current.systemPrompt ||
    pending.request.webSearch !== current.webSearch ||
    pending.request.mathTools !== current.mathTools ||
    JSON.stringify(pending.request.advanced) !==
      JSON.stringify(current.advanced) ||
    JSON.stringify(pending.request.settings) !==
      JSON.stringify(current.settings)
  ) {
    return false
  }

  return (
    !currentAttachments?.length ||
    JSON.stringify(pending.request.attachments) ===
      JSON.stringify(currentAttachments)
  )
}
