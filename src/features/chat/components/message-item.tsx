import { memo, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import {
  getTurnId,
  getMessageTimestamp,
  getRawMessageTimestamp,
  textFromMessage,
} from '../utils'
import { MessageActionsBar } from './message-actions-bar'
import { ActivityChip } from './activity-chip'
import { latestActivityLabel } from './activity-part'
import {
  ACTIVITY_COLLAPSE_TRANSITION,
  LiveActivity,
  LiveActivityCollapse,
} from './live-activity'
import { TypingIndicator } from '@/components/prompt-kit/typing-indicator'
import type { ConversationTurn } from '../types'
import { Message, MessageContent } from '@/components/prompt-kit/message'
import { Tool } from '@/components/prompt-kit/tool'
import { useChatSettingsStore } from '@/app/preferences/app-preferences'
import { cn } from '@/lib/utils'
import { MessageItemEditor } from './message-item-editor'
import {
  activityKeyFromMessage,
  isAssistantStreaming,
  isAwaitingFirstOutput,
  showsLiveActivity,
  splitAssistantActivity,
  mapStandaloneToolResultToToolPart,
  assistantPartRenderOrder,
  imagesFromMessage,
  modelFromMessage,
  thinkingFromMessage,
  toolCallsSignature,
  toolResultsSignature,
  toolResultSignature,
  runtimeToolDetailsSignature,
} from './message-item-utils'

export {
  mapStandaloneToolResultToToolPart,
  assistantPartRenderOrder,
  modelFromMessage,
}

type MessageItemProps = {
  message: ConversationTurn
  toolResultsByCallId?: Map<string, ConversationTurn>
  modelLabelById: ReadonlyMap<string, string>
  mcpToolLabels?: ReadonlyMap<string, string>
  forceActionsVisible?: boolean
  isLastUser?: boolean
  showAssistantModel?: boolean
  showAssistantActions?: boolean
  wrapperRef?: React.RefObject<HTMLDivElement | null>
  wrapperClassName?: string
  wrapperScrollMarginTop?: number
  isHighlighted?: boolean
  onClone?: (
    message: ConversationTurn,
    currentText: string,
    previousMessageId?: string,
  ) => void
  previousMessageId?: string
  onEdit?: (messageId: string, currentText: string) => void | Promise<void>
  onDelete?: (messageId: string, currentText: string) => void
  activitySelected?: boolean
  onOpenActivity?: (activityKey: string) => void
}

function MessageItemComponent({
  message,
  toolResultsByCallId,
  modelLabelById,
  mcpToolLabels,
  forceActionsVisible = false,
  isLastUser = false,
  showAssistantModel = true,
  showAssistantActions = true,
  wrapperRef,
  wrapperClassName,
  wrapperScrollMarginTop,
  isHighlighted = false,
  onClone,
  previousMessageId,
  onEdit,
  onDelete,
  activitySelected = false,
  onOpenActivity,
}: MessageItemProps) {
  const showReasoningBlocks = useChatSettingsStore(
    (state) => state.settings.showReasoningBlocks,
  )
  const showToolMessages = useChatSettingsStore(
    (state) => state.settings.showToolMessages,
  )
  const showLiveActivity = useChatSettingsStore(
    (state) => state.settings.showLiveActivity,
  )
  const role = message.role || 'assistant'
  const text = textFromMessage(message)
  const messageId = getTurnId(message) ?? ''
  const [editing, setEditing] = useState(false)
  const [editDraft, setEditDraft] = useState(text)
  const [savingEdit, setSavingEdit] = useState(false)
  const images = imagesFromMessage(message)
  const isUser = role === 'user'
  const isToolResult = role === 'toolResult'
  const isAssistant = role === 'assistant'
  const timestamp = getMessageTimestamp(message)
  const model = modelFromMessage(message, modelLabelById)
  const standaloneToolPart = isToolResult
    ? mapStandaloneToolResultToToolPart(message)
    : null

  const assistantParts = Array.isArray(message.content) ? message.content : []
  const assistantIsStreaming = isAssistantStreaming(message)
  function handleStartEdit() {
    setEditDraft(text)
    setEditing(true)
  }

  function handleCancelEdit() {
    setEditDraft(text)
    setEditing(false)
    setSavingEdit(false)
  }

  async function handleSaveEdit() {
    const normalizedDraft = editDraft.trim()
    if (!onEdit || !messageId || normalizedDraft.length === 0 || savingEdit) {
      return
    }

    setSavingEdit(true)
    try {
      await onEdit(messageId, normalizedDraft)
      setEditing(false)
    } finally {
      setSavingEdit(false)
    }
  }

  const activity = isAssistant
    ? splitAssistantActivity(message, showReasoningBlocks, showToolMessages)
    : null
  const activityKey = activityKeyFromMessage(message)
  const liveActivity = showsLiveActivity(message, activity, showLiveActivity)

  return (
    <div
      ref={wrapperRef}
      data-message-item
      data-message-id={messageId}
      data-message-role={role}
      style={
        typeof wrapperScrollMarginTop === 'number'
          ? {
              scrollMarginTop: `${wrapperScrollMarginTop}px`,
            }
          : undefined
      }
      className={cn(
        'group flex flex-col gap-0.5 rounded-lg transition-colors duration-500',
        wrapperClassName,
        isUser ? 'items-end' : 'items-start',
        isHighlighted && 'bg-primary-100',
      )}
    >
      {/* Render images if present */}
      {images.length > 0 && (
        <div
          className={cn(
            'flex flex-wrap gap-2 mb-2',
            isUser ? 'justify-end' : 'justify-start',
          )}
        >
          {images.map((img, idx) => (
            <img
              key={idx}
              src={`data:${img.source.media_type};base64,${img.source.data}`}
              alt={`Attachment ${idx + 1}`}
              className="max-w-[300px] max-h-[300px] rounded-lg object-cover"
            />
          ))}
        </div>
      )}
      {isUser && editing ? (
        <MessageItemEditor
          editDraft={editDraft}
          onChangeDraft={setEditDraft}
          onCancel={handleCancelEdit}
          onSave={function handleSave() {
            handleSaveEdit().catch(() => {})
          }}
          savingEdit={savingEdit}
        />
      ) : isUser ? (
        <Message className="flex-row-reverse">
          <MessageContent
            markdown={false}
            className={cn(
              'text-primary-900 whitespace-pre-wrap',
              'bg-primary-100 px-4 py-2.5 max-w-[85%]',
            )}
          >
            {text}
          </MessageContent>
        </Message>
      ) : null}

      {isToolResult && showToolMessages && standaloneToolPart && (
        <div className="w-full max-w-[900px] mt-2 flex flex-col gap-3">
          <Tool toolPart={standaloneToolPart} defaultOpen={false} />
        </div>
      )}

      {isAssistant && showAssistantModel && model ? (
        <div className="flex items-center gap-2 text-sm text-primary-800">
          <span className="font-mono font-medium text-primary-900">
            {model}
          </span>
        </div>
      ) : null}

      {/* While live steps are in the chat they stand in for the chip; it
          grows in as they fold away when the turn finishes. */}
      <AnimatePresence initial={false}>
        {activity && activity.activityIndexes.length > 0 && !liveActivity ? (
          <motion.div
            key="activity-chip"
            className="w-full overflow-y-clip"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            transition={ACTIVITY_COLLAPSE_TRANSITION}
          >
            <ActivityChip
              streaming={assistantIsStreaming}
              durationMs={activity.durationMs}
              toolCount={activity.toolCount}
              hasThinking={activity.hasThinking}
              startedAt={message.timestamp}
              latest={
                assistantIsStreaming
                  ? latestActivityLabel(
                      message,
                      activity.activityIndexes,
                      toolResultsByCallId,
                      mcpToolLabels,
                    )
                  : undefined
              }
              selected={activitySelected}
              onOpen={
                onOpenActivity && activityKey
                  ? () => onOpenActivity(activityKey)
                  : undefined
              }
            />
          </motion.div>
        ) : null}
      </AnimatePresence>

      {isAwaitingFirstOutput(message, activity) ? (
        <TypingIndicator className="py-1" />
      ) : null}

      <AnimatePresence initial={false}>
        {liveActivity && activity ? (
          <LiveActivityCollapse key="live-activity">
            <LiveActivity
              message={message}
              activityIndexes={activity.activityIndexes}
              toolResultsByCallId={toolResultsByCallId}
              mcpToolLabels={mcpToolLabels}
            />
          </LiveActivityCollapse>
        ) : null}
      </AnimatePresence>

      {activity
        ? assistantParts.map(function renderAnswerPart(part, index) {
            if (part.type !== 'text' || !activity.answerIndexes.has(index)) {
              return null
            }
            return (
              <Message key={`text-${index}`}>
                <MessageContent
                  markdown
                  blockRemoteImages={Boolean(message.details?.importSource)}
                  className="text-primary-900 bg-transparent w-full"
                >
                  {String(part.text ?? '')}
                </MessageContent>
              </Message>
            )
          })
        : null}

      {isAssistant &&
      ['aborted', 'error', 'interrupted'].includes(message.status ?? '') ? (
        <div className="text-pretty text-xs text-primary-600" role="status">
          {message.status === 'aborted'
            ? 'Cancelled'
            : message.status === 'error'
              ? 'Failed'
              : 'Interrupted'}
          {message.error ? `: ${message.error}` : ''}
        </div>
      ) : null}

      {isAssistant && showAssistantActions && (
        <MessageActionsBar
          text={text}
          timestamp={timestamp}
          align="start"
          forceVisible={forceActionsVisible}
          available={!assistantIsStreaming}
          onClone={
            onClone && messageId
              ? () => onClone(message, text, previousMessageId)
              : undefined
          }
        />
      )}

      {isUser && (
        <MessageActionsBar
          text={text}
          timestamp={timestamp}
          align="end"
          editShortcut={isLastUser}
          forceVisible={forceActionsVisible && !editing}
          onClone={
            onClone && messageId
              ? () => onClone(message, text, previousMessageId)
              : undefined
          }
          onEdit={onEdit && messageId && !editing ? handleStartEdit : undefined}
          onDelete={
            onDelete && messageId && !editing
              ? () => onDelete(messageId, text)
              : undefined
          }
        />
      )}
    </div>
  )
}

export function areMessagesEqual(
  prevProps: MessageItemProps,
  nextProps: MessageItemProps,
): boolean {
  if (prevProps.forceActionsVisible !== nextProps.forceActionsVisible) {
    return false
  }
  if (prevProps.isLastUser !== nextProps.isLastUser) return false
  if (prevProps.showAssistantModel !== nextProps.showAssistantModel) {
    return false
  }
  if (prevProps.showAssistantActions !== nextProps.showAssistantActions) {
    return false
  }
  if (prevProps.wrapperClassName !== nextProps.wrapperClassName) return false
  if (prevProps.wrapperRef !== nextProps.wrapperRef) return false
  if (prevProps.wrapperScrollMarginTop !== nextProps.wrapperScrollMarginTop) {
    return false
  }
  if (prevProps.isHighlighted !== nextProps.isHighlighted) return false
  if (prevProps.onClone !== nextProps.onClone) return false
  if (prevProps.previousMessageId !== nextProps.previousMessageId) return false
  if (prevProps.onEdit !== nextProps.onEdit) return false
  if (prevProps.onDelete !== nextProps.onDelete) return false
  if (prevProps.activitySelected !== nextProps.activitySelected) return false
  if (prevProps.onOpenActivity !== nextProps.onOpenActivity) return false
  if (prevProps.mcpToolLabels !== nextProps.mcpToolLabels) return false
  if (
    (prevProps.message.role || 'assistant') !==
    (nextProps.message.role || 'assistant')
  ) {
    return false
  }
  if (
    Boolean(prevProps.message.__streamRunId) !==
    Boolean(nextProps.message.__streamRunId)
  ) {
    return false
  }
  if (
    textFromMessage(prevProps.message) !== textFromMessage(nextProps.message)
  ) {
    return false
  }
  if (
    thinkingFromMessage(prevProps.message) !==
    thinkingFromMessage(nextProps.message)
  ) {
    return false
  }
  if (
    prevProps.message.status !== nextProps.message.status ||
    prevProps.message.error !== nextProps.message.error ||
    JSON.stringify(prevProps.message.content) !==
      JSON.stringify(nextProps.message.content)
  )
    return false
  if (
    runtimeToolDetailsSignature(prevProps.message) !==
    runtimeToolDetailsSignature(nextProps.message)
  ) {
    return false
  }
  if (
    toolCallsSignature(prevProps.message) !==
    toolCallsSignature(nextProps.message)
  ) {
    return false
  }
  if (
    toolResultsSignature(prevProps.message, prevProps.toolResultsByCallId) !==
    toolResultsSignature(nextProps.message, nextProps.toolResultsByCallId)
  ) {
    return false
  }
  if (
    (prevProps.message.role === 'toolResult' ||
      nextProps.message.role === 'toolResult') &&
    toolResultSignature(prevProps.message) !==
      toolResultSignature(nextProps.message)
  ) {
    return false
  }
  if (
    getRawMessageTimestamp(prevProps.message) !==
    getRawMessageTimestamp(nextProps.message)
  ) {
    return false
  }
  if (prevProps.modelLabelById !== nextProps.modelLabelById) {
    return false
  }
  if (
    modelFromMessage(prevProps.message, prevProps.modelLabelById) !==
    modelFromMessage(nextProps.message, nextProps.modelLabelById)
  ) {
    return false
  }
  // No need to check settings here as the hook will cause a re-render
  // and areMessagesEqual is for props only.
  // However, memo components with hooks will re-render if the hook state changes.
  return true
}

const MemoizedMessageItem = memo(MessageItemComponent, areMessagesEqual)

export { MemoizedMessageItem as MessageItem }
