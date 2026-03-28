import {
  memo,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { getToolCallsFromMessage, textFromMessage } from '../utils'
import { MessageItem } from './message-item'
import { ConversationNavigator } from './conversation-navigator'
import type { GatewayMessage } from '../types'
import type { BranchNavigatorState } from './branch-inline-navigator'
import {
  ChatContainerContent,
  ChatContainerRoot,
  ChatContainerScrollAnchor,
} from '@/components/prompt-kit/chat-container'
import { TypingIndicator } from '@/components/prompt-kit/typing-indicator'
import { useChatSettingsStore } from '@/hooks/use-chat-settings'

type ChatMessageListProps = {
  messages: Array<GatewayMessage>
  loading: boolean
  empty: boolean
  emptyState?: React.ReactNode
  notice?: React.ReactNode
  noticePosition?: 'start' | 'end'
  waitingForResponse: boolean
  sessionKey?: string
  modelLabelById: ReadonlyMap<string, string>
  pinToTop: boolean
  pinGroupMinHeight: number
  headerHeight: number
  contentStyle?: React.CSSProperties
  onFork?: (messageId: string) => void
  onEditUserTurn?: (messageId: string, currentText: string) => void
  onDeleteUserTurn?: (messageId: string, currentText: string) => void
  branchNavigators?: Map<string, BranchNavigatorState>
  onSelectBranch?: (friendlyId: string) => void
  onScrollTopChange?: (scrollTop: number) => void
  restoreScrollTop?: number | null
  restoreKey?: string
  onRestoreScrollTopApplied?: () => void
  showConversationNavigator?: boolean
}

function ChatMessageListComponent({
  messages,
  loading,
  empty,
  emptyState,
  notice,
  noticePosition = 'start',
  waitingForResponse,
  sessionKey,
  modelLabelById,
  pinToTop,
  pinGroupMinHeight,
  headerHeight,
  contentStyle,
  onFork,
  onEditUserTurn,
  onDeleteUserTurn,
  branchNavigators,
  onSelectBranch,
  onScrollTopChange,
  restoreScrollTop,
  restoreKey,
  onRestoreScrollTopApplied,
  showConversationNavigator = false,
}: ChatMessageListProps) {
  const showToolMessages = useChatSettingsStore(
    (state) => state.settings.showToolMessages,
  )
  const wideMode = useChatSettingsStore((state) => state.settings.wideMode)
  const anchorRef = useRef<HTMLDivElement | null>(null)
  const lastUserRef = useRef<HTMLDivElement | null>(null)
  const [viewportNode, setViewportNode] = useState<HTMLDivElement | null>(null)
  const userTurnRefsRef = useRef(
    new Map<string, React.RefObject<HTMLDivElement | null>>(),
  )
  const prevPinRef = useRef(pinToTop)
  const prevUserIndexRef = useRef<number | undefined>(undefined)
  const pendingRestoreSessionKeyRef = useRef<string | undefined>(undefined)

  if (typeof restoreScrollTop === 'number' && sessionKey) {
    pendingRestoreSessionKeyRef.current = sessionKey
  }

  function getMessageKey(message: GatewayMessage, index: number): string {
    return String(message.__optimisticId || (message as any).id || index)
  }

  function getOrCreateUserTurnRef(messageId: string) {
    const existingRef = userTurnRefsRef.current.get(messageId)
    if (existingRef) return existingRef
    const nextRef = { current: null } as React.RefObject<HTMLDivElement | null>
    userTurnRefsRef.current.set(messageId, nextRef)
    return nextRef
  }

  const {
    displayMessages,
    toolResultsByCallId,
    conversationTurns,
    lastAssistantIndex,
    lastUserIndex,
  } = useMemo(() => {
    const linkedToolCallIds = new Set<string>()
    const nextToolResultsByCallId = new Map<string, GatewayMessage>()

    for (const message of messages) {
      if (message.role === 'assistant') {
        const toolCalls = getToolCallsFromMessage(message)
        for (const toolCall of toolCalls) {
          const toolCallId =
            typeof toolCall.id === 'string' ? toolCall.id.trim() : ''
          if (!toolCallId) continue
          linkedToolCallIds.add(toolCallId)
        }
        continue
      }

      if (message.role !== 'toolResult') continue
      const toolCallId = message.toolCallId
      if (typeof toolCallId === 'string' && toolCallId.trim().length > 0) {
        nextToolResultsByCallId.set(toolCallId, message)
      }
    }

    const nextDisplayMessages: Array<GatewayMessage> = []
    const activeIds = new Set<string>()
    const nextConversationTurns: Array<{ id: string; preview: string }> = []
    let nextLastAssistantIndex: number | undefined
    let nextLastUserIndex: number | undefined

    for (const message of messages) {
      if (message.role === 'toolResult' && showToolMessages) {
        const toolCallId =
          typeof message.toolCallId === 'string' ? message.toolCallId.trim() : ''
        if (toolCallId && linkedToolCallIds.has(toolCallId)) {
          continue
        }
      }

      nextDisplayMessages.push(message)
      const index = nextDisplayMessages.length - 1

      if (message.role === 'user') {
        const messageId = getMessageKey(message, index)
        activeIds.add(messageId)
        getOrCreateUserTurnRef(messageId)
        if (showConversationNavigator) {
          const previewText = textFromMessage(message).replace(/\s+/g, ' ').trim()
          nextConversationTurns.push({
            id: messageId,
            preview: previewText || 'Attachment',
          })
        }
        nextLastUserIndex = index
        continue
      }

      nextLastAssistantIndex = index
    }

    for (const existingId of [...userTurnRefsRef.current.keys()]) {
      if (activeIds.has(existingId)) continue
      userTurnRefsRef.current.delete(existingId)
    }

    return {
      displayMessages: nextDisplayMessages,
      toolResultsByCallId: nextToolResultsByCallId,
      conversationTurns: nextConversationTurns,
      lastAssistantIndex: nextLastAssistantIndex,
      lastUserIndex: nextLastUserIndex,
    }
  }, [messages, showConversationNavigator, showToolMessages])

  const showTypingIndicator =
    waitingForResponse &&
    (typeof lastUserIndex !== 'number' ||
      typeof lastAssistantIndex !== 'number' ||
      lastAssistantIndex < lastUserIndex)
  const groupStartIndex = typeof lastUserIndex === 'number' ? lastUserIndex : -1
  const hasGroup = pinToTop && groupStartIndex >= 0
  const shouldShowConversationNavigator =
    showConversationNavigator && conversationTurns.length >= 2
  const endScrollAnchorStyle = useMemo<React.CSSProperties>(
    function getEndScrollAnchorStyle() {
      return {
        paddingTop:
          'calc(var(--chat-composer-height, 0px) + env(safe-area-inset-bottom, 0px) + 16px)',
      }
    },
    [],
  )

  useLayoutEffect(() => {
    if (typeof lastUserIndex !== 'number') {
      lastUserRef.current = null
      return
    }

    const lastUserMessage = displayMessages[lastUserIndex]
    const messageId = getMessageKey(lastUserMessage, lastUserIndex)
    lastUserRef.current = getOrCreateUserTurnRef(messageId).current
  }, [displayMessages, lastUserIndex])

  const handleViewportNodeChange = useCallback(
    function handleViewportNodeChange(node: HTMLDivElement | null) {
      setViewportNode(node)
    },
    [],
  )

  const getTurnNode = useCallback(function getTurnNode(turnId: string) {
    return userTurnRefsRef.current.get(turnId)?.current ?? null
  }, [])

  useLayoutEffect(() => {
    if (
      pendingRestoreSessionKeyRef.current &&
      pendingRestoreSessionKeyRef.current === sessionKey
    ) {
      pendingRestoreSessionKeyRef.current = undefined
      return
    }

    if (loading) return
    if (pinToTop) {
      const shouldPin =
        !prevPinRef.current || prevUserIndexRef.current !== lastUserIndex
      prevPinRef.current = true
      prevUserIndexRef.current = lastUserIndex
      if (shouldPin && lastUserRef.current) {
        lastUserRef.current.scrollIntoView({ behavior: 'auto', block: 'start' })
      }
      return
    }

    prevPinRef.current = false
    prevUserIndexRef.current = lastUserIndex
    if (anchorRef.current) {
      anchorRef.current.scrollIntoView({ behavior: 'auto', block: 'end' })
    }
  }, [loading, displayMessages, sessionKey, pinToTop, lastUserIndex])

  function renderMessage(
    chatMessage: GatewayMessage,
    index: number,
    options?: {
      wrapperRef?: React.RefObject<HTMLDivElement | null>
      wrapperClassName?: string
      wrapperScrollMarginTop?: number
    },
  ) {
    const messageKey = getMessageKey(chatMessage, index)
    const forceActionsVisible =
      typeof lastAssistantIndex === 'number' && index === lastAssistantIndex
    const hasToolCalls =
      chatMessage.role === 'assistant' &&
      getToolCallsFromMessage(chatMessage).length > 0
    const isUserMessage = chatMessage.role === 'user'
    const wrapperRef = isUserMessage
      ? getOrCreateUserTurnRef(messageKey)
      : options?.wrapperRef
    const wrapperScrollMarginTop = isUserMessage
      ? headerHeight + 12
      : options?.wrapperScrollMarginTop

    return (
      <MessageItem
        key={messageKey}
        message={chatMessage}
        toolResultsByCallId={hasToolCalls ? toolResultsByCallId : undefined}
        forceActionsVisible={forceActionsVisible}
        modelLabelById={modelLabelById}
        wrapperRef={wrapperRef}
        wrapperClassName={options?.wrapperClassName}
        wrapperScrollMarginTop={wrapperScrollMarginTop}
        onFork={onFork}
        onEdit={onEditUserTurn}
        onDelete={onDeleteUserTurn}
        branchState={branchNavigators?.get((chatMessage as any).id)}
        onSelectBranch={onSelectBranch}
      />
    )
  }

  const renderedMessages = useMemo(() => {
    const flat = displayMessages.map(function renderFlatMessage(chatMessage, index) {
      return renderMessage(chatMessage, index)
    })

    if (!hasGroup) {
      return {
        flat,
        beforeGroup: null,
        group: null,
      }
    }

    return {
      flat,
      beforeGroup: displayMessages
        .slice(0, groupStartIndex)
        .map(function renderLeadingMessage(chatMessage, index) {
          return renderMessage(chatMessage, index)
        }),
      group: displayMessages
        .slice(groupStartIndex)
        .map(function renderGroupedMessage(chatMessage, index) {
          const realIndex = groupStartIndex + index
          const wrapperClassName =
            realIndex === lastUserIndex ? 'scroll-mt-0' : undefined
          const wrapperScrollMarginTop =
            realIndex === lastUserIndex ? headerHeight : undefined
          return renderMessage(chatMessage, realIndex, {
            wrapperClassName,
            wrapperScrollMarginTop,
          })
        }),
    }
  }, [
    branchNavigators,
    displayMessages,
    groupStartIndex,
    hasGroup,
    headerHeight,
    lastAssistantIndex,
    lastUserIndex,
    modelLabelById,
    onDeleteUserTurn,
    onEditUserTurn,
    onFork,
    onSelectBranch,
    toolResultsByCallId,
  ])

  const pinnedEndNotice =
    hasGroup && notice && noticePosition === 'end' ? notice : null
  const trailingNotice = !hasGroup && notice && noticePosition === 'end'
    ? notice
    : null

  return (
    <ChatContainerRoot
      className="flex-1 min-h-0 -mb-4"
      overlay={
        shouldShowConversationNavigator ? (
          <ConversationNavigator
            turns={conversationTurns}
            headerHeight={headerHeight}
            scrollElement={viewportNode}
            getTurnNode={getTurnNode}
          />
        ) : null
      }
      onUserScroll={onScrollTopChange}
      onViewportNodeChange={handleViewportNodeChange}
      restoreScrollTop={restoreScrollTop}
      restoreKey={restoreKey}
      onRestoreScrollTopApplied={onRestoreScrollTopApplied}
    >
      <ChatContainerContent
        className="pt-14"
        style={contentStyle}
        wide={wideMode}
      >
        {notice && noticePosition === 'start' ? notice : null}
        {empty && !notice ? (
          (emptyState ?? <div aria-hidden></div>)
        ) : hasGroup ? (
          <>
            {renderedMessages.beforeGroup}
            <div
              className="flex flex-col space-y-6"
              style={{ minHeight: `${Math.max(0, pinGroupMinHeight - 24)}px` }}
            >
              {renderedMessages.group}
              {showTypingIndicator ? (
                <div className="py-2">
                  <TypingIndicator />
                </div>
              ) : null}
              {pinnedEndNotice}
            </div>
          </>
        ) : (
          renderedMessages.flat
        )}
        {trailingNotice}
        <ChatContainerScrollAnchor
          ref={anchorRef as React.RefObject<HTMLDivElement>}
          style={endScrollAnchorStyle}
        />
      </ChatContainerContent>
    </ChatContainerRoot>
  )
}

function areChatMessageListEqual(
  prev: ChatMessageListProps,
  next: ChatMessageListProps,
) {
  return (
    prev.messages === next.messages &&
    prev.loading === next.loading &&
    prev.empty === next.empty &&
    prev.emptyState === next.emptyState &&
    prev.notice === next.notice &&
    prev.noticePosition === next.noticePosition &&
    prev.waitingForResponse === next.waitingForResponse &&
    prev.sessionKey === next.sessionKey &&
    prev.modelLabelById === next.modelLabelById &&
    prev.pinToTop === next.pinToTop &&
    prev.pinGroupMinHeight === next.pinGroupMinHeight &&
    prev.headerHeight === next.headerHeight &&
    prev.contentStyle === next.contentStyle &&
    prev.onFork === next.onFork &&
    prev.onEditUserTurn === next.onEditUserTurn &&
    prev.onDeleteUserTurn === next.onDeleteUserTurn &&
    prev.branchNavigators === next.branchNavigators &&
    prev.onSelectBranch === next.onSelectBranch &&
    prev.onScrollTopChange === next.onScrollTopChange &&
    prev.restoreScrollTop === next.restoreScrollTop &&
    prev.restoreKey === next.restoreKey &&
    prev.onRestoreScrollTopApplied === next.onRestoreScrollTopApplied &&
    prev.showConversationNavigator === next.showConversationNavigator
  )
}

const MemoizedChatMessageList = memo(
  ChatMessageListComponent,
  areChatMessageListEqual,
)

export { MemoizedChatMessageList as ChatMessageList }
