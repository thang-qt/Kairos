import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'

import { countConversationTokens, isSessionNotFound } from './utils'
import { createOptimisticMessage } from './chat-screen-utils'
import {
  appendHistoryMessage,
  chatQueryKeys,
  clearHistoryMessages,
  moveHistoryMessages,
  fetchChatStatus,
  removeHistoryMessageByClientId,
  updateHistoryMessageByClientId,
  updateSessionLastMessage,
  upsertSessionSummary,
} from './chat-queries'
import { chatUiQueryKey, getChatUiState, setChatUiState } from './chat-ui'
import { ChatSidebar } from './components/chat-sidebar'
import { ChatHeader } from './components/chat-header'
import { ChatMessageList } from './components/chat-message-list'
import { ChatComposer } from './components/chat-composer'
import { BackendStatusMessage } from './components/backend-status-message'
import { MessageStatus } from './components/message-status'
import { UserTurnDeleteDialog } from './components/user-turn-delete-dialog'
import {
  hasPendingGeneration,
  isRecentSession,
  setRecentSession,
} from './pending-send'
import { useChatMeasurements } from './hooks/use-chat-measurements'
import { useChatHistory } from './hooks/use-chat-history'
import { useChatMobile } from './hooks/use-chat-mobile'
import { useChatSessions } from './hooks/use-chat-sessions'
import { useChatStream } from './hooks/use-chat-stream'
import { useChatRedirect } from './hooks/use-chat-redirect'
import { useChatRuns } from './hooks/use-chat-runs'
import {
  copyConversationSettings,
  normalizeConversationTextSetting,
  parseConversationNumberSetting,
  resolveConversationModelID,
  useConversationSettings,
} from './conversation-settings'
import { RightSidebar } from './components/right-sidebar'
import type { CloneMessagePayload } from './components/chat-message-list'
import type { RightSidebarTab } from './components/right-sidebar'
import type { AttachmentFile } from '@/components/attachment-button'
import type {
  ChatComposerDraft,
  ChatComposerHelpers,
} from './components/chat-composer'
import { AppShell } from '@/components/app-shell'
import { useExport } from '@/hooks/use-export'
import { useChatSettings } from '@/hooks/use-chat-settings'
import { useModelsQuery } from '@/lib/app-api'
import { getChatBackend } from '@/lib/chat-backend'
import { providerModelKey } from '@/lib/model-utils'
import { randomUUID } from '@/lib/utils'

type ChatScreenProps = {
  activeFriendlyId: string
  isNewChat?: boolean
  onSessionResolved?: (payload: {
    sessionKey: string
    friendlyId: string
  }) => void
  forcedSessionKey?: string
}

const CLONE_SCROLL_RESTORE_KEY = 'kairos.clone-scroll-restore'
const CLONE_COMPOSER_DRAFT_KEY = 'kairos.clone-composer-draft'

type UserTurnDeleteState = {
  messageId: string
  currentText: string
} | null

export function ChatScreen({
  activeFriendlyId,
  isNewChat = false,
  onSessionResolved,
  forcedSessionKey,
}: ChatScreenProps) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [sending, setSending] = useState(false)
  const [creatingSession, setCreatingSession] = useState(false)
  const [isRedirecting, setIsRedirecting] = useState(false)
  const [streamError, setStreamError] = useState<string | null>(null)
  const [rightSidebarOpen, setRightSidebarOpen] = useState(false)
  const [rightSidebarTab, setRightSidebarTab] =
    useState<RightSidebarTab>('options')
  const [restoreScrollTop, setRestoreScrollTop] = useState<number | null>(null)
  const [composerDraft, setComposerDraft] = useState<ChatComposerDraft | null>(
    null,
  )
  const [deletingUserTurn, setDeletingUserTurn] =
    useState<UserTurnDeleteState>(null)
  const { headerRef, composerRef, mainRef, pinGroupMinHeight, headerHeight } =
    useChatMeasurements()
  const [pinToTop, setPinToTop] = useState(() => hasPendingGeneration())
  const { settings } = useChatSettings()
  const {
    settings: conversationSettings,
    updateSettings: updateConversationSettings,
  } = useConversationSettings(activeFriendlyId || 'new')
  const modelsQuery = useModelsQuery()
  const models = modelsQuery.data?.models ?? []
  const defaultModelId = modelsQuery.data?.preferences.defaultModelId
  const resolvedConversationModel = resolveConversationModelID(
    conversationSettings.model,
    models,
    defaultModelId,
  )
  const resolvedConversationModelDetails = models.find(
    function matchResolvedModel(model) {
      return (
        providerModelKey(model) === resolvedConversationModel ||
        model.id === resolvedConversationModel
      )
    },
  )
  const modelLabelById = useMemo(() => {
    const map = new Map<string, string>()
    for (const model of models) {
      const normalizedName = model.name?.trim()
      map.set(providerModelKey(model), normalizedName || model.id)
    }
    return map
  }, [models])
  const handleSelectConversationModel = useCallback(
    function handleSelectConversationModel(modelId: string) {
      updateConversationSettings({ model: modelId })
    },
    [updateConversationSettings],
  )
  const resolvedSystemPrompt = normalizeConversationTextSetting(
    conversationSettings.systemPrompt,
  )
  const resolvedThinkingLevel = conversationSettings.thinkingLevel
  const resolvedTemperature = parseConversationNumberSetting(
    conversationSettings.temperature,
    {
      min: 0,
      max: 2,
    },
  )
  const resolvedTopP = parseConversationNumberSetting(
    conversationSettings.topP,
    {
      min: 0,
      max: 1,
    },
  )
  const resolvedMaxOutputTokens = parseConversationNumberSetting(
    conversationSettings.maxOutputTokens,
    {
      min: 1,
      max: Number.MAX_SAFE_INTEGER,
      round: true,
    },
  )
  const hasAvailableModel = resolvedConversationModel.trim().length > 0
  const scrollTopRef = useRef(0)
  const { isMobile } = useChatMobile(queryClient)
  const {
    sessionsQuery,
    sessions,
    activeSession,
    activeExists,
    activeSessionKey,
    hasActiveTitle,
    activeTitle,
    sessionsError,
  } = useChatSessions({ activeFriendlyId, isNewChat, forcedSessionKey })
  const {
    historyQuery,
    displayMessages,
    historyError,
    resolvedSessionKey,
    activeCanonicalKey,
    sessionKeyForHistory,
  } = useChatHistory({
    activeFriendlyId,
    activeSessionKey,
    forcedSessionKey,
    isNewChat,
    isRedirecting,
    activeExists,
    sessionsReady: sessionsQuery.isSuccess,
    queryClient,
  })
  const usedTokens =
    typeof activeSession?.totalTokens === 'number' &&
    activeSession.totalTokens > 0
      ? activeSession.totalTokens
      : countConversationTokens(displayMessages)

  const { exportConversation } = useExport({
    currentFriendlyId: activeFriendlyId,
    currentSessionKey: sessionKeyForHistory,
    sessionTitle: activeTitle,
  })

  const uiQuery = useQuery({
    queryKey: chatUiQueryKey,
    queryFn: function readUiState() {
      return getChatUiState(queryClient)
    },
    initialData: function initialUiState() {
      return getChatUiState(queryClient)
    },
    staleTime: Infinity,
  })
  const backendStatusQuery = useQuery({
    queryKey: ['chat-backend', 'status'],
    queryFn: fetchChatStatus,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchOnMount: 'always',
  })
  const backendStatusMountRef = useRef(Date.now())
  const backendStatusError =
    backendStatusQuery.error instanceof Error
      ? backendStatusQuery.error.message
      : backendStatusQuery.data && !backendStatusQuery.data.ok
        ? backendStatusQuery.data.detail || 'Chat backend unavailable'
        : null
  const backendError = backendStatusError ?? sessionsError ?? historyError
  const handleBackendRefetch = useCallback(() => {
    void backendStatusQuery.refetch()
  }, [backendStatusQuery])
  const isSidebarCollapsed = uiQuery.data.isSidebarCollapsed
  const handleActiveSessionDelete = useCallback(() => {
    setIsRedirecting(true)
    navigate({ to: '/new', replace: true })
  }, [navigate])
  const stableContentStyle = useMemo<React.CSSProperties>(() => ({}), [])
  const missingSessionError =
    isSessionNotFound(historyError ?? '') ||
    isSessionNotFound(sessionsError ?? '')

  const shouldRedirectToNew =
    !isNewChat &&
    !forcedSessionKey &&
    !isRecentSession(activeFriendlyId) &&
    sessionsQuery.isSuccess &&
    !sessions.some((session) => session.friendlyId === activeFriendlyId) &&
    (missingSessionError ||
      (!historyQuery.isFetching && !historyQuery.isSuccess))

  const { refetch: refetchHistoryQuery } = historyQuery
  const refreshHistory = useCallback(() => {
    void refetchHistoryQuery()
  }, [refetchHistoryQuery])

  const hideUi = shouldRedirectToNew || isRedirecting

  const {
    beginGeneration,
    finishAllRuns,
    finishGeneration,
    finishRun,
    setWaitingForResponse,
    startRun,
    waitingForResponse,
  } = useChatRuns({ refreshHistory })

  useEffect(() => {
    setStreamError(null)
  }, [activeFriendlyId, forcedSessionKey, isNewChat])

  const sendMessage = useCallback(
    function sendMessage(
      sessionKey: string,
      friendlyId: string,
      body: string,
      skipOptimistic = false,
      modelOverride?: string,
      systemPromptOverride?: string,
      thinkingOverride?: string,
      temperatureOverride?: number,
      topPOverride?: number,
      maxOutputTokensOverride?: number,
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
      const thinking =
        thinkingOverride !== undefined
          ? thinkingOverride
          : resolvedThinkingLevel
      const temperature =
        temperatureOverride !== undefined
          ? temperatureOverride
          : resolvedTemperature
      const topP = topPOverride !== undefined ? topPOverride : resolvedTopP
      const maxOutputTokens =
        maxOutputTokensOverride !== undefined
          ? maxOutputTokensOverride
          : resolvedMaxOutputTokens
      const idempotencyKey =
        clientIdOverride || optimisticClientId || randomUUID()
      void backend
        .sendMessage({
          sessionKey,
          friendlyId,
          message: body,
          model,
          systemPrompt,
          thinking,
          temperature,
          topP,
          maxOutputTokens,
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
      resolvedMaxOutputTokens,
      resolvedSystemPrompt,
      resolvedTemperature,
      resolvedThinkingLevel,
      resolvedTopP,
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
            thinking: resolvedThinkingLevel,
            temperature: resolvedTemperature,
            topP: resolvedTopP,
            maxOutputTokens: resolvedMaxOutputTokens,
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
            copyConversationSettings(activeFriendlyId || 'new', friendlyId)
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
      resolvedMaxOutputTokens,
      resolvedSessionKey,
      resolvedConversationModel,
      resolvedSystemPrompt,
      resolvedTemperature,
      resolvedThinkingLevel,
      resolvedTopP,
      sendMessage,
    ],
  )

  const startNewChat = useCallback(() => {
    setStreamError(null)
    setWaitingForResponse(false)
    setPinToTop(false)
    clearHistoryMessages(queryClient, 'new', 'new')
    navigate({ to: '/new' })
    if (isMobile) {
      setChatUiState(queryClient, function collapse(state) {
        return { ...state, isSidebarCollapsed: true }
      })
    }
  }, [isMobile, navigate, queryClient])

  const handleToggleSidebarCollapse = useCallback(() => {
    setChatUiState(queryClient, function toggle(state) {
      return { ...state, isSidebarCollapsed: !state.isSidebarCollapsed }
    })
  }, [queryClient])

  const handleSelectSession = useCallback(() => {
    if (!isMobile) return
    setChatUiState(queryClient, function collapse(state) {
      return { ...state, isSidebarCollapsed: true }
    })
  }, [isMobile, queryClient])

  const handleOpenSidebar = useCallback(() => {
    setChatUiState(queryClient, function open(state) {
      return { ...state, isSidebarCollapsed: false }
    })
  }, [queryClient])

  const historyLoading = historyQuery.isLoading || isRedirecting
  const showBackendNotice =
    Boolean(backendStatusError) &&
    backendStatusQuery.errorUpdatedAt > backendStatusMountRef.current
  const historyEmpty = !historyLoading && displayMessages.length === 0

  const handleRetryLastMessage = useCallback(() => {
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
          undefined,
          undefined,
          undefined,
        )
      }
    }
  }, [
    activeFriendlyId,
    activeSessionKey,
    displayMessages,
    resolvedConversationModel,
    sendMessage,
  ])

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

  const backendNotice = useMemo(() => {
    if (streamError) {
      return (
        <MessageStatus
          title="Message failed"
          description={streamError}
          actionLabel="Retry"
          onAction={handleRetryLastMessage}
        />
      )
    }
    if (modelsQuery.isSuccess && models.length === 0 && !backendError) {
      return (
        <MessageStatus
          title="No chat model available"
          description="Add a provider in Settings before sending messages."
        />
      )
    }
    if (!showBackendNotice || !backendError) return null
    return (
      <BackendStatusMessage
        state="error"
        error={backendError}
        onRetry={handleBackendRefetch}
      />
    )
  }, [
    backendError,
    handleBackendRefetch,
    handleRetryLastMessage,
    models.length,
    modelsQuery.isSuccess,
    showBackendNotice,
    streamError,
  ])

  useChatStream({
    activeFriendlyId,
    isNewChat,
    isRedirecting,
    resolvedSessionKey,
    sessionKeyForHistory,
    queryClient,
    refreshHistory,
    onChatEvent(payload) {
      const payloadSessionKey =
        typeof payload.sessionKey === 'string' ? payload.sessionKey : ''
      if (
        payloadSessionKey &&
        resolvedSessionKey &&
        payloadSessionKey !== resolvedSessionKey &&
        payloadSessionKey !== sessionKeyForHistory
      ) {
        return
      }
      const runId = typeof payload.runId === 'string' ? payload.runId : ''
      const state = typeof payload.state === 'string' ? payload.state : ''
      const streamErrorMessage =
        typeof payload.error === 'string' ? payload.error.trim() : ''
      if (runId && state === 'delta') {
        startRun(runId)
      }
      if (
        runId &&
        (state === 'final' || state === 'error' || state === 'aborted')
      ) {
        finishRun(runId)
      }
      if (
        !runId &&
        (state === 'final' || state === 'error' || state === 'aborted')
      ) {
        finishAllRuns()
      }
      if (state === 'final' || state === 'error' || state === 'aborted') {
        void queryClient.invalidateQueries({ queryKey: chatQueryKeys.sessions })
      }
      if (state === 'error') {
        setStreamError(streamErrorMessage || 'The model request failed.')
        return
      }
      if (state === 'final') {
        setStreamError(null)
      }
    },
  })

  useChatRedirect({
    activeFriendlyId,
    isNewChat,
    isRedirecting,
    shouldRedirectToNew,
    sessionsReady: sessionsQuery.isSuccess,
    sessionKeyForHistory,
    queryClient,
    setIsRedirecting,
  })

  function stashCloneComposerDraft(targetFriendlyId: string, value: string) {
    if (typeof window === 'undefined') return
    window.sessionStorage.setItem(
      CLONE_COMPOSER_DRAFT_KEY,
      JSON.stringify({ targetFriendlyId, value }),
    )
  }

  const storeCloneScrollRestore = useCallback(
    function storeCloneScrollRestore() {
      if (typeof window === 'undefined') return
      window.sessionStorage.setItem(
        CLONE_SCROLL_RESTORE_KEY,
        JSON.stringify({ scrollTop: scrollTopRef.current }),
      )
    },
    [],
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
        const backend = getChatBackend()
        const result = await backend.editUserMessage({
          sourceSessionKey: sourceKey,
          sourceFriendlyId: activeFriendlyId,
          messageId,
          message: normalizedMessage,
          model: resolvedConversationModel,
          systemPrompt: resolvedSystemPrompt,
          thinking: resolvedThinkingLevel,
          temperature: resolvedTemperature,
          topP: resolvedTopP,
          maxOutputTokens: resolvedMaxOutputTokens,
        })
        startRun(result.runId)
        refreshHistory()
        await queryClient.invalidateQueries({
          queryKey: chatQueryKeys.sessions,
        })
      } catch (err) {
        console.error('Edit user turn failed:', err)
      }
    },
    [
      activeFriendlyId,
      activeSessionKey,
      queryClient,
      refreshHistory,
      resolvedSessionKey,
      resolvedConversationModel,
      resolvedMaxOutputTokens,
      resolvedSystemPrompt,
      resolvedTemperature,
      resolvedThinkingLevel,
      resolvedTopP,
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

  const handleScrollTopChange = useCallback(function handleScrollTopChange(
    scrollTop: number,
  ) {
    scrollTopRef.current = scrollTop
  }, [])

  const handleRestoreScrollTopApplied = useCallback(
    function handleRestoreScrollTopApplied() {
      setRestoreScrollTop(null)
    },
    [],
  )

  useEffect(() => {
    if (typeof window === 'undefined') return
    const raw = window.sessionStorage.getItem(CLONE_SCROLL_RESTORE_KEY)
    if (!raw) return
    window.sessionStorage.removeItem(CLONE_SCROLL_RESTORE_KEY)
    try {
      const parsed = JSON.parse(raw) as { scrollTop?: unknown }
      if (
        typeof parsed.scrollTop === 'number' &&
        Number.isFinite(parsed.scrollTop)
      ) {
        setRestoreScrollTop(parsed.scrollTop)
      }
    } catch {
      setRestoreScrollTop(null)
    }
  }, [activeFriendlyId])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const raw = window.sessionStorage.getItem(CLONE_COMPOSER_DRAFT_KEY)
    if (!raw) return

    try {
      const parsed = JSON.parse(raw) as {
        targetFriendlyId?: unknown
        value?: unknown
      }
      const targetFriendlyId =
        typeof parsed.targetFriendlyId === 'string'
          ? parsed.targetFriendlyId
          : ''
      const value = typeof parsed.value === 'string' ? parsed.value : ''
      const currentFriendlyId = isNewChat ? 'new' : activeFriendlyId
      if (targetFriendlyId !== currentFriendlyId) return

      window.sessionStorage.removeItem(CLONE_COMPOSER_DRAFT_KEY)
      setComposerDraft({
        key: `${targetFriendlyId}:${Date.now()}`,
        value,
      })
    } catch {
      window.sessionStorage.removeItem(CLONE_COMPOSER_DRAFT_KEY)
    }
  }, [activeFriendlyId, isNewChat])

  const sidebar = (
    <ChatSidebar
      sessions={sessions}
      activeFriendlyId={activeFriendlyId}
      creatingSession={creatingSession}
      onCreateSession={startNewChat}
      isCollapsed={isMobile ? false : isSidebarCollapsed}
      onToggleCollapse={handleToggleSidebarCollapse}
      onSelectSession={handleSelectSession}
      onActiveSessionDelete={handleActiveSessionDelete}
    />
  )

  return (
    <AppShell
      isMobile={isMobile}
      isSidebarCollapsed={isSidebarCollapsed}
      onCloseSidebar={handleToggleSidebarCollapse}
      sidebar={sidebar}
      mainRef={mainRef}
      hideChrome={hideUi}
      header={
        <ChatHeader
          activeTitle={isNewChat ? 'New conversation' : activeTitle}
          showActiveTitle={isNewChat || hasActiveTitle}
          wrapperRef={headerRef}
          isSidebarCollapsed={isSidebarCollapsed}
          onOpenSidebar={handleOpenSidebar}
          usedTokens={usedTokens}
          maxTokens={
            activeSession?.contextTokens ??
            resolvedConversationModelDetails?.contextWindow
          }
          onToggleRightSidebar={() => setRightSidebarOpen((prev) => !prev)}
          rightSidebarOpen={rightSidebarOpen}
          models={models}
          selectedModelId={resolvedConversationModel}
          defaultModelId={defaultModelId}
          modelsLoading={modelsQuery.isLoading}
          canSelectModel={modelsQuery.data?.capabilities.canSelectModel}
          defaultModelLocked={modelsQuery.data?.capabilities.defaultModelLocked}
          onSelectModel={handleSelectConversationModel}
        />
      }
      rightSidebar={
        hideUi ? null : (
          <RightSidebar
            isOpen={rightSidebarOpen}
            isMobile={isMobile}
            activeTab={rightSidebarTab}
            onTabChange={setRightSidebarTab}
            onClose={() => setRightSidebarOpen(false)}
            onExport={exportConversation}
            exportDisabled={
              isNewChat || historyLoading || displayMessages.length === 0
            }
            sessions={sessions}
            activeSessionKey={activeSessionKey || resolvedSessionKey}
            models={models}
            selectedModelId={resolvedConversationModel}
            defaultModelId={defaultModelId}
            modelsLoading={modelsQuery.isLoading}
            canSelectModel={modelsQuery.data?.capabilities.canSelectModel}
            defaultModelLocked={
              modelsQuery.data?.capabilities.defaultModelLocked
            }
            modelSettings={conversationSettings}
            onModelSettingsChange={updateConversationSettings}
          />
        )
      }
    >
      {hideUi ? null : (
        <>
          <ChatMessageList
            messages={displayMessages}
            loading={historyLoading}
            empty={historyEmpty}
            notice={backendNotice}
            noticePosition="end"
            waitingForResponse={waitingForResponse}
            sessionKey={activeCanonicalKey}
            modelLabelById={modelLabelById}
            pinToTop={pinToTop}
            pinGroupMinHeight={pinGroupMinHeight}
            headerHeight={headerHeight}
            contentStyle={stableContentStyle}
            onClone={handleCloneMessage}
            onEditUserTurn={handleSaveEditedUserTurn}
            onDeleteUserTurn={handleOpenDeleteUserTurn}
            onScrollTopChange={handleScrollTopChange}
            restoreScrollTop={restoreScrollTop}
            restoreKey={activeFriendlyId}
            onRestoreScrollTopApplied={handleRestoreScrollTopApplied}
            showConversationNavigator={
              settings.showConversationNavigator &&
              !isMobile &&
              !rightSidebarOpen
            }
          />
          <ChatComposer
            onSubmit={send}
            onStop={handleStopGeneration}
            isLoading={sending}
            canStop={waitingForResponse && !isNewChat}
            disabled={sending || !hasAvailableModel}
            wrapperRef={composerRef}
            draft={composerDraft}
          />
        </>
      )}

      <UserTurnDeleteDialog
        open={deletingUserTurn !== null}
        onOpenChange={function handleOpenChange(open) {
          if (!open) {
            setDeletingUserTurn(null)
          }
        }}
        messagePreview={deletingUserTurn?.currentText ?? ''}
        onConfirm={handleConfirmDeleteUserTurn}
        onCancel={function handleCancelDelete() {
          setDeletingUserTurn(null)
        }}
      />
    </AppShell>
  )
}
