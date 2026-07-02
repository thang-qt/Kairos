import { memo, useState } from 'react'
import {
  getGatewayMessageId,
  getMessageTimestamp,
  getRawMessageTimestamp,
  textFromMessage,
} from '../utils'
import { MessageActionsBar } from './message-actions-bar'
import type {
  GatewayMessage,
  MessageContent as MessageContentPart,
} from '../types'
import { Message, MessageContent } from '@/components/prompt-kit/message'
import { Thinking } from '@/components/prompt-kit/thinking'
import { Tool } from '@/components/prompt-kit/tool'
import { useChatSettingsStore } from '@/hooks/use-chat-settings'
import { cn } from '@/lib/utils'
import { MessageItemEditor } from './message-item-editor'
import { ToolStepItem, ToolSteps } from './tool-steps'
import { useAssistantToolTrace } from './use-assistant-tool-trace'
import {
  mapSearchDetailsToToolPart,
  mapStandaloneToolResultToToolPart,
  mapToolCallToToolPart,
  assistantPartRenderOrder,
  imagesFromMessage,
  modelFromMessage,
  searchDetailsSignature,
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
  message: GatewayMessage
  toolResultsByCallId?: Map<string, GatewayMessage>
  modelLabelById: ReadonlyMap<string, string>
  forceActionsVisible?: boolean
  wrapperRef?: React.RefObject<HTMLDivElement | null>
  wrapperClassName?: string
  wrapperScrollMarginTop?: number
  onClone?: (
    message: GatewayMessage,
    currentText: string,
    previousMessageId?: string,
  ) => void
  previousMessageId?: string
  onEdit?: (messageId: string, currentText: string) => void | Promise<void>
  onDelete?: (messageId: string, currentText: string) => void
}

function MessageItemComponent({
  message,
  toolResultsByCallId,
  modelLabelById,
  forceActionsVisible = false,
  wrapperRef,
  wrapperClassName,
  wrapperScrollMarginTop,
  onClone,
  previousMessageId,
  onEdit,
  onDelete,
}: MessageItemProps) {
  const showReasoningBlocks = useChatSettingsStore(
    (state) => state.settings.showReasoningBlocks,
  )
  const showToolMessages = useChatSettingsStore(
    (state) => state.settings.showToolMessages,
  )
  const role = message.role || 'assistant'
  const text = textFromMessage(message)
  const messageId = getGatewayMessageId(message) ?? ''
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
  const searchToolPart = isAssistant
    ? mapSearchDetailsToToolPart(message)
    : null
  const assistantIsStreaming = Boolean(message.__streamRunId)
  const {
    firstToolPartIndex,
    lastToolPartIndex,
    leadingToolReasoning,
    roundSummaries,
    toolSteps,
  } = useAssistantToolTrace({
    message,
    assistantParts,
    isAssistant,
    assistantIsStreaming,
    searchToolPart,
    toolResultsByCallId,
  })

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

  function renderAssistantPart(part: MessageContentPart, index: number) {
    const shouldCollapseToolTrace = !assistantIsStreaming

    if (part.type === 'thinking') {
      const thinking = String(part.thinking ?? '')
      if (!thinking || !showReasoningBlocks) return null
      // When tool steps/reasoning trace are present, keep reasoning inside the
      // same chain instead of rendering a separate spinning block above it.
      if (
        shouldCollapseToolTrace &&
        (toolSteps.length > 0 || leadingToolReasoning)
      ) {
        return null
      }
      const isThinking = assistantIsStreaming
      return (
        <div key={`thinking-${index}`} className="w-full max-w-[900px]">
          <Thinking content={thinking} isThinking={isThinking} />
        </div>
      )
    }

    if (part.type === 'text') {
      const chunk = String(part.text ?? '')
      if (!chunk.trim()) return null
      // When roundSummaries are present, all inter-round text has already been
      // captured in the summaries and is rendered inside the trace. Only the
      // final response text (after the last tool call) should render standalone.
      if (shouldCollapseToolTrace) {
        if (
          roundSummaries.length > 0 &&
          lastToolPartIndex >= 0 &&
          index <= lastToolPartIndex
        ) {
          return null
        }
        // Pre-tool prose is folded into ToolSteps.leadingReasoning so it stays
        // in the same trace/chain as the tool calls instead of rendering as a
        // separate assistant text block above the chain.
        if (
          leadingToolReasoning &&
          roundSummaries.length === 0 &&
          (firstToolPartIndex === -1 || firstToolPartIndex > index)
        ) {
          return null
        }
      }
      return (
        <Message key={`text-${index}`}>
          <MessageContent
            markdown
            className="text-primary-900 bg-transparent w-full"
          >
            {chunk}
          </MessageContent>
        </Message>
      )
    }

    if (part.type !== 'toolCall') return null
    if (!showToolMessages || shouldCollapseToolTrace) return null

    if (part.name === 'web_search' || part.name === 'web_fetch') {
      return (
        <div key={`web-tool-${index}`} className="w-full max-w-[900px] mt-1">
          <ToolStepItem
            step={{
              kind: 'web',
              key: `web-tool-${part.id || index}`,
              message,
              toolCallIds: part.id ? [part.id] : undefined,
            }}
          />
        </div>
      )
    }

    const resultMessage = part.id
      ? toolResultsByCallId?.get(part.id)
      : undefined
    const toolPart = mapToolCallToToolPart(part, resultMessage, message)
    return (
      <div key={`tool-${index}`} className="w-full max-w-[900px] mt-1">
        <ToolStepItem
          step={{
            kind: 'tool',
            key: `tool-${part.id || index}`,
            toolPart,
          }}
        />
      </div>
    )
  }

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
        'group flex flex-col gap-0.5',
        wrapperClassName,
        isUser ? 'items-end' : 'items-start',
      )}
    >
      {/* Render images if present */}
      {isUser && images.length > 0 && (
        <div className={cn('flex flex-wrap gap-2 mb-2', 'justify-end')}>
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

      {isAssistant && model ? (
        <div className="flex items-center gap-2 text-sm text-primary-800">
          <span className="font-mono font-medium text-primary-900">
            {model}
          </span>
        </div>
      ) : null}

      {isAssistant && showToolMessages && !assistantIsStreaming ? (
        <ToolSteps
          steps={toolSteps}
          running={false}
          roundSummaries={roundSummaries}
          leadingReasoning={showReasoningBlocks ? leadingToolReasoning : ''}
        />
      ) : null}

      {isAssistant && assistantParts.map(renderAssistantPart)}

      {isAssistant && (
        <MessageActionsBar
          text={text}
          timestamp={timestamp}
          align="start"
          forceVisible={forceActionsVisible}
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

function areMessagesEqual(
  prevProps: MessageItemProps,
  nextProps: MessageItemProps,
): boolean {
  if (prevProps.forceActionsVisible !== nextProps.forceActionsVisible) {
    return false
  }
  if (prevProps.wrapperClassName !== nextProps.wrapperClassName) return false
  if (prevProps.wrapperRef !== nextProps.wrapperRef) return false
  if (prevProps.wrapperScrollMarginTop !== nextProps.wrapperScrollMarginTop) {
    return false
  }
  if (prevProps.onClone !== nextProps.onClone) return false
  if (prevProps.previousMessageId !== nextProps.previousMessageId) return false
  if (prevProps.onEdit !== nextProps.onEdit) return false
  if (prevProps.onDelete !== nextProps.onDelete) return false
  if (
    (prevProps.message.role || 'assistant') !==
    (nextProps.message.role || 'assistant')
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
    searchDetailsSignature(prevProps.message) !==
    searchDetailsSignature(nextProps.message)
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
  if (
    JSON.stringify(prevProps.message.details?.roundSummaries) !==
    JSON.stringify(nextProps.message.details?.roundSummaries)
  ) {
    return false
  }
  if (
    runtimeToolDetailsSignature(prevProps.message) !==
    runtimeToolDetailsSignature(nextProps.message)
  ) {
    return false
  }
  return true
}

const MemoizedMessageItem = memo(MessageItemComponent, areMessagesEqual)

export { MemoizedMessageItem as MessageItem }
