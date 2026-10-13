import { memo, useMemo } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import { Cancel01Icon } from '@hugeicons/core-free-icons'
import { AnimatePresence, motion } from 'motion/react'
import type { ConversationTurn } from '../types'
import { useChatSettingsStore } from '@/app/preferences/app-preferences'
import { Button } from '@/components/ui/button'
import { ActivityPart, visibleActivityIndexes } from './activity-part'
import { ElapsedTime } from './elapsed-time'
import { projectConversationTurns } from './chat-message-list-utils'
import {
  activityKeyFromMessage,
  formatActivityDuration,
  isAssistantStreaming,
  splitAssistantActivity,
} from './message-item-utils'

type ActivitySidebarProps = {
  isOpen: boolean
  isMobile?: boolean
  messages: Array<ConversationTurn>
  // Activity key of the turn to show; defaults to the latest turn.
  selectedKey?: string
  mcpToolLabels?: ReadonlyMap<string, string>
  onClose: () => void
}

function ActivitySidebarComponent({
  isOpen,
  isMobile = false,
  messages,
  selectedKey,
  mcpToolLabels,
  onClose,
}: ActivitySidebarProps) {
  const panel = isOpen ? (
    <ActivityContent
      messages={messages}
      selectedKey={selectedKey}
      mcpToolLabels={mcpToolLabels}
      onClose={onClose}
    />
  ) : null

  if (isMobile) {
    return (
      <AnimatePresence initial={false}>
        {isOpen ? (
          <>
            <motion.button
              type="button"
              aria-label="Close activity"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2, ease: 'easeInOut' }}
              onClick={onClose}
              className="fixed inset-0 z-40 bg-primary-950/20 backdrop-blur-sm"
            />
            <motion.aside
              initial={{ x: '100%', opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: '100%', opacity: 0 }}
              transition={{ duration: 0.2, ease: 'easeInOut' }}
              className="fixed inset-y-0 right-0 z-50 flex w-[360px] max-w-[calc(100vw-2rem)] flex-col overflow-hidden bg-primary-100 shadow-xl"
            >
              {panel}
            </motion.aside>
          </>
        ) : null}
      </AnimatePresence>
    )
  }

  return (
    <AnimatePresence initial={false}>
      {isOpen ? (
        <motion.aside
          initial={{ x: '100%' }}
          animate={{ x: 0 }}
          exit={{ x: '100%' }}
          transition={{ duration: 0.2, ease: 'easeOut' }}
          className="absolute inset-y-0 right-0 z-20 flex w-[360px] flex-col overflow-hidden bg-primary-100"
        >
          {panel}
        </motion.aside>
      ) : null}
    </AnimatePresence>
  )
}

function ActivityContent({
  messages,
  selectedKey,
  mcpToolLabels,
  onClose,
}: {
  messages: Array<ConversationTurn>
  selectedKey?: string
  mcpToolLabels?: ReadonlyMap<string, string>
  onClose: () => void
}) {
  const showReasoningBlocks = useChatSettingsStore(
    (state) => state.settings.showReasoningBlocks,
  )
  const showToolMessages = useChatSettingsStore(
    (state) => state.settings.showToolMessages,
  )
  const { toolResultsByCallId } = useMemo(
    () => projectConversationTurns(messages),
    [messages],
  )
  const target = findActivityTarget(
    messages,
    selectedKey,
    showReasoningBlocks,
    showToolMessages,
  )
  const streaming = target ? isAssistantStreaming(target.message) : false
  const parts =
    target && Array.isArray(target.message.content)
      ? target.message.content
      : []
  const stepIndexes = target
    ? visibleActivityIndexes(
        target.message,
        target.activity.activityIndexes,
        streaming,
        toolResultsByCallId,
      )
    : []

  return (
    <>
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-primary-200 pl-4 pr-2">
        <h2 className="flex-1 truncate text-balance text-sm font-medium text-primary-900">
          Activity
        </h2>
        {target ? (
          <span className="shrink-0 text-xs tabular-nums text-primary-500">
            {streaming ? (
              <ElapsedTime startedAt={target.message.timestamp} />
            ) : target.activity.durationMs > 0 ? (
              formatActivityDuration(target.activity.durationMs)
            ) : null}
          </span>
        ) : null}
        <Button
          size="icon-sm"
          variant="ghost"
          onClick={onClose}
          className="text-primary-500 hover:bg-primary-200"
          aria-label="Close activity"
        >
          <HugeiconsIcon icon={Cancel01Icon} size={16} strokeWidth={1.5} />
        </Button>
      </div>
      {target ? (
        <ol className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          {stepIndexes.map(function renderStep(partIndex, order) {
            const isLast = order === stepIndexes.length - 1
            return (
              <ActivityPart
                key={`${partIndex}-${parts[partIndex].type}`}
                part={parts[partIndex]}
                index={partIndex}
                message={target.message}
                streaming={streaming && isLast}
                isLast={isLast}
                toolResultsByCallId={toolResultsByCallId}
                mcpToolLabels={mcpToolLabels}
              />
            )
          })}
        </ol>
      ) : (
        <div className="flex flex-1 items-center justify-center px-6 text-center">
          <p className="text-pretty text-sm text-primary-500">
            This response has no thinking or tool activity to show.
          </p>
        </div>
      )}
    </>
  )
}

function findActivityTarget(
  messages: Array<ConversationTurn>,
  selectedKey: string | undefined,
  showReasoningBlocks: boolean,
  showToolMessages: boolean,
) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message.role !== 'assistant') continue
    if (selectedKey && activityKeyFromMessage(message) !== selectedKey) {
      continue
    }
    const activity = splitAssistantActivity(
      message,
      showReasoningBlocks,
      showToolMessages,
    )
    if (activity.activityIndexes.length === 0) {
      if (selectedKey) return undefined
      continue
    }
    return { message, activity }
  }
  return undefined
}

// Matches the desktop panel width above; AppShell reserves this space.
export const ACTIVITY_SIDEBAR_WIDTH = 360

export const ActivitySidebar = memo(ActivitySidebarComponent)
