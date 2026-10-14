import { HugeiconsIcon } from '@hugeicons/react'
import {
  Logout01Icon,
  PencilEdit02Icon,
  Search01Icon,
  Settings01Icon,
  SidebarLeft01Icon,
} from '@hugeicons/core-free-icons'
import { memo } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import { beginFreshNewChat } from '../conversation-settings'
import { useSidebarActions } from '../hooks/use-sidebar-actions'
import { SessionRenameDialog } from './sidebar/session-rename-dialog'
import { SessionDeleteDialog } from './sidebar/session-delete-dialog'
import { SidebarSessions } from './sidebar/sidebar-sessions'
import { CommandSessionDialog } from './command-session'
import type { SessionMeta } from '../types'
import {
  TooltipContent,
  TooltipProvider,
  TooltipRoot,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { ShortcutHint } from '@/components/shortcut-hint'
import { shortcutTooltip } from '@/lib/shortcuts'
import { Button, buttonVariants } from '@/components/ui/button'
import { KairosIconBig } from '@/components/icons/kairos-icon-big'

type ChatSidebarProps = {
  hasMoreSessions?: boolean
  loadingMoreSessions?: boolean
  sessionLoadError?: string | null
  onLoadMoreSessions?: () => void
  sessions: Array<SessionMeta>
  activeFriendlyId: string
  creatingSession: boolean
  onCreateSession: () => void
  onToggleCollapse: () => void
  onSelectSession?: () => void
  onActiveSessionDelete?: () => void
}

function ChatSidebarComponent({
  hasMoreSessions,
  loadingMoreSessions,
  sessionLoadError,
  onLoadMoreSessions,
  sessions,
  activeFriendlyId,
  creatingSession,
  onCreateSession,
  onToggleCollapse,
  onSelectSession,
  onActiveSessionDelete,
}: ChatSidebarProps) {
  const navigate = useNavigate()
  const {
    renameDialogOpen,
    setRenameDialogOpen,
    renameSessionTitle,
    handleOpenRename,
    handleSaveRename,
    deleteDialogOpen,
    setDeleteDialogOpen,
    deleteSessionTitle,
    handleOpenDelete,
    handleConfirmDelete,
    searchDialogOpen,
    setSearchDialogOpen,
    handleSearchDialogOpenChange,
    handleSearchSelect,
    isLoggingOut,
    handleLogout,
  } = useSidebarActions({
    sessions,
    activeFriendlyId,
    onCreateSession,
    onSelectSession,
    onActiveSessionDelete,
  })

  return (
    <aside className="flex h-full w-full flex-col overflow-hidden bg-primary-100">
      <div className="flex items-center h-12 px-2 justify-between">
        <Link
          to="/new"
          onClick={beginFreshNewChat}
          className={cn(
            buttonVariants({ variant: 'ghost', size: 'sm' }),
            'pl-1.5 justify-start',
          )}
        >
          <KairosIconBig className="size-5 rounded-sm" />
          Kairos
        </Link>
        <TooltipProvider>
          <TooltipRoot>
            <TooltipTrigger
              onClick={onToggleCollapse}
              render={
                <Button size="icon-sm" variant="ghost">
                  <HugeiconsIcon
                    icon={SidebarLeft01Icon}
                    size={20}
                    strokeWidth={1.5}
                  />
                </Button>
              }
            />
            <TooltipContent side="right">
              {shortcutTooltip('Close Sidebar', 'sidebar')}
            </TooltipContent>
          </TooltipRoot>
        </TooltipProvider>
      </div>

      <div className="px-2 mb-4 gap-px flex flex-col">
        <Button
          disabled={creatingSession}
          variant="ghost"
          size="sm"
          onClick={onCreateSession}
          onMouseUp={onSelectSession}
          className="group w-full pl-1.5 justify-start transition-colors duration-0"
        >
          <HugeiconsIcon
            icon={PencilEdit02Icon}
            size={20}
            strokeWidth={1.5}
            className="min-w-5"
          />
          <span className="overflow-hidden whitespace-nowrap">New Session</span>
          <ShortcutHint
            id="newSession"
            className="ms-auto opacity-0 group-hover:opacity-100"
          />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={function handleOpenSearch() {
            setSearchDialogOpen(true)
          }}
          className="group w-full pl-1.5 justify-start transition-colors duration-0"
        >
          <HugeiconsIcon
            icon={Search01Icon}
            size={20}
            strokeWidth={1.5}
            className="min-w-5"
          />
          <span className="overflow-hidden whitespace-nowrap">
            Search sessions
          </span>
          <ShortcutHint
            id="searchSessions"
            className="ms-auto opacity-0 group-hover:opacity-100"
          />
        </Button>
      </div>

      <CommandSessionDialog
        sessions={sessions}
        open={searchDialogOpen}
        onOpenChange={handleSearchDialogOpenChange}
        onSelect={handleSearchSelect}
      />

      <div className="flex-1 min-h-0 overflow-hidden">
        <SidebarSessions
          sessions={sessions}
          hasMore={hasMoreSessions}
          loadingMore={loadingMoreSessions}
          loadError={sessionLoadError}
          onLoadMore={onLoadMoreSessions}
          activeFriendlyId={activeFriendlyId}
          onSelect={onSelectSession}
          onRename={handleOpenRename}
          onDelete={handleOpenDelete}
        />
      </div>

      <div className="px-2 py-3 border-t border-primary-200 bg-primary-100">
        <TooltipProvider>
          <div className="flex w-full items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={function handleOpenSettings() {
                void navigate({ to: '/settings' })
              }}
              className="min-w-0 flex-1 justify-start pl-1.5"
            >
              <HugeiconsIcon
                icon={Settings01Icon}
                size={20}
                strokeWidth={1.5}
                className="min-w-5"
              />
              <span className="overflow-hidden whitespace-nowrap">
                Settings
              </span>
            </Button>

            <TooltipRoot>
              <TooltipTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Log out"
                    disabled={isLoggingOut}
                    onClick={handleLogout}
                    className="text-primary-700 hover:bg-primary-200 hover:text-primary-950"
                  >
                    <HugeiconsIcon
                      icon={Logout01Icon}
                      size={20}
                      strokeWidth={1.5}
                    />
                  </Button>
                }
              />
              <TooltipContent side="top">
                {isLoggingOut ? 'Signing out...' : 'Log out'}
              </TooltipContent>
            </TooltipRoot>
          </div>
        </TooltipProvider>
      </div>

      <SessionRenameDialog
        open={renameDialogOpen}
        onOpenChange={setRenameDialogOpen}
        sessionTitle={renameSessionTitle}
        onSave={handleSaveRename}
        onCancel={function handleCancelRename() {
          setRenameDialogOpen(false)
        }}
      />

      <SessionDeleteDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        sessionTitle={deleteSessionTitle}
        onConfirm={handleConfirmDelete}
        onCancel={function handleCancelDelete() {
          setDeleteDialogOpen(false)
        }}
      />
    </aside>
  )
}

function areSessionsEqual(
  prevSessions: Array<SessionMeta>,
  nextSessions: Array<SessionMeta>,
): boolean {
  if (prevSessions === nextSessions) return true
  if (prevSessions.length !== nextSessions.length) return false
  for (let i = 0; i < prevSessions.length; i += 1) {
    const prev = prevSessions[i]
    const next = nextSessions[i]
    if (prev.key !== next.key) return false
    if (prev.friendlyId !== next.friendlyId) return false
    if (prev.label !== next.label) return false
    if (prev.title !== next.title) return false
    if (prev.derivedTitle !== next.derivedTitle) return false
    if (prev.updatedAt !== next.updatedAt) return false
  }
  return true
}

function areSidebarPropsEqual(
  prevProps: ChatSidebarProps,
  nextProps: ChatSidebarProps,
): boolean {
  if (prevProps.hasMoreSessions !== nextProps.hasMoreSessions) return false
  if (prevProps.loadingMoreSessions !== nextProps.loadingMoreSessions)
    return false
  if (prevProps.sessionLoadError !== nextProps.sessionLoadError) return false
  if (prevProps.onLoadMoreSessions !== nextProps.onLoadMoreSessions)
    return false
  if (prevProps.activeFriendlyId !== nextProps.activeFriendlyId) return false
  if (prevProps.creatingSession !== nextProps.creatingSession) return false
  if (!areSessionsEqual(prevProps.sessions, nextProps.sessions)) return false
  return true
}

const MemoizedChatSidebar = memo(ChatSidebarComponent, areSidebarPropsEqual)

export { MemoizedChatSidebar as ChatSidebar }
