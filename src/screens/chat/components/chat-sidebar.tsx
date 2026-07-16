import { HugeiconsIcon } from '@hugeicons/react'
import {
  Logout01Icon,
  PencilEdit02Icon,
  Search01Icon,
  Settings01Icon,
  SidebarLeft01Icon,
} from '@hugeicons/core-free-icons'
import { AnimatePresence, motion } from 'motion/react'
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
import { Button, buttonVariants } from '@/components/ui/button'
import { KairosIconBig } from '@/components/icons/kairos-icon-big'

type ChatSidebarProps = {
  sessions: Array<SessionMeta>
  activeFriendlyId: string
  creatingSession: boolean
  onCreateSession: () => void
  isCollapsed: boolean
  onToggleCollapse: () => void
  onSelectSession?: () => void
  onActiveSessionDelete?: () => void
}

function ChatSidebarComponent({
  sessions,
  activeFriendlyId,
  creatingSession,
  onCreateSession,
  isCollapsed,
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

  const transition = {
    duration: 0.15,
    ease: isCollapsed ? 'easeIn' : 'easeOut',
  } as const

  const asideProps = {
    className:
      'border-r border-primary-200 h-full overflow-hidden bg-primary-100 flex flex-col',
  }

  return (
    <motion.aside
      initial={false}
      animate={{ width: isCollapsed ? 0 : 300 }}
      transition={transition}
      className={asideProps.className}
      style={{ overflow: 'hidden' }}
    >
      <motion.div
        layout
        transition={{ layout: transition }}
        className="flex items-center h-12 px-2 justify-between"
      >
        <AnimatePresence initial={false}>
          {!isCollapsed ? (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={transition}
            >
              <Link
                to="/new"
                onClick={beginFreshNewChat}
                className={cn(
                  buttonVariants({ variant: 'ghost', size: 'sm' }),
                  'w-full pl-1.5 justify-start',
                )}
              >
                <KairosIconBig className="size-5 rounded-sm" />
                Kairos
              </Link>
            </motion.div>
          ) : null}
        </AnimatePresence>
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
              {isCollapsed ? 'Open Sidebar' : 'Close Sidebar'}
            </TooltipContent>
          </TooltipRoot>
        </TooltipProvider>
      </motion.div>

      <div className="px-2 mb-4 gap-px flex flex-col">
        <motion.div
          layout
          transition={{ layout: transition }}
          className="w-full"
        >
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
            <AnimatePresence initial={false} mode="wait">
              {!isCollapsed && (
                <motion.span
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={transition}
                  className="overflow-hidden whitespace-nowrap"
                >
                  New Session
                </motion.span>
              )}
            </AnimatePresence>
            {!isCollapsed ? (
              <span className="ms-auto inline-flex items-center gap-1 text-[14px] text-primary-600 opacity-0 transition-none group-hover:opacity-100">
                <kbd className="font-sans">⇧</kbd>
                <kbd className="font-sans">⌘</kbd>
                <kbd className="font-sans">O</kbd>
              </span>
            ) : null}
          </Button>
        </motion.div>
        <motion.div
          layout
          transition={{ layout: transition }}
          className="w-full"
        >
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
            <AnimatePresence initial={false} mode="wait">
              {!isCollapsed && (
                <motion.span
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={transition}
                  className="overflow-hidden whitespace-nowrap"
                >
                  Search sessions
                </motion.span>
              )}
            </AnimatePresence>
            {!isCollapsed ? (
              <span className="ms-auto inline-flex items-center gap-1 text-[14px] text-primary-600 opacity-0 transition-none group-hover:opacity-100">
                <kbd className="font-sans">⌘</kbd>
                <kbd className="font-sans">K</kbd>
              </span>
            ) : null}
          </Button>
        </motion.div>
      </div>

      <CommandSessionDialog
        sessions={sessions}
        open={searchDialogOpen}
        onOpenChange={handleSearchDialogOpenChange}
        onSelect={handleSearchSelect}
      />

      <div className="flex-1 min-h-0 overflow-hidden">
        <motion.div
          key="content"
          initial={false}
          animate={{
            opacity: isCollapsed ? 0 : 1,
            visibility: isCollapsed ? 'hidden' : 'visible',
          }}
          transition={transition}
          aria-hidden={isCollapsed}
          className={cn(
            'pt-0 flex flex-col w-full min-h-0 h-full',
            isCollapsed && 'pointer-events-none',
          )}
        >
          <div className="flex-1 min-h-0">
            <SidebarSessions
              sessions={sessions}
              activeFriendlyId={activeFriendlyId}
              onSelect={onSelectSession}
              onRename={handleOpenRename}
              onDelete={handleOpenDelete}
            />
          </div>
        </motion.div>
      </div>

      <div className="px-2 py-3 border-t border-primary-200 bg-primary-100">
        <TooltipProvider>
          <motion.div
            layout
            transition={{ layout: transition }}
            className="flex w-full items-center gap-1"
          >
            <Button
              variant="ghost"
              size="sm"
              onClick={function handleOpenSettings() {
                void navigate({ to: '/settings' })
              }}
              title={isCollapsed ? 'Settings' : undefined}
              className="min-w-0 flex-1 justify-start pl-1.5"
            >
              <HugeiconsIcon
                icon={Settings01Icon}
                size={20}
                strokeWidth={1.5}
                className="min-w-5"
              />
              <AnimatePresence initial={false} mode="wait">
                {!isCollapsed && (
                  <motion.span
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={transition}
                    className="overflow-hidden whitespace-nowrap"
                  >
                    Settings
                  </motion.span>
                )}
              </AnimatePresence>
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
          </motion.div>
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
    </motion.aside>
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
  if (prevProps.activeFriendlyId !== nextProps.activeFriendlyId) return false
  if (prevProps.creatingSession !== nextProps.creatingSession) return false
  if (prevProps.isCollapsed !== nextProps.isCollapsed) return false
  if (!areSessionsEqual(prevProps.sessions, nextProps.sessions)) return false
  return true
}

const MemoizedChatSidebar = memo(ChatSidebarComponent, areSidebarPropsEqual)

export { MemoizedChatSidebar as ChatSidebar }
