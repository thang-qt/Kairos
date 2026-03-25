import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'

import { countConversationTokens, isSessionNotFound } from './utils'
import { createOptimisticMessage } from './chat-screen-utils'
import {
  appendHistoryMessage,
  chatQueryKeys,
  clearHistoryMessages,
  fetchChatStatus,
  removeHistoryMessageByClientId,
  updateHistoryMessageByClientId,
  updateSessionLastMessage,
} from './chat-queries'
import { chatUiQueryKey, getChatUiState, setChatUiState } from './chat-ui'
import { ChatSidebar } from './components/chat-sidebar'
import { ChatHeader } from './components/chat-header'
import { ChatMessageList } from './components/chat-message-list'
import { ChatComposer } from './components/chat-composer'
import { BackendStatusMessage } from './components/backend-status-message'
import { MessageStatus } from './components/message-status'
import { UserTurnDeleteDialog } from './components/user-turn-delete-dialog'
import { UserTurnEditDialog } from './components/user-turn-edit-dialog'
import {
  hasPendingGeneration,
  hasPendingSend,
  isRecentSession,
  setPendingGeneration,
  setRecentSession,
  stashPendingSend,
} from './pending-send'
import { useChatMeasurements } from './hooks/use-chat-measurements'
import { useChatHistory } from './hooks/use-chat-history'
import { useChatMobile } from './hooks/use-chat-mobile'
import { useChatSessions } from './hooks/use-chat-sessions'
import { useChatStream } from './hooks/use-chat-stream'
import { useChatPendingSend } from './hooks/use-chat-pending-send'
import { useChatGenerationGuard } from './hooks/use-chat-generation-guard'
import { useChatRedirect } from './hooks/use-chat-redirect'
import {
  copyConversationSettings,
  resolveConversationModelID,
  useConversationSettings,
} from './conversation-settings'
import { RightSidebar } from './components/right-sidebar'
import type { BranchNavigatorState } from './components/branch-inline-navigator'
import type { RightSidebarTab } from './components/right-sidebar'
import type { AttachmentFile } from '@/components/attachment-button'
import type { ChatComposerHelpers } from './components/chat-composer'
import { useExport } from '@/hooks/use-export'
import { useChatSettings } from '@/hooks/use-chat-settings'
import { useModelsQuery } from '@/lib/app-api'
import { getChatBackend } from '@/lib/chat-backend'
import { cn, randomUUID } from '@/lib/utils'

type ChatScreenProps = {
  activeFriendlyId: string
  isNewChat?: boolean
  onSessionResolved?: (payload: {
    sessionKey: string
    friendlyId: string
  }) => void
  forcedSessionKey?: string
}

const BRANCH_SCROLL_RESTORE_KEY = 'kairos.branch-scroll-restore'

type UserTurnActionState = {
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
  const [editingUserTurn, setEditingUserTurn] =
    useState<UserTurnActionState>(null)
  const [deletingUserTurn, setDeletingUserTurn] =
    useState<UserTurnActionState>(null)
  const { headerRef, composerRef, mainRef, pinGroupMinHeight, headerHeight } =
    useChatMeasurements()
  const [waitingForResponse, setWaitingForResponse] = useState(
    () => hasPendingSend() || hasPendingGeneration(),
  )
  const [pinToTop, setPinToTop] = useState(
    () => hasPendingSend() || hasPendingGeneration(),
  )
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
      return model.id === resolvedConversationModel
    },
  )
  const modelLabelById = useMemo(() => {
    const map = new Map<string, string>()
    for (const model of models) {
      const normalizedName = model.name?.trim()
      map.set(model.id, normalizedName || model.id)
    }
    return map
  }, [models])
  const handleSelectConversationModel = useCallback(
    function handleSelectConversationModel(modelId: string) {
      updateConversationSettings({ model: modelId })
    },
    [updateConversationSettings],
  )
  const hasAvailableModel = resolvedConversationModel.trim().length > 0
  const pendingRunIdsRef = useRef(new Set<string>())
  const pendingRunTimersRef = useRef(new Map<string, number>())
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

  const refreshHistory = useCallback(() => {
    void historyQuery.refetch()
  }, [historyQuery])

  const hideUi = shouldRedirectToNew || isRedirecting

  const finishRun = useCallback(function finishRun(runId: string) {
    if (!runId) return
    const timer = pendingRunTimersRef.current.get(runId)
    if (typeof timer === 'number') {
      window.clearTimeout(timer)
    }
    pendingRunTimersRef.current.delete(runId)
    pendingRunIdsRef.current.delete(runId)
    if (pendingRunIdsRef.current.size === 0) {
      setPendingGeneration(false)
      setWaitingForResponse(false)
    }
  }, [])

  const startRun = useCallback(
    function startRun(runId: string) {
      if (!runId) return
      pendingRunIdsRef.current.add(runId)
      const existingTimer = pendingRunTimersRef.current.get(runId)
      if (typeof existingTimer === 'number') {
        window.clearTimeout(existingTimer)
      }
      const timeout = window.setTimeout(() => {
        pendingRunTimersRef.current.delete(runId)
        pendingRunIdsRef.current.delete(runId)
        refreshHistory()
        if (pendingRunIdsRef.current.size === 0) {
          setPendingGeneration(false)
          setWaitingForResponse(false)
        }
      }, 120000)
      pendingRunTimersRef.current.set(runId, timeout)
      setPendingGeneration(true)
      setWaitingForResponse(true)
    },
    [refreshHistory],
  )

  const finishAllRuns = useCallback(function finishAllRuns() {
    for (const [, timer] of pendingRunTimersRef.current) {
      window.clearTimeout(timer)
    }
    pendingRunTimersRef.current.clear()
    pendingRunIdsRef.current.clear()
    setPendingGeneration(false)
    setWaitingForResponse(false)
  }, [])

  useEffect(() => {
    return function cleanupRuns() {
      finishAllRuns()
    }
  }, [finishAllRuns])

  function sendMessage(
    sessionKey: string,
    friendlyId: string,
    body: string,
    skipOptimistic = false,
    modelOverride?: string,
    attachments?: Array<AttachmentFile>,
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

    setPendingGeneration(true)
    setSending(true)
    setStreamError(null)
    setWaitingForResponse(true)
    setPinToTop(true)

    const attachmentsPayload = attachments
      ?.filter((attachment) => Boolean(attachment.base64))
      .map((attachment) => ({
        mimeType: attachment.file.type,
        content: attachment.base64 as string,
      }))

    const backend = getChatBackend()
    const model = modelOverride?.trim() || resolvedConversationModel
    void backend
      .sendMessage({
        sessionKey,
        friendlyId,
        message: body,
        model,
        idempotencyKey: randomUUID(),
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
        void queryClient.invalidateQueries({ queryKey: chatQueryKeys.sessions })
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
        setPendingGeneration(false)
        setWaitingForResponse(false)
        setPinToTop(false)
        setStreamError(
          err instanceof Error ? err.message : 'The model request failed.',
        )
        throw err
      })
      .finally(() => {
        setSending(false)
      })
  }

  const createSessionForMessage = useCallback(async () => {
    setCreatingSession(true)
    try {
      const backend = getChatBackend()
      const { sessionKey, friendlyId } = await backend.createConversation()
      if (!sessionKey || !friendlyId) {
        throw new Error('Invalid conversation response')
      }
      void queryClient.invalidateQueries({ queryKey: chatQueryKeys.sessions })
      return { sessionKey, friendlyId }
    } finally {
      setCreatingSession(false)
    }
  }, [queryClient])

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
        setPendingGeneration(true)
        setSending(true)
        setStreamError(null)
        setWaitingForResponse(true)
        setPinToTop(true)

        createSessionForMessage()
          .then(({ sessionKey, friendlyId }) => {
            copyConversationSettings(activeFriendlyId || 'new', friendlyId)
            setRecentSession(friendlyId)
            stashPendingSend({
              sessionKey,
              friendlyId,
              message: body,
              model: resolvedConversationModel,
              optimisticMessage,
              attachments,
            })
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
            setPendingGeneration(false)
            setWaitingForResponse(false)
            setPinToTop(false)
            setSending(false)
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
        attachments,
      )
    },
    [
      activeFriendlyId,
      activeSessionKey,
      createSessionForMessage,
      forcedSessionKey,
      hasAvailableModel,
      isNewChat,
      navigate,
      onSessionResolved,
      queryClient,
      resolvedSessionKey,
      resolvedConversationModel,
    ],
  )

  const startNewChat = useCallback(() => {
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
        )
      }
    }
  }, [
    activeFriendlyId,
    activeSessionKey,
    displayMessages,
    resolvedConversationModel,
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

  useChatGenerationGuard({
    waitingForResponse,
    refreshHistory,
    setWaitingForResponse,
  })

  useChatPendingSend({
    activeFriendlyId,
    activeSessionKey,
    forcedSessionKey,
    isNewChat,
    queryClient,
    resolvedSessionKey,
    setWaitingForResponse,
    setPinToTop,
    sendMessage,
  })

  const handleForkMessage = useCallback(
    async (messageId: string) => {
      const sourceKey = activeSessionKey || resolvedSessionKey
      if (!sourceKey) return
      try {
        const backend = getChatBackend()
        const result = await backend.forkConversation({
          sourceSessionKey: sourceKey,
          sourceFriendlyId: activeFriendlyId,
          forkAtMessageId: messageId,
        })
        await queryClient.invalidateQueries({
          queryKey: chatQueryKeys.sessions,
        })
        navigate({
          to: '/chat/$sessionKey',
          params: { sessionKey: result.friendlyId },
        })
      } catch (err) {
        console.error('Fork failed:', err)
      }
    },
    [
      activeSessionKey,
      resolvedSessionKey,
      activeFriendlyId,
      queryClient,
      navigate,
    ],
  )

  const storeBranchScrollRestore = useCallback(
    function storeBranchScrollRestore() {
      if (typeof window === 'undefined') return
      window.sessionStorage.setItem(
        BRANCH_SCROLL_RESTORE_KEY,
        JSON.stringify({ scrollTop: scrollTopRef.current }),
      )
    },
    [],
  )

  const handleSelectBranch = useCallback(
    function handleSelectBranch(friendlyId: string) {
      if (!friendlyId || friendlyId === activeFriendlyId) return
      storeBranchScrollRestore()
      navigate({
        to: '/chat/$sessionKey',
        params: { sessionKey: friendlyId },
      })
    },
    [activeFriendlyId, navigate, storeBranchScrollRestore],
  )

  const handleOpenEditUserTurn = useCallback(function handleOpenEditUserTurn(
    messageId: string,
    currentText: string,
  ) {
    setEditingUserTurn({ messageId, currentText })
  }, [])

  const handleOpenDeleteUserTurn = useCallback(
    function handleOpenDeleteUserTurn(messageId: string, currentText: string) {
      setDeletingUserTurn({ messageId, currentText })
    },
    [],
  )

  const handleSaveEditedUserTurn = useCallback(
    async function handleSaveEditedUserTurn(nextMessage: string) {
      const sourceKey = activeSessionKey || resolvedSessionKey
      const target = editingUserTurn
      const normalizedMessage = nextMessage.trim()
      if (!sourceKey || !target || normalizedMessage.length === 0) {
        return
      }

      setEditingUserTurn(null)
      storeBranchScrollRestore()

      try {
        const backend = getChatBackend()
        const result = await backend.editUserMessage({
          sourceSessionKey: sourceKey,
          sourceFriendlyId: activeFriendlyId,
          messageId: target.messageId,
          message: normalizedMessage,
          model: resolvedConversationModel,
        })
        startRun(result.runId)
        await queryClient.invalidateQueries({
          queryKey: chatQueryKeys.sessions,
        })
        navigate({
          to: '/chat/$sessionKey',
          params: { sessionKey: result.friendlyId },
        })
      } catch (err) {
        console.error('Edit user turn failed:', err)
      }
    },
    [
      activeFriendlyId,
      activeSessionKey,
      editingUserTurn,
      navigate,
      queryClient,
      resolvedSessionKey,
      resolvedConversationModel,
      startRun,
      storeBranchScrollRestore,
    ],
  )

  const handleConfirmDeleteUserTurn = useCallback(
    async function handleConfirmDeleteUserTurn() {
      const sourceKey = activeSessionKey || resolvedSessionKey
      const target = deletingUserTurn
      if (!sourceKey || !target) return

      setDeletingUserTurn(null)
      storeBranchScrollRestore()

      try {
        const backend = getChatBackend()
        const result = await backend.deleteUserMessage({
          sourceSessionKey: sourceKey,
          sourceFriendlyId: activeFriendlyId,
          messageId: target.messageId,
        })
        await queryClient.invalidateQueries({
          queryKey: chatQueryKeys.sessions,
        })
        navigate({
          to: '/chat/$sessionKey',
          params: { sessionKey: result.friendlyId },
        })
      } catch (err) {
        console.error('Delete user turn failed:', err)
      }
    },
    [
      activeFriendlyId,
      activeSessionKey,
      deletingUserTurn,
      navigate,
      queryClient,
      resolvedSessionKey,
      storeBranchScrollRestore,
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
    const raw = window.sessionStorage.getItem(BRANCH_SCROLL_RESTORE_KEY)
    if (!raw) return
    window.sessionStorage.removeItem(BRANCH_SCROLL_RESTORE_KEY)
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

  const forkedFrom = useMemo(() => {
    if (!activeSession?.parentSessionKey) return undefined
    const parent = sessions.find(
      (s) =>
        s.key === activeSession.parentSessionKey ||
        s.friendlyId === activeSession.parentFriendlyId,
    )
    if (!parent) {
      return {
        title: 'Original deleted',
        isOrphaned: true,
      }
    }
    return {
      friendlyId: parent.friendlyId,
      title:
        parent.label ||
        parent.title ||
        parent.derivedTitle ||
        parent.friendlyId,
      isOrphaned: false,
    }
  }, [activeSession, sessions])

  const branchNavigators = useMemo(() => {
    const result = new Map<string, BranchNavigatorState>()

    function getSessionTitle(session: (typeof sessions)[number]) {
      return (
        session.label ||
        session.title ||
        session.derivedTitle ||
        session.friendlyId
      )
    }

    function setBranchNavigator(payload: {
      messageId: string
      activeFriendlyId: string
      options: Array<{ friendlyId: string; title: string }>
    }) {
      if (!payload.messageId || payload.options.length < 2) return
      const seen = new Set<string>()
      const options = payload.options.filter((option) => {
        if (!option.friendlyId || seen.has(option.friendlyId)) return false
        seen.add(option.friendlyId)
        return true
      })
      if (options.length < 2) return
      result.set(payload.messageId, {
        messageId: payload.messageId,
        activeFriendlyId: payload.activeFriendlyId,
        options,
      })
    }

    if (activeSession?.parentSessionKey && activeSession.forkPointMessageId) {
      const parent = sessions.find(
        (session) =>
          session.key === activeSession.parentSessionKey ||
          session.friendlyId === activeSession.parentFriendlyId,
      )
      const siblingForks = sessions.filter(
        (session) =>
          session.parentSessionKey === activeSession.parentSessionKey &&
          session.forkPointMessageId === activeSession.forkPointMessageId,
      )
      const options = [
        ...(parent
          ? [
              {
                friendlyId: parent.friendlyId,
                title: getSessionTitle(parent),
              },
            ]
          : []),
        ...siblingForks.map((session) => ({
          friendlyId: session.friendlyId,
          title: getSessionTitle(session),
        })),
      ]
      setBranchNavigator({
        messageId: activeSession.forkPointMessageId,
        activeFriendlyId,
        options,
      })
    }

    if (activeSessionKey) {
      const childrenByPoint = new Map<string, typeof sessions>()
      for (const session of sessions) {
        if (
          session.parentSessionKey !== activeSessionKey ||
          !session.forkPointMessageId
        ) {
          continue
        }
        const siblings = childrenByPoint.get(session.forkPointMessageId) ?? []
        siblings.push(session)
        childrenByPoint.set(session.forkPointMessageId, siblings)
      }

      for (const [messageId, children] of childrenByPoint) {
        setBranchNavigator({
          messageId,
          activeFriendlyId,
          options: [
            {
              friendlyId: activeFriendlyId,
              title: activeTitle,
            },
            ...children.map((session) => ({
              friendlyId: session.friendlyId,
              title: getSessionTitle(session),
            })),
          ],
        })
      }
    }

    return result
  }, [activeFriendlyId, activeSession, activeSessionKey, activeTitle, sessions])

  return (
    <div className="h-screen bg-surface text-primary-900">
      <div
        className={cn(
          'h-full overflow-hidden',
          isMobile ? 'relative' : 'grid grid-cols-[auto_1fr_auto]',
        )}
      >
        {hideUi ? null : isMobile ? (
          <div
            className={cn(
              'fixed inset-y-0 left-0 z-50 w-[300px] transition-transform duration-200',
              isSidebarCollapsed ? '-translate-x-full' : 'translate-x-0',
            )}
          >
            {sidebar}
          </div>
        ) : (
          sidebar
        )}

        <main className="flex h-full min-h-0 flex-col relative" ref={mainRef}>
          <div
            className="absolute top-0 left-0 right-0 z-10 pointer-events-none"
            style={{
              height: 80,
              background:
                'linear-gradient(to bottom, var(--color-surface), transparent)',
            }}
          >
            <div className="pointer-events-auto">
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
                forkedFrom={forkedFrom}
                onToggleRightSidebar={() =>
                  setRightSidebarOpen((prev) => !prev)
                }
                rightSidebarOpen={rightSidebarOpen}
                models={models}
                selectedModelId={resolvedConversationModel}
                defaultModelId={defaultModelId}
                modelsLoading={modelsQuery.isLoading}
                canSelectModel={modelsQuery.data?.capabilities.canSelectModel}
                defaultModelLocked={
                  modelsQuery.data?.capabilities.defaultModelLocked
                }
                onSelectModel={handleSelectConversationModel}
              />
            </div>
          </div>

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
                onFork={handleForkMessage}
                onEditUserTurn={handleOpenEditUserTurn}
                onDeleteUserTurn={handleOpenDeleteUserTurn}
                branchNavigators={branchNavigators}
                onSelectBranch={handleSelectBranch}
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
              />
            </>
          )}
        </main>

        {hideUi ? null : (
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
          />
        )}
        <UserTurnEditDialog
          open={editingUserTurn !== null}
          onOpenChange={function handleOpenChange(open) {
            if (!open) {
              setEditingUserTurn(null)
            }
          }}
          initialMessage={editingUserTurn?.currentText ?? ''}
          onSave={handleSaveEditedUserTurn}
          onCancel={function handleCancelEdit() {
            setEditingUserTurn(null)
          }}
        />
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
      </div>
    </div>
  )
}
