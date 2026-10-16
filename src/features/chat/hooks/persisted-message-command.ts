import { createOptimisticMessage } from '../chat-screen-utils'
import {
  acceptConversationCommand,
  appendHistoryMessage,
  chatQueryKeys,
  invalidateChatSessionQueries,
  updateHistoryMessageByClientId,
  updateSessionLastMessage,
} from '../chat-queries'
import { getChatBackend } from '@/lib/chat-backend'
import { ApiError } from '@/lib/api-client'
import { randomUUID } from '@/lib/utils'

import type { Dispatch, SetStateAction } from 'react'
import type { QueryClient } from '@tanstack/react-query'
import type { AttachmentFile } from '@/features/chat/components/composer/attachment-button'
import type {
  ChatRequestAdvancedSettings,
  ConversationSettings,
  HistoryResponse,
} from '../types'

export type RetryableNetworkSend = {
  sessionKey: string
  friendlyId: string
  message: string
  model?: string
  systemPrompt?: string
  webSearch?: boolean
  mathTools?: boolean
  advanced?: ChatRequestAdvancedSettings
  settings?: ConversationSettings
  attachments?: Array<AttachmentFile>
  clientId?: string
  idempotencyKey: string
}

export type PersistedMessageCommand = {
  sessionKey: string
  friendlyId: string
  message: string
  skipOptimistic?: boolean
  model?: string
  systemPrompt?: string
  webSearch?: boolean
  mathTools?: boolean
  advanced?: ChatRequestAdvancedSettings
  settings?: ConversationSettings
  attachments?: Array<AttachmentFile>
  clientId?: string
  idempotencyKey?: string
}

export type PersistedMessageCommandDependencies = {
  queryClient: QueryClient
  conversationSettings: ConversationSettings
  beginGeneration: () => void
  finishGeneration: () => void
  startRun: (runId: string) => void
  refreshHistory: () => void
  setPinToTop: (pin: boolean) => void
  setSending: (sending: boolean) => void
  setStreamError: (error: string | null) => void
  setRetryableNetworkSend: Dispatch<SetStateAction<RetryableNetworkSend | null>>
}

export function sendPersistedMessage(
  command: PersistedMessageCommand,
  dependencies: PersistedMessageCommandDependencies,
): void {
  const {
    sessionKey,
    friendlyId,
    message,
    skipOptimistic = false,
    attachments,
  } = command
  const {
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
  } = dependencies

  if (!skipOptimistic) {
    setRetryableNetworkSend(null)
  }
  let optimisticClientId = ''
  if (!skipOptimistic) {
    const { clientId, optimisticMessage } = createOptimisticMessage(
      message,
      attachments,
    )
    optimisticClientId = clientId
    appendHistoryMessage(queryClient, friendlyId, sessionKey, optimisticMessage)
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
  const { model, systemPrompt, webSearch, mathTools, advanced } = command
  const settings = command.settings ?? conversationSettings
  const clientId = command.clientId || optimisticClientId || undefined
  const idempotencyKey = command.idempotencyKey || clientId || randomUUID()

  void getChatBackend()
    .sendMessage({
      expectedRevision: queryClient.getQueryData<HistoryResponse>(
        chatQueryKeys.history(friendlyId, sessionKey),
      )?.revision,
      sessionKey,
      friendlyId,
      message,
      model,
      systemPrompt,
      webSearch,
      mathTools,
      advanced,
      settings,
      idempotencyKey,
      clientId,
      attachments: attachmentsPayload,
    })
    .then((payload) => {
      acceptConversationCommand(queryClient, friendlyId, sessionKey, payload)
      setRetryableNetworkSend((current) =>
        current?.idempotencyKey === idempotencyKey ? null : current,
      )
      if (
        typeof payload.runId === 'string' &&
        payload.runId.trim().length > 0
      ) {
        startRun(payload.runId.trim())
      }
      refreshHistory()
      void invalidateChatSessionQueries(queryClient)
    })
    .catch((error) => {
      if (!(error instanceof ApiError)) {
        setRetryableNetworkSend({
          sessionKey,
          friendlyId,
          message,
          model,
          systemPrompt,
          webSearch,
          mathTools,
          advanced,
          settings,
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
          function markFailed(turn) {
            return { ...turn, status: 'error' }
          },
        )
      }
      finishGeneration()
      setPinToTop(false)
      setStreamError(
        error instanceof Error ? error.message : 'The model request failed.',
      )
    })
    .finally(() => {
      setSending(false)
    })
}
