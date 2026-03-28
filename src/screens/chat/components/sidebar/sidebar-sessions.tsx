'use client'

import { HugeiconsIcon } from '@hugeicons/react'
import { ArrowRight01Icon } from '@hugeicons/core-free-icons'
import { memo, useCallback, useMemo } from 'react'
import { usePinSession } from '../../hooks/use-pin-session'
import { SessionItem } from './session-item'
import type { SessionMeta } from '../../types'
import { useChatSettingsStore } from '@/hooks/use-chat-settings'
import {
  Collapsible,
  CollapsiblePanel,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import {
  ScrollAreaRoot,
  ScrollAreaScrollbar,
  ScrollAreaThumb,
  ScrollAreaViewport,
} from '@/components/ui/scroll-area'

type SidebarSessionsProps = {
  sessions: Array<SessionMeta>
  activeFriendlyId: string
  defaultOpen?: boolean
  onSelect?: () => void
  onRename: (session: SessionMeta) => void
  onDelete: (session: SessionMeta) => void
}

type SessionGroup = {
  id: string
  label: string
  sessions: Array<SessionMeta>
}

type GroupedSessions = {
  pinned: Array<SessionMeta>
  unpinned: Array<SessionGroup>
}

export const SidebarSessions = memo(function SidebarSessions({
  sessions,
  activeFriendlyId,
  defaultOpen = true,
  onSelect,
  onRename,
  onDelete,
}: SidebarSessionsProps) {
  const { pinSession } = usePinSession()
  const showSidebarSectionCounts = useChatSettingsStore(
    (state) => state.settings.showSidebarSectionCounts,
  )

  const groupedSessions = useMemo(
    function groupSessions() {
      return buildSessionGroups(sessions)
    },
    [sessions],
  )

  const handleTogglePin = useCallback(
    function handleTogglePin(session: SessionMeta) {
      void pinSession({
        sessionKey: session.key,
        friendlyId: session.friendlyId,
        isPinned: session.isPinned !== true,
      })
    },
    [pinSession],
  )

  return (
    <div className="flex h-full flex-1 min-h-0 w-full flex-col">
      <ScrollAreaRoot className="flex-1 min-h-0">
        <ScrollAreaViewport className="min-h-0">
          <div className="flex flex-col gap-2 px-2">
            {groupedSessions.pinned.length > 0 ? (
              <SessionSection
                label="Pinned"
                defaultOpen={defaultOpen}
                count={groupedSessions.pinned.length}
                showCount={showSidebarSectionCounts}
              >
                {groupedSessions.pinned.map(function renderPinnedSession(session) {
                  return (
                    <SessionItem
                      key={session.key}
                      session={session}
                      active={session.friendlyId === activeFriendlyId}
                      isPinned
                      onSelect={onSelect}
                      onTogglePin={handleTogglePin}
                      onRename={onRename}
                      onDelete={onDelete}
                    />
                  )
                })}
              </SessionSection>
            ) : null}

            {groupedSessions.unpinned.map(function renderGroup(group) {
              return (
                <SessionSection
                  key={group.id}
                  label={group.label}
                  defaultOpen={defaultOpen}
                  count={group.sessions.length}
                  showCount={showSidebarSectionCounts}
                >
                  {group.sessions.map(function renderSession(session) {
                    return (
                      <SessionItem
                        key={session.key}
                        session={session}
                        active={session.friendlyId === activeFriendlyId}
                        isPinned={false}
                        onSelect={onSelect}
                        onTogglePin={handleTogglePin}
                        onRename={onRename}
                        onDelete={onDelete}
                      />
                    )
                  })}
                </SessionSection>
              )
            })}
          </div>
        </ScrollAreaViewport>
        <ScrollAreaScrollbar orientation="vertical">
          <ScrollAreaThumb />
        </ScrollAreaScrollbar>
      </ScrollAreaRoot>
    </div>
  )
}, areSidebarSessionsEqual)

function areSidebarSessionsEqual(
  prev: SidebarSessionsProps,
  next: SidebarSessionsProps,
) {
  if (prev.activeFriendlyId !== next.activeFriendlyId) return false
  if (prev.defaultOpen !== next.defaultOpen) return false
  if (prev.onSelect !== next.onSelect) return false
  if (prev.onRename !== next.onRename) return false
  if (prev.onDelete !== next.onDelete) return false
  if (prev.sessions === next.sessions) return true
  if (prev.sessions.length !== next.sessions.length) return false
  for (let i = 0; i < prev.sessions.length; i += 1) {
    const prevSession = prev.sessions[i]
    const nextSession = next.sessions[i]
    if (prevSession.key !== nextSession.key) return false
    if (prevSession.friendlyId !== nextSession.friendlyId) return false
    if (prevSession.label !== nextSession.label) return false
    if (prevSession.title !== nextSession.title) return false
    if (prevSession.derivedTitle !== nextSession.derivedTitle) return false
    if (prevSession.isPinned !== nextSession.isPinned) return false
    if (prevSession.updatedAt !== nextSession.updatedAt) return false
  }
  return true
}

function SessionSection({
  label,
  defaultOpen,
  count,
  showCount,
  children,
}: {
  label: string
  defaultOpen: boolean
  count: number
  showCount: boolean
  children: React.ReactNode
}) {
  return (
    <Collapsible
      className="flex w-full flex-col"
      defaultOpen={defaultOpen}
    >
      <CollapsibleTrigger className="ml-0 flex h-8 w-full items-center justify-between rounded-lg pl-1.5 pr-1.5 text-left text-sm text-primary-700 hover:bg-primary-200">
        <span className="truncate">{label}</span>
        <span className="inline-flex items-center gap-1 text-primary-500 tabular-nums">
          {showCount ? <span>{count}</span> : null}
          <HugeiconsIcon
            icon={ArrowRight01Icon}
            className="size-3 transition-transform duration-150 group-data-panel-open:rotate-90"
          />
        </span>
      </CollapsibleTrigger>
      <CollapsiblePanel
        className="w-full data-starting-style:h-0 data-ending-style:h-0"
        contentClassName="flex flex-col overflow-hidden"
      >
        <div className="flex flex-col gap-px pt-1">{children}</div>
      </CollapsiblePanel>
    </Collapsible>
  )
}

function buildSessionGroups(sessions: Array<SessionMeta>): GroupedSessions {
  const now = new Date()
  const startOfToday = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
  ).getTime()
  const oneDayInMs = 24 * 60 * 60 * 1000
  const startOfYesterday = startOfToday - oneDayInMs
  const startOfLast7Days = startOfToday - oneDayInMs * 7
  const startOfLast30Days = startOfToday - oneDayInMs * 30

  const grouped = {
    pinned: [] as Array<SessionMeta>,
    today: [] as Array<SessionMeta>,
    yesterday: [] as Array<SessionMeta>,
    last7Days: [] as Array<SessionMeta>,
    last30Days: [] as Array<SessionMeta>,
    older: [] as Array<SessionMeta>,
  }

  for (const session of sessions) {
    if (session.isPinned === true) {
      grouped.pinned.push(session)
      continue
    }

    const updatedAt = normalizeUpdatedAt(session.updatedAt)
    if (updatedAt >= startOfToday) {
      grouped.today.push(session)
      continue
    }
    if (updatedAt >= startOfYesterday) {
      grouped.yesterday.push(session)
      continue
    }
    if (updatedAt >= startOfLast7Days) {
      grouped.last7Days.push(session)
      continue
    }
    if (updatedAt >= startOfLast30Days) {
      grouped.last30Days.push(session)
      continue
    }
    grouped.older.push(session)
  }

  return {
    pinned: grouped.pinned,
    unpinned: [
      createSessionGroup('today', 'Today', grouped.today),
      createSessionGroup('yesterday', 'Yesterday', grouped.yesterday),
      createSessionGroup('last-7-days', 'Last 7 Days', grouped.last7Days),
      createSessionGroup('last-30-days', 'Last 30 Days', grouped.last30Days),
      createSessionGroup('older', 'Older', grouped.older),
    ].filter((group): group is SessionGroup => group !== null),
  }
}

function createSessionGroup(
  id: string,
  label: string,
  sessions: Array<SessionMeta>,
): SessionGroup | null {
  if (sessions.length === 0) return null
  return {
    id,
    label,
    sessions,
  }
}

function normalizeUpdatedAt(updatedAt: number | undefined): number {
  if (typeof updatedAt === 'number' && Number.isFinite(updatedAt)) {
    return updatedAt
  }
  return 0
}
