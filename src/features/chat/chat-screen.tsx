import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'

import { countConversationTokens, isSessionNotFound } from './utils'
import {
  chatQueryKeys,
  clearHistoryMessages,
  fetchChatStatus,
} from './chat-queries'
import {
  appShellUiQueryKey,
  getAppShellUiState,
  setAppShellUiState,
} from '@/app/layout/app-shell-ui'
import { ChatSidebar } from './components/chat-sidebar'
import { ChatHeader } from './components/chat-header'
import { ChatMessageList } from './components/chat-message-list'
import { ChatComposer } from './components/chat-composer'
import { BackendStatusMessage } from './components/backend-status-message'
import { MessageStatus } from './components/message-status'
import { UserTurnDeleteDialog } from './components/user-turn-delete-dialog'
import { hasPendingGeneration, isRecentSession } from './pending-send'
import { useChatMeasurements } from './hooks/use-chat-measurements'
import { useChatHistory } from './hooks/use-chat-history'
import { useAppMobile } from '@/app/layout/use-app-mobile'
import { useChatSessions } from './hooks/use-chat-sessions'
import { useChatStream } from './hooks/use-chat-stream'
import { useChatRedirect } from './hooks/use-chat-redirect'
import { useChatRuns } from './hooks/use-chat-runs'
import { useChatRestoration } from './hooks/use-chat-restoration'
import { useChatMutations } from './hooks/use-chat-mutations'
import {
  beginFreshNewChat,
  buildChatRequestAdvancedSettings,
  normalizeConversationTextSetting,
  resolveConversationModelID,
  useConversationSettings,
} from './conversation-settings'
import { RightSidebar } from './components/right-sidebar'
import type { RightSidebarTab } from './components/right-sidebar'
import { AppShell } from '@/components/app-shell'
import { useConversationExport } from '@/features/chat/export/use-conversation-export'
import { useChatSettings } from '@/app/preferences/app-preferences'
import { useModelsQuery } from '@/lib/app-api'
import { providerModelKey } from '@/lib/model-utils'

type ChatScreenProps = {
  activeFriendlyId: string
  isNewChat?: boolean
  onSessionResolved?: (payload: {
    sessionKey: string
    friendlyId: string
  }) => void
  forcedSessionKey?: string
}

export function ChatScreen({
  activeFriendlyId,
  isNewChat = false,
  onSessionResolved,
  forcedSessionKey,
}: ChatScreenProps) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [isRedirecting, setIsRedirecting] = useState(false)
  const [rightSidebarOpen, setRightSidebarOpen] = useState(false)
  const [rightSidebarTab, setRightSidebarTab] =
    useState<RightSidebarTab>('options')
  const { headerRef, composerRef, mainRef, pinGroupMinHeight, headerHeight } =
    useChatMeasurements()
  const [pinToTop, setPinToTop] = useState(() => hasPendingGeneration())
  const { settings } = useChatSettings()
  const modelsQuery = useModelsQuery()
  const { isMobile } = useAppMobile(queryClient)
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
    settings: conversationSettings,
    updateSettings: updateConversationSettings,
  } = useConversationSettings({
    conversationId: isNewChat ? 'new' : activeFriendlyId,
    session: activeSession,
  })
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
  const resolvedWebSearch = conversationSettings.webSearch
  const resolvedMathTools = conversationSettings.mathTools
  const resolvedAdvancedSettings = buildChatRequestAdvancedSettings(
    conversationSettings.advanced,
  )
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

  const { exportConversation } = useConversationExport({
    currentFriendlyId: activeFriendlyId,
    currentSessionKey: sessionKeyForHistory,
    sessionTitle: activeTitle,
  })

  const uiQuery = useQuery({
    queryKey: appShellUiQueryKey,
    queryFn: function readUiState() {
      return getAppShellUiState(queryClient)
    },
    initialData: function initialUiState() {
      return getAppShellUiState(queryClient)
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
    activeRunIds,
    beginGeneration,
    finishAllRuns,
    finishGeneration,
    finishRun,
    reconcileActiveRunIds,
    setWaitingForResponse,
    startRun,
    waitingForResponse,
  } = useChatRuns({ refreshHistory, scopeKey: activeCanonicalKey })

  const {
    restoreScrollTop,
    composerDraft,
    handleScrollTopChange,
    handleRestoreScrollTopApplied,
    storeCloneScrollRestore,
    stashCloneComposerDraft,
  } = useChatRestoration({
    activeFriendlyId,
    isNewChat,
  })

  const {
    sending,
    creatingSession,
    streamError,
    setStreamError,
    deletingUserTurn,
    setDeletingUserTurn,
    hasAvailableModel,
    send,
    handleRetryLastMessage,
    handleStopGeneration,
    handleCloneMessage,
    handleOpenDeleteUserTurn,
    handleSaveEditedUserTurn,
    handleConfirmDeleteUserTurn,
  } = useChatMutations({
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
  })

  useEffect(() => {
    setStreamError(null)
  }, [activeFriendlyId, forcedSessionKey, isNewChat, setStreamError])

  const startNewChat = useCallback(() => {
    setStreamError(null)
    setWaitingForResponse(false)
    setPinToTop(false)
    beginFreshNewChat()
    clearHistoryMessages(queryClient, 'new', 'new')
    navigate({ to: '/new' })
    if (isMobile) {
      setAppShellUiState(queryClient, function collapse(state) {
        return { ...state, isSidebarCollapsed: true }
      })
    }
  }, [isMobile, navigate, queryClient, setStreamError, setWaitingForResponse])

  const handleToggleSidebarCollapse = useCallback(() => {
    setAppShellUiState(queryClient, function toggle(state) {
      return { ...state, isSidebarCollapsed: !state.isSidebarCollapsed }
    })
  }, [queryClient])

  const handleSelectSession = useCallback(() => {
    if (!isMobile) return
    setAppShellUiState(queryClient, function collapse(state) {
      return { ...state, isSidebarCollapsed: true }
    })
  }, [isMobile, queryClient])

  const handleOpenSidebar = useCallback(() => {
    setAppShellUiState(queryClient, function open(state) {
      return { ...state, isSidebarCollapsed: false }
    })
  }, [queryClient])

  const historyLoading = historyQuery.isLoading || isRedirecting
  const showBackendNotice =
    Boolean(backendStatusError) &&
    backendStatusQuery.errorUpdatedAt > backendStatusMountRef.current
  const historyEmpty = !historyLoading && displayMessages.length === 0

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
      if (state === 'reconcile' && Array.isArray(payload.activeRunIds)) {
        reconcileActiveRunIds(payload.activeRunIds)
      }
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
            activeRunIds={activeRunIds}
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
            autoFocus={isNewChat}
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
