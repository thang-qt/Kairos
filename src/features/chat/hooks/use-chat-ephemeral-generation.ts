import { useCallback, useEffect, useRef } from 'react'

import { createOptimisticMessage } from '../chat-screen-utils'
import {
  applyConversationEvent,
  cancelEphemeralTurns,
} from '../conversation-event-reducer'
import {
  appendHistoryMessage,
  removeHistoryMessageByClientId,
  updateHistoryMessageByClientId,
  updateHistoryMessages,
} from '../chat-queries'
import { getChatBackend } from '@/lib/chat-backend'

import type { QueryClient } from '@tanstack/react-query'
import type { ChatComposerHelpers } from '../components/chat-composer'
import type { ConversationSettings, ConversationTurn } from '../types'

type UseChatEphemeralGenerationInput = {
  activeFriendlyId: string
  isNewChat: boolean
  throwawayMode: boolean
  queryClient: QueryClient
  displayMessages: Array<ConversationTurn>
  conversationSettings: ConversationSettings
  beginGeneration: () => void
  finishGeneration: () => void
  setSending: (sending: boolean) => void
  setStreamError: (error: string | null) => void
  setPinToTop: (pin: boolean) => void
}

export function useChatEphemeralGeneration({
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
}: UseChatEphemeralGenerationInput) {
  const abortRef = useRef<AbortController | null>(null)

  useEffect(
    function cancelEphemeralOnScopeChange() {
      return function cancelEphemeralRequest() {
        abortRef.current?.abort()
        abortRef.current = null
      }
    },
    [activeFriendlyId, isNewChat, throwawayMode],
  )

  const sendEphemeralMessage = useCallback(
    function sendEphemeralMessage(body: string, helpers: ChatComposerHelpers) {
      const attachments = helpers.attachments
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
      abortRef.current = abortController
      let receivedStreamEvent = false
      getChatBackend()
        .streamEphemeralMessage(
          {
            history: displayMessages,
            message: body,
            settings: conversationSettings,
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
                return applyConversationEvent(messages, event)
              },
            )
            if (event.state === 'error') {
              setStreamError(event.error?.trim() || 'The model request failed.')
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
        })
        .catch((error) => {
          const aborted =
            error instanceof DOMException && error.name === 'AbortError'
          if (aborted) {
            updateHistoryMessages(
              queryClient,
              'new',
              'new',
              cancelEphemeralTurns,
            )
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
          if (abortRef.current === abortController) {
            abortRef.current = null
          }
          setSending(false)
        })
    },
    [
      beginGeneration,
      displayMessages,
      finishGeneration,
      queryClient,
      conversationSettings,
      setPinToTop,
      setSending,
      setStreamError,
    ],
  )

  const stopEphemeralGeneration = useCallback(
    function stopEphemeralGeneration() {
      abortRef.current?.abort()
    },
    [],
  )

  return { sendEphemeralMessage, stopEphemeralGeneration }
}
