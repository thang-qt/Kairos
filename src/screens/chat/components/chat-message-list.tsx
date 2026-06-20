import { memo, useCallback, useLayoutEffect, useMemo, useRef } from 'react'
import {
  getGatewayMessageId,
  getToolCallsFromMessage,
  textFromMessage,
} from '../utils'
import { MessageItem } from './message-item'
import { ConversationNavigator } from './conversation-navigator'
import { ShortcutsHelpDialog } from './shortcuts-help-dialog'
import type { GatewayMessage } from '../types'
import {
  ChatContainerContent,
  ChatContainerRoot,
  ChatContainerScrollAnchor,
} from '@/components/prompt-kit/chat-container'
import { TypingIndicator } from '@/components/prompt-kit/typing-indicator'
import { useChatSettingsStore } from '@/hooks/use-chat-settings'
import { useChatScrollControl } from '../hooks/use-chat-scroll-control'
import { useMessageNavigation } from '../hooks/use-message-navigation'
import {
  findPreviousClonePoint,
  collectLinkedToolCallIds,
  isLinkedToolResultMessage,
} from './chat-message-list-utils'

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
  onVisualUiCallback?: (message: string) => void
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
  onVisualUiCallback,
  onScrollTopChange,
  restoreScrollTop,
  restoreKey,
  onRestoreScrollTopApplied,
  showConversationNavigator = false,
}: ChatMessageListProps) {
  const wideMode = useChatSettingsStore((state) => state.settings.wideMode)
  const anchorRef = useRef<HTMLDivElement | null>(null)
  const lastUserRef = useRef<HTMLDivElement | null>(null)
  const responseAfterLastUserRef = useRef<HTMLDivElement | null>(null)
  const userTurnRefsRef = useRef(
    new Map<string, React.RefObject<HTMLDivElement | null>>(),
  )

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

  const { displayMessages, toolResultsByCallId } = useMemo(() => {
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

    for (const message of messages) {
      if (isLinkedToolResultMessage(message, linkedToolCallIds)) continue

      nextDisplayMessages.push(message)
      const index = nextDisplayMessages.length - 1

      if (message.role === 'user') {
        const messageId = getMessageKey(message, index)
        activeIds.add(messageId)
        getOrCreateUserTurnRef(messageId)
      }
    }

    for (const existingId of userTurnRefsRef.current.keys()) {
      if (activeIds.has(existingId)) continue
      userTurnRefsRef.current.delete(existingId)
    }

    return {
      displayMessages: nextDisplayMessages,
      toolResultsByCallId: nextToolResultsByCallId,
    }
  }, [messages])

  const latestUserIndex = useMemo(() => {
    for (let index = displayMessages.length - 1; index >= 0; index -= 1) {
      if (displayMessages[index].role === 'user') return index
    }
    return undefined
  }, [displayMessages])

  const {
    viewportNode,
    handleViewportNodeChange,
    visibleCount,
    pendingRestoreSessionKeyRef,
  } = useChatScrollControl({
    displayMessages,
    loading,
    pinToTop,
    sessionKey,
    headerHeight,
    slicedLastUserIndex: latestUserIndex,
    lastUserRef,
    responseAfterLastUserRef,
  })

  const { shortcutsHelpOpen, setShortcutsHelpOpen } = useMessageNavigation({
    viewportNode,
    headerHeight,
  })

  if (typeof restoreScrollTop === 'number' && sessionKey) {
    pendingRestoreSessionKeyRef.current = sessionKey
  }

  const slicedMessages = useMemo(() => {
    return displayMessages.slice(-visibleCount)
  }, [displayMessages, visibleCount])

  const {
    slicedConversationTurns,
    slicedLastAssistantIndex,
    slicedLastUserIndex,
    slicedResponseAfterLastUserIndex,
  } = useMemo(() => {
    const nextConversationTurns: Array<{ id: string; preview: string }> = []
    let nextLastAssistantIndex: number | undefined
    let nextLastUserIndex: number | undefined
    let nextResponseAfterLastUserIndex: number | undefined

    for (let index = 0; index < slicedMessages.length; index += 1) {
      const message = slicedMessages[index]
      if (message.role === 'user') {
        const messageId = getMessageKey(message, index)
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
        nextResponseAfterLastUserIndex = undefined
        continue
      }
      if (
        typeof nextLastUserIndex === 'number' &&
        typeof nextResponseAfterLastUserIndex !== 'number'
      ) {
        nextResponseAfterLastUserIndex = index
      }
      nextLastAssistantIndex = index
    }

    return {
      slicedConversationTurns: nextConversationTurns,
      slicedLastAssistantIndex: nextLastAssistantIndex,
      slicedLastUserIndex: nextLastUserIndex,
      slicedResponseAfterLastUserIndex: nextResponseAfterLastUserIndex,
    }
  }, [slicedMessages, showConversationNavigator])

  const showTypingIndicator =
    waitingForResponse &&
    (typeof slicedLastUserIndex !== 'number' ||
      typeof slicedLastAssistantIndex !== 'number' ||
      slicedLastAssistantIndex < slicedLastUserIndex)
  const groupStartIndex =
    typeof slicedLastUserIndex === 'number' ? slicedLastUserIndex : -1
  const hasGroup = pinToTop && groupStartIndex >= 0
  const shouldShowConversationNavigator =
    showConversationNavigator && slicedConversationTurns.length >= 2
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
    if (typeof slicedLastUserIndex !== 'number') {
      lastUserRef.current = null
      responseAfterLastUserRef.current = null
      return
    }

    const lastUserMessage = slicedMessages[slicedLastUserIndex]
    const messageId = getMessageKey(lastUserMessage, slicedLastUserIndex)
    lastUserRef.current = getOrCreateUserTurnRef(messageId).current

    if (typeof slicedResponseAfterLastUserIndex !== 'number') {
      responseAfterLastUserRef.current = null
    }
  }, [slicedMessages, slicedLastUserIndex, slicedResponseAfterLastUserIndex])

  const getTurnNode = useCallback(function getTurnNode(turnId: string) {
    return userTurnRefsRef.current.get(turnId)?.current ?? null
  }, [])

  const handleClone = useCallback(
    function handleClone(
      message: GatewayMessage,
      currentText: string,
      previousMessageId?: string,
    ) {
      onClone?.({ message, currentText, previousMessageId })
    },
    [onClone],
  )

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
      typeof slicedLastAssistantIndex === 'number' &&
      index === slicedLastAssistantIndex
    const hasToolCalls =
      chatMessage.role === 'assistant' &&
      getToolCallsFromMessage(chatMessage).length > 0
    const isUserMessage = chatMessage.role === 'user'
    const isResponseAfterLastUser = index === slicedResponseAfterLastUserIndex
    const wrapperRef = isUserMessage
      ? getOrCreateUserTurnRef(messageKey)
      : isResponseAfterLastUser
        ? responseAfterLastUserRef
        : options?.wrapperRef
    const wrapperScrollMarginTop = isUserMessage
      ? headerHeight + 12
      : options?.wrapperScrollMarginTop
    const previousMessage = findPreviousClonePoint(slicedMessages, index)
    const previousMessageId = previousMessage
      ? (getGatewayMessageId(previousMessage) ?? undefined)
      : undefined

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
        previousMessageId={previousMessageId}
        onEdit={onEditUserTurn}
        onDelete={onDeleteUserTurn}
        onVisualUiCallback={onVisualUiCallback}
      />
    )
  }

  const renderedMessages = useMemo(() => {
    const flat = slicedMessages.map(
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
      beforeGroup: slicedMessages
        .slice(0, groupStartIndex)
        .map(function renderLeadingMessage(chatMessage, index) {
          return renderMessage(chatMessage, index)
        }),
      group: slicedMessages
        .slice(groupStartIndex)
        .map(function renderGroupedMessage(chatMessage, index) {
          const realIndex = groupStartIndex + index
          const wrapperClassName =
            realIndex === slicedLastUserIndex ? 'scroll-mt-0' : undefined
          const wrapperScrollMarginTop =
            realIndex === slicedLastUserIndex ? headerHeight : undefined
          return renderMessage(chatMessage, realIndex, {
            wrapperClassName,
            wrapperScrollMarginTop,
          })
        }),
    }
  }, [
    slicedMessages,
    groupStartIndex,
    hasGroup,
    headerHeight,
    slicedLastAssistantIndex,
    slicedLastUserIndex,
    slicedResponseAfterLastUserIndex,
    modelLabelById,
    onClone,
    onDeleteUserTurn,
    onEditUserTurn,
    onVisualUiCallback,
    toolResultsByCallId,
  ])

  const pinnedEndNotice =
    hasGroup && notice && noticePosition === 'end' ? notice : null
  const trailingNotice =
    !hasGroup && notice && noticePosition === 'end' ? notice : null

  return (
    <>
      <ChatContainerRoot
        className="flex-1 min-h-0 -mb-4"
        data-scroll-restoration-id="chat-scroll"
        overlay={
          shouldShowConversationNavigator ? (
            <ConversationNavigator
              turns={slicedConversationTurns}
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
          {visibleCount < displayMessages.length && (
            <div className="flex justify-center py-2 text-xs text-primary-500 font-medium select-none">
              Loading older messages...
            </div>
          )}
          {notice && noticePosition === 'start' ? notice : null}
          {empty && !notice ? (
            (emptyState ?? <div aria-hidden></div>)
          ) : hasGroup ? (
            <>
              {renderedMessages.beforeGroup}
              <div
                className="flex flex-col space-y-6"
                style={{
                  minHeight: `${Math.max(0, pinGroupMinHeight - 24)}px`,
                }}
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
      <ShortcutsHelpDialog
        open={shortcutsHelpOpen}
        onOpenChange={setShortcutsHelpOpen}
      />
    </>
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
    prev.onVisualUiCallback === next.onVisualUiCallback &&
    prev.onScrollTopChange === next.onScrollTopChange &&
    prev.restoreScrollTop === next.restoreScrollTop &&
    prev.restoreKey === next.restoreKey &&
    prev.onRestoreScrollTopApplied === next.onRestoreScrollTopApplied &&
    prev.showConversationNavigator === next.showConversationNavigator
  )
}

export {
  collectLinkedToolCallIds,
  isLinkedToolResultMessage,
} from './chat-message-list-utils'

const MemoizedChatMessageList = memo(
  ChatMessageListComponent,
  areChatMessageListEqual,
)

export { MemoizedChatMessageList as ChatMessageList }
