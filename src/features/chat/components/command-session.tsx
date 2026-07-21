'use client'

import { Fragment, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { HugeiconsIcon } from '@hugeicons/react'
import { ArrowDown01Icon, ArrowUp01Icon } from '@hugeicons/core-free-icons'
import {
  Command,
  CommandCollection,
  CommandDialog,
  CommandDialogPopup,
  CommandFooter,
  CommandGroup,
  CommandGroupLabel,
  CommandInput,
  CommandItem,
  CommandList,
  CommandPanel,
  CommandSeparator,
} from '@/components/ui/command'
import { fetchSessionSearch, chatQueryKeys } from '../chat-queries'

type CommandSession = {
  key: string
  friendlyId: string
  label?: string
  title?: string
  derivedTitle?: string
  messageId?: string
  snippet?: string
}

type CommandSessionItem = {
  value: string
  label: string
  friendlyId: string
  session: CommandSession
}

type CommandSessionGroup = {
  value: string
  items: Array<CommandSessionItem>
}

type CommandSessionProps = {
  sessions: Array<CommandSession>
  open: boolean
  onOpenChange: (open: boolean) => void
  onSelect: (session: CommandSession) => void
}

function getSessionLabel(session: CommandSession) {
  return (
    session.label || session.title || session.derivedTitle || session.friendlyId
  )
}

function getSessionItemValue(session: CommandSession) {
  return session.messageId ? `${session.key}:${session.messageId}` : session.key
}

function getSearchTokens(query: string) {
  return Array.from(
    new Set(query.match(/[\p{L}\p{N}]+/gu)?.filter(Boolean) ?? []),
  )
}

function highlightSearchMatches(
  value: string,
  query: string,
): Array<ReactNode> {
  const tokens = getSearchTokens(query)
  if (tokens.length === 0) return [value]

  const expression = new RegExp(
    `(${tokens
      .sort(function sortLongestToken(first, second) {
        return second.length - first.length
      })
      .map(function escapeToken(token) {
        return token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      })
      .join('|')})`,
    'iu',
  )

  return value.split(expression).map(function renderPart(part, index) {
    if (part !== '' && expression.test(part)) {
      return (
        <mark
          key={index}
          className="bg-primary-100 font-medium text-primary-900"
        >
          {part}
        </mark>
      )
    }
    return part
  })
}

function CommandSessionDialog({
  sessions,
  open,
  onOpenChange,
  onSelect,
}: CommandSessionProps) {
  const [value, setValue] = useState('')
  const query = value.trim()
  const sessionSearchQuery = useQuery({
    queryKey: chatQueryKeys.sessionSearchResults(query),
    queryFn: function searchSessions({ signal }) {
      return fetchSessionSearch(query, signal)
    },
    enabled: query !== '',
    staleTime: 1000 * 60 * 5,
  })

  const groupedItems = useMemo<Array<CommandSessionGroup>>(() => {
    return [
      {
        value: 'Sessions',
        items: sessions.map((session) => ({
          value: getSessionItemValue(session),
          label: getSessionLabel(session),
          friendlyId: session.friendlyId,
          session,
        })),
      },
    ]
  }, [sessions])

  const searchGroups = useMemo<Array<CommandSessionGroup>>(() => {
    if (!query) return groupedItems

    const results = (sessionSearchQuery.data ?? []).map(
      function mapSearchSession(session) {
        return {
          value: getSessionItemValue(session),
          label: getSessionLabel(session),
          friendlyId: session.friendlyId,
          session,
        }
      },
    )

    return [
      {
        value: 'Search results',
        items: results,
      },
    ]
  }, [groupedItems, query, sessionSearchQuery.data])

  const isSearching = query !== '' && sessionSearchQuery.isPending
  const hasSearchError = query !== '' && sessionSearchQuery.isError
  const isEmpty =
    !isSearching && !hasSearchError && searchGroups[0]?.items.length === 0

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandDialogPopup className="mx-auto self-center">
        <Command
          items={searchGroups}
          value={value}
          onValueChange={setValue}
          mode="none"
        >
          <CommandInput placeholder="Search sessions" />
          <CommandPanel className="flex min-h-0 flex-1 flex-col">
            {isSearching ? (
              <div className="h-72 min-h-0 flex items-center justify-center text-sm text-primary-600">
                Searching sessions...
              </div>
            ) : hasSearchError ? (
              <div className="h-72 min-h-0 flex items-center justify-center text-sm text-primary-600">
                Couldn&apos;t search sessions. Try again.
              </div>
            ) : isEmpty ? (
              <div className="h-72 min-h-0 flex items-center justify-center text-sm text-primary-600">
                No sessions found.
              </div>
            ) : (
              <CommandList className="h-72 min-h-0">
                {searchGroups.map((group, index) => (
                  <Fragment key={`${group.value}-${index}`}>
                    <CommandGroup items={group.items}>
                      <CommandGroupLabel>{group.value}</CommandGroupLabel>
                      <CommandCollection>
                        {(item) => (
                          <CommandItem
                            key={item.value}
                            value={item.value}
                            onClick={() => onSelect(item.session)}
                            className="gap-2"
                          >
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-sm font-medium">
                                {highlightSearchMatches(item.label, query)}
                              </span>
                              {item.session.messageId &&
                              item.session.snippet ? (
                                <span className="block text-xs text-primary-600 line-clamp-1">
                                  {highlightSearchMatches(
                                    item.session.snippet,
                                    query,
                                  )}
                                </span>
                              ) : null}
                            </span>
                          </CommandItem>
                        )}
                      </CommandCollection>
                    </CommandGroup>
                    {index < searchGroups.length - 1 ? (
                      <CommandSeparator />
                    ) : null}
                  </Fragment>
                ))}
              </CommandList>
            )}
          </CommandPanel>
          <CommandFooter>
            <div className="flex items-center gap-4 text-primary-700">
              <div className="flex items-center gap-2">
                <span className="inline-flex items-center gap-1 rounded-md border border-primary-200 bg-surface px-2 py-1 text-[11px] font-medium text-primary-700">
                  <HugeiconsIcon
                    icon={ArrowUp01Icon}
                    size={14}
                    strokeWidth={1.5}
                  />
                  <HugeiconsIcon
                    icon={ArrowDown01Icon}
                    size={14}
                    strokeWidth={1.5}
                  />
                </span>
                <span>Navigate</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="rounded-md border border-primary-200 bg-surface px-2 py-1 text-[11px] font-medium text-primary-700">
                  Enter
                </span>
                <span>Open</span>
              </div>
            </div>
            <div className="flex items-center gap-2 text-primary-700">
              <span className="rounded-md border border-primary-200 bg-surface px-2 py-1 text-[11px] font-medium text-primary-700">
                Esc
              </span>
              <span>Close</span>
            </div>
          </CommandFooter>
        </Command>
      </CommandDialogPopup>
    </CommandDialog>
  )
}

export { CommandSessionDialog }
