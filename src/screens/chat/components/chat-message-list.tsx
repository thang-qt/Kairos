import {
  memo,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import {
  getGatewayMessageId,
  getToolCallsFromMessage,
  textFromMessage,
} from '../utils'
import { MessageItem } from './message-item'
import { ConversationNavigator } from './conversation-navigator'
import type { GatewayMessage } from '../types'
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
  onClone?: (payload: CloneMessagePayload) => void
  onEditUserTurn?: (
    messageId: string,
    currentText: string,
  ) => void | Promise<void>
  onDeleteUserTurn?: (messageId: string, currentText: string) => void
  onScrollTopChange?: (scrollTop: number) => void
  restoreScrollTop?: number | null
  restoreKey?: string
  onRestoreScrollTopApplied?: () => void
  showConversationNavigator?: boolean
}

export type CloneMessagePayload = {
  message: GatewayMessage
  currentText: string
  previousMessageId?: string
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
  onClone,
  onEditUserTurn,
  onDeleteUserTurn,
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
    return (
      message.__optimisticId || getGatewayMessageId(message) || String(index)
    )
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
    const linkedToolCallIds = collectLinkedToolCallIds(messages)
    const nextToolResultsByCallId = new Map<string, GatewayMessage>()

    for (const message of messages) {
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
      if (isLinkedToolResultMessage(message, linkedToolCallIds)) continue

      nextDisplayMessages.push(message)
      const index = nextDisplayMessages.length - 1

      if (message.role === 'user') {
        const messageId = getMessageKey(message, index)
        activeIds.add(messageId)
        getOrCreateUserTurnRef(messageId)
        if (showConversationNavigator) {
          const previewText = textFromMessage(message)
            .replace(/\s+/g, ' ')
            .trim()
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

    for (const existingId of userTurnRefsRef.current.keys()) {
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
    const viewport = viewportNode
    if (!viewport) return

    let firstFrame = 0
    let secondFrame = 0

    function scheduleScroll(applyScroll: () => void) {
      applyScroll()
      if (typeof window === 'undefined') return
      firstFrame = window.requestAnimationFrame(function applyFirstFrame() {
        applyScroll()
        secondFrame = window.requestAnimationFrame(function applySecondFrame() {
          applyScroll()
        })
      })
    }

    const scrollNodeToViewportStart = function scrollNodeToViewportStart(
      node: HTMLElement,
      offset: number,
    ) {
      const viewportRect = viewport.getBoundingClientRect()
      const nodeRect = node.getBoundingClientRect()
      viewport.scrollTop += nodeRect.top - viewportRect.top - offset
    }

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
        const lastUserNode = lastUserRef.current
        scheduleScroll(function scrollLastUserToTop() {
          scrollNodeToViewportStart(lastUserNode, headerHeight)
        })
      }
      return function cleanupScrollFrames() {
        window.cancelAnimationFrame(firstFrame)
        window.cancelAnimationFrame(secondFrame)
      }
    }

    prevPinRef.current = false
    prevUserIndexRef.current = lastUserIndex
    scheduleScroll(function scrollToBottom() {
      viewport.scrollTop = Math.max(
        0,
        viewport.scrollHeight - viewport.clientHeight,
      )
    })
    return function cleanupScrollFrames() {
      window.cancelAnimationFrame(firstFrame)
      window.cancelAnimationFrame(secondFrame)
    }
  }, [
    displayMessages,
    headerHeight,
    lastUserIndex,
    loading,
    pinToTop,
    sessionKey,
    viewportNode,
  ])

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
    const previousMessage = findPreviousClonePoint(displayMessages, index)
    const previousMessageId = previousMessage
      ? (getGatewayMessageId(previousMessage) ?? undefined)
      : undefined

    function handleClone(message: GatewayMessage, currentText: string) {
      onClone?.({ message, currentText, previousMessageId })
    }

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
        onClone={onClone ? handleClone : undefined}
        onEdit={onEditUserTurn}
        onDelete={onDeleteUserTurn}
      />
    )
  }

  const renderedMessages = useMemo(() => {
    const flat = displayMessages.map(
      function renderFlatMessage(chatMessage, index) {
        return renderMessage(chatMessage, index)
      },
    )

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
    displayMessages,
    groupStartIndex,
    hasGroup,
    headerHeight,
    lastAssistantIndex,
    lastUserIndex,
    modelLabelById,
    onClone,
    onDeleteUserTurn,
    onEditUserTurn,
    toolResultsByCallId,
  ])

  const pinnedEndNotice =
    hasGroup && notice && noticePosition === 'end' ? notice : null
  const trailingNotice =
    !hasGroup && notice && noticePosition === 'end' ? notice : null

  return (
    <ChatContainerRoot
      className="flex-1 min-h-0 -mb-4"
      data-scroll-restoration-id="chat-scroll"
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
    prev.onClone === next.onClone &&
    prev.onEditUserTurn === next.onEditUserTurn &&
    prev.onDeleteUserTurn === next.onDeleteUserTurn &&
    prev.onScrollTopChange === next.onScrollTopChange &&
    prev.restoreScrollTop === next.restoreScrollTop &&
    prev.restoreKey === next.restoreKey &&
    prev.onRestoreScrollTopApplied === next.onRestoreScrollTopApplied &&
    prev.showConversationNavigator === next.showConversationNavigator
  )
}

function findPreviousClonePoint(
  messages: Array<GatewayMessage>,
  index: number,
): GatewayMessage | undefined {
  for (let previousIndex = index - 1; previousIndex >= 0; previousIndex -= 1) {
    const message = messages[previousIndex]
    if (message.role === 'toolResult') continue
    if (getGatewayMessageId(message)) return message
  }
  return undefined
}

export function collectLinkedToolCallIds(
  messages: Array<GatewayMessage>,
): Set<string> {
  const linkedToolCallIds = new Set<string>()
  for (const message of messages) {
    if (message.role !== 'assistant') continue
    const toolCalls = getToolCallsFromMessage(message)
    for (const toolCall of toolCalls) {
      const toolCallId =
        typeof toolCall.id === 'string' ? toolCall.id.trim() : ''
      if (!toolCallId) continue
      linkedToolCallIds.add(toolCallId)
    }
  }
  return linkedToolCallIds
}

export function isLinkedToolResultMessage(
  message: GatewayMessage,
  linkedToolCallIds: ReadonlySet<string>,
): boolean {
  if (message.role !== 'toolResult') return false
  const toolCallId =
    typeof message.toolCallId === 'string' ? message.toolCallId.trim() : ''
  return toolCallId.length > 0 && linkedToolCallIds.has(toolCallId)
}

const MemoizedChatMessageList = memo(
  ChatMessageListComponent,
  areChatMessageListEqual,
)

export { MemoizedChatMessageList as ChatMessageList }
