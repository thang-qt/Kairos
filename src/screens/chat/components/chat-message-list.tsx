import { memo, useLayoutEffect, useMemo, useRef } from 'react'
import { getToolCallsFromMessage } from '../utils'
import { MessageItem } from './message-item'
import type { GatewayMessage } from '../types'
import type { BranchNavigatorState } from './branch-inline-navigator'
import {
  ChatContainerContent,
  ChatContainerRoot,
  ChatContainerScrollAnchor,
} from '@/components/prompt-kit/chat-container'
import { TypingIndicator } from '@/components/prompt-kit/typing-indicator'
import { useChatSettings } from '@/hooks/use-chat-settings'

type ChatMessageListProps = {
  messages: Array<GatewayMessage>
  loading: boolean
  empty: boolean
  emptyState?: React.ReactNode
  notice?: React.ReactNode
  noticePosition?: 'start' | 'end'
  waitingForResponse: boolean
  sessionKey?: string
  pinToTop: boolean
  pinGroupMinHeight: number
  headerHeight: number
  contentStyle?: React.CSSProperties
  onFork?: (messageId: string) => void
  branchNavigators?: Map<string, BranchNavigatorState>
  onSelectBranch?: (friendlyId: string) => void
  onScrollTopChange?: (scrollTop: number) => void
  restoreScrollTop?: number | null
  restoreKey?: string
  onRestoreScrollTopApplied?: () => void
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
  pinToTop,
  pinGroupMinHeight,
  headerHeight,
  contentStyle,
  onFork,
  branchNavigators,
  onSelectBranch,
  onScrollTopChange,
  restoreScrollTop,
  restoreKey,
  onRestoreScrollTopApplied,
}: ChatMessageListProps) {
  const { settings } = useChatSettings()
  const anchorRef = useRef<HTMLDivElement | null>(null)
  const lastUserRef = useRef<HTMLDivElement | null>(null)
  const prevPinRef = useRef(pinToTop)
  const prevUserIndexRef = useRef<number | undefined>(undefined)
  const pendingRestoreSessionKeyRef = useRef<string | undefined>(undefined)

  if (typeof restoreScrollTop === 'number' && sessionKey) {
    pendingRestoreSessionKeyRef.current = sessionKey
  }

  const linkedToolCallIds = useMemo(() => {
    const ids = new Set<string>()
    for (const message of messages) {
      if (message.role !== 'assistant') continue
      const toolCalls = getToolCallsFromMessage(message)
      for (const toolCall of toolCalls) {
        const toolCallId =
          typeof toolCall.id === 'string' ? toolCall.id.trim() : ''
        if (!toolCallId) continue
        ids.add(toolCallId)
      }
    }
    return ids
  }, [messages])

  const displayMessages = useMemo(() => {
    return messages.filter((msg) => {
      if (msg.role !== 'toolResult') return true
      if (!settings.showToolMessages) return true
      const toolCallId =
        typeof msg.toolCallId === 'string' ? msg.toolCallId.trim() : ''
      if (!toolCallId) return true
      return !linkedToolCallIds.has(toolCallId)
    })
  }, [linkedToolCallIds, messages, settings.showToolMessages])

  const toolResultsByCallId = useMemo(() => {
    const map = new Map<string, GatewayMessage>()
    for (const message of messages) {
      if (message.role !== 'toolResult') continue
      const toolCallId = message.toolCallId
      if (typeof toolCallId === 'string' && toolCallId.trim().length > 0) {
        map.set(toolCallId, message)
      }
    }
    return map
  }, [messages])

  const lastAssistantIndex = displayMessages
    .map((message, index) => ({ message, index }))
    .filter(({ message }) => message.role !== 'user')
    .map(({ index }) => index)
    .pop()
  const lastUserIndex = displayMessages
    .map((message, index) => ({ message, index }))
    .filter(({ message }) => message.role === 'user')
    .map(({ index }) => index)
    .pop()
  const showTypingIndicator =
    waitingForResponse &&
    (typeof lastUserIndex !== 'number' ||
      typeof lastAssistantIndex !== 'number' ||
      lastAssistantIndex < lastUserIndex)
  const groupStartIndex = typeof lastUserIndex === 'number' ? lastUserIndex : -1
  const hasGroup = pinToTop && groupStartIndex >= 0

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
  }, [loading, displayMessages.length, sessionKey, pinToTop, lastUserIndex])

  function renderMessage(
    chatMessage: GatewayMessage,
    index: number,
    options?: {
      wrapperRef?: React.RefObject<HTMLDivElement | null>
      wrapperClassName?: string
      wrapperScrollMarginTop?: number
    },
  ) {
    const messageKey = chatMessage.__optimisticId || (chatMessage as any).id || index
    const forceActionsVisible =
      typeof lastAssistantIndex === 'number' && index === lastAssistantIndex
    const hasToolCalls =
      chatMessage.role === 'assistant' &&
      getToolCallsFromMessage(chatMessage).length > 0

    return (
      <MessageItem
        key={messageKey}
        message={chatMessage}
        toolResultsByCallId={hasToolCalls ? toolResultsByCallId : undefined}
        forceActionsVisible={forceActionsVisible}
        wrapperRef={options?.wrapperRef}
        wrapperClassName={options?.wrapperClassName}
        wrapperScrollMarginTop={options?.wrapperScrollMarginTop}
        onFork={onFork}
        branchState={branchNavigators?.get((chatMessage as any).id)}
        onSelectBranch={onSelectBranch}
      />
    )
  }

  return (
    <ChatContainerRoot
      className="flex-1 min-h-0 -mb-4"
      onUserScroll={onScrollTopChange}
      restoreScrollTop={restoreScrollTop}
      restoreKey={restoreKey}
      onRestoreScrollTopApplied={onRestoreScrollTopApplied}
    >
      <ChatContainerContent
        className="pt-14"
        style={contentStyle}
        wide={settings.wideMode}
      >
        {notice && noticePosition === 'start' ? notice : null}
        {empty && !notice ? (
          emptyState ?? <div aria-hidden></div>
        ) : hasGroup ? (
          <>
            {displayMessages
              .slice(0, groupStartIndex)
              .map((chatMessage, index) => renderMessage(chatMessage, index))}
            <div
              className="flex flex-col space-y-6"
              style={{ minHeight: `${Math.max(0, pinGroupMinHeight - 24)}px` }}
            >
              {displayMessages.slice(groupStartIndex).map((chatMessage, index) => {
                const realIndex = groupStartIndex + index
                const wrapperRef =
                  realIndex === lastUserIndex ? lastUserRef : undefined
                const wrapperClassName =
                  realIndex === lastUserIndex ? 'scroll-mt-0' : undefined
                const wrapperScrollMarginTop =
                  realIndex === lastUserIndex ? headerHeight : undefined
                return renderMessage(chatMessage, realIndex, {
                  wrapperRef,
                  wrapperClassName,
                  wrapperScrollMarginTop,
                })
              })}
              {showTypingIndicator ? (
                <div className="py-2">
                  <TypingIndicator />
                </div>
              ) : null}
            </div>
          </>
        ) : (
          displayMessages.map((chatMessage, index) =>
            renderMessage(chatMessage, index),
          )
        )}
        {notice && noticePosition === 'end' ? notice : null}
        <ChatContainerScrollAnchor
          ref={anchorRef as React.RefObject<HTMLDivElement>}
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
    prev.pinToTop === next.pinToTop &&
    prev.pinGroupMinHeight === next.pinGroupMinHeight &&
    prev.headerHeight === next.headerHeight &&
    prev.contentStyle === next.contentStyle &&
    prev.onFork === next.onFork &&
    prev.branchNavigators === next.branchNavigators &&
    prev.onSelectBranch === next.onSelectBranch &&
    prev.onScrollTopChange === next.onScrollTopChange &&
    prev.restoreScrollTop === next.restoreScrollTop &&
    prev.restoreKey === next.restoreKey &&
    prev.onRestoreScrollTopApplied === next.onRestoreScrollTopApplied
  )
}

const MemoizedChatMessageList = memo(
  ChatMessageListComponent,
  areChatMessageListEqual,
)

export { MemoizedChatMessageList as ChatMessageList }
