import { memo, useMemo, useState } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  Cancel01Icon,
  FilterHorizontalIcon,
  GitBranchIcon,
  Pen01Icon,
  PinIcon,
} from '@hugeicons/core-free-icons'
import { AnimatePresence, motion } from 'motion/react'
import {
  resolveConversationModelID,
  useConversationSettings,
} from '../conversation-settings'
import { useRenameSession } from '../hooks/use-rename-session'
import { BranchTreePanel } from './branch-tree-panel'
import { SessionRenameDialog } from './sidebar/session-rename-dialog'
import type { SessionMeta } from '../types'
import { Button } from '@/components/ui/button'
import {
  Command,
  CommandCollection,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
  CommandPanel,
} from '@/components/ui/command'
import { ExportMenu } from '@/components/export-menu'
import { useModelsQuery } from '@/lib/app-api'
import { usePinnedSessions } from '@/hooks/use-pinned-sessions'
import { cn } from '@/lib/utils'
import {
  TooltipContent,
  TooltipProvider,
  TooltipRoot,
  TooltipTrigger,
} from '@/components/ui/tooltip'

type ExportFormat = 'markdown' | 'json' | 'text'

export type RightSidebarTab = 'options' | 'branches'

type RightSidebarProps = {
  isOpen: boolean
  isMobile?: boolean
  activeTab: RightSidebarTab
  onTabChange: (tab: RightSidebarTab) => void
  onClose: () => void
  onExport: (format: ExportFormat) => void
  exportDisabled?: boolean
  conversationId: string
  sessions: Array<SessionMeta>
  activeSessionKey?: string
}

const TABS = [
  {
    id: 'options' as const,
    label: 'Options',
    icon: FilterHorizontalIcon,
  },
  {
    id: 'branches' as const,
    label: 'Branches',
    icon: GitBranchIcon,
  },
]

function PanelSection({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <section className="border-b border-primary-200 px-4 py-4 last:border-b-0">
      <h3 className="mb-3 text-xs text-primary-500">{title}</h3>
      <div className="space-y-3">{children}</div>
    </section>
  )
}

function SettingsRow({
  label,
  description,
  children,
}: {
  label: string
  description?: string
  children: React.ReactNode
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm text-primary-800">{label}</div>
        {description ? (
          <div className="text-xs text-primary-500">{description}</div>
        ) : null}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}

function SidebarTabs({
  activeTab,
  onTabChange,
}: {
  activeTab: RightSidebarTab
  onTabChange: (tab: RightSidebarTab) => void
}) {
  return (
    <div className="flex items-center gap-1">
      {TABS.map((tab) => (
        <TooltipProvider key={tab.id}>
          <TooltipRoot>
            <TooltipTrigger
              type="button"
              onClick={() => onTabChange(tab.id)}
              className={cn(
                'inline-flex size-8 items-center justify-center rounded-md text-primary-600 transition-colors hover:bg-primary-100 hover:text-primary-900',
                activeTab === tab.id && 'bg-primary-200 text-primary-900',
              )}
              aria-label={tab.label}
            >
              <HugeiconsIcon icon={tab.icon} size={20} strokeWidth={1.5} />
            </TooltipTrigger>
            <TooltipContent side="bottom">{tab.label}</TooltipContent>
          </TooltipRoot>
        </TooltipProvider>
      ))}
    </div>
  )
}

function OptionsPanel({
  conversationId,
  activeSession,
  onExport,
  exportDisabled = false,
}: {
  conversationId: string
  activeSession?: SessionMeta
  onExport: (format: ExportFormat) => void
  exportDisabled?: boolean
}) {
  const { settings, updateSettings } = useConversationSettings(conversationId)
  const { renameSession } = useRenameSession()
  const { togglePinnedSession, isSessionPinned } = usePinnedSessions()
  const modelsQuery = useModelsQuery()
  const [query, setQuery] = useState('')
  const [renameDialogOpen, setRenameDialogOpen] = useState(false)
  const modelOptions = modelsQuery.data?.models ?? []
  const resolvedModelID = resolveConversationModelID(
    settings.model,
    modelOptions,
    modelsQuery.data?.preferences.defaultModelId,
  )
  const filteredModels = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    if (!normalizedQuery) return modelOptions
    return modelOptions.filter((option) => {
      const haystack =
        `${option.id} ${option.name} ${option.owned_by} ${option.description} ${option.providerLabel}`.toLowerCase()
      return haystack.includes(normalizedQuery)
    })
  }, [modelOptions, query])
  const sessionTitle =
    activeSession?.label ||
    activeSession?.title ||
    activeSession?.derivedTitle ||
    activeSession?.friendlyId ||
    ''
  const pinned = activeSession ? isSessionPinned(activeSession.key) : false

  async function handleSaveRename(nextTitle: string) {
    if (!activeSession?.key || !activeSession.friendlyId) return
    await renameSession({
      sessionKey: activeSession.key,
      friendlyId: activeSession.friendlyId,
      newTitle: nextTitle,
    })
    setRenameDialogOpen(false)
  }

  function handleTogglePinned() {
    if (!activeSession?.key) return
    togglePinnedSession(activeSession.key)
  }

  return (
    <div className="pb-4">
      <PanelSection title="Model">
        <div className="overflow-hidden rounded-lg border border-primary-200 bg-primary-50/60">
          <Command
            items={filteredModels}
            value={query}
            onValueChange={setQuery}
            mode="none"
          >
            <CommandInput placeholder="Search models" className="text-sm" />
            <CommandPanel className="min-h-0 border-0 bg-transparent shadow-none [clip-path:none] before:hidden">
              {filteredModels.length === 0 ? (
                <CommandEmpty>
                  {modelsQuery.isLoading
                    ? 'Loading models...'
                    : 'No models match this search.'}
                </CommandEmpty>
              ) : (
                <CommandList className="h-64 min-h-0">
                  <CommandCollection>
                    {(option) => {
                      const isActive = resolvedModelID === option.id
                      return (
                        <CommandItem
                          key={option.id}
                          value={`${option.id} ${option.name || ''} ${option.description || ''}`}
                          onClick={() => updateSettings({ model: option.id })}
                          className={cn(
                            'min-w-0 items-start gap-3 rounded-md px-3 py-2',
                            isActive && 'bg-primary-100 text-primary-900',
                          )}
                        >
                          <div className="min-w-0 flex-1 overflow-hidden">
                            <div className="truncate font-mono text-xs text-primary-800">
                              {option.id}
                            </div>
                            {option.name ? (
                              <div className="truncate text-sm text-primary-900">
                                {option.name}
                              </div>
                            ) : null}
                            <div className="line-clamp-2 text-xs text-primary-500">
                              {option.description ||
                                option.providerLabel ||
                                option.owned_by}
                            </div>
                          </div>
                          {isActive ? (
                            <span className="shrink-0 pt-0.5 text-[11px] text-primary-500">
                              current
                            </span>
                          ) : null}
                        </CommandItem>
                      )
                    }}
                  </CommandCollection>
                </CommandList>
              )}
            </CommandPanel>
          </Command>
        </div>
      </PanelSection>

      <PanelSection title="Conversation">
        <SettingsRow
          label="Rename conversation"
          description="Update the visible title for this thread"
        >
          <Button
            size="sm"
            variant="ghost"
            onClick={function handleOpenRename() {
              setRenameDialogOpen(true)
            }}
            disabled={!activeSession}
          >
            <HugeiconsIcon icon={Pen01Icon} size={20} strokeWidth={1.5} />
            Rename
          </Button>
        </SettingsRow>
        <SettingsRow
          label="Pin conversation"
          description="Keep this thread at the top of the session list"
        >
          <Button
            size="sm"
            variant="ghost"
            onClick={handleTogglePinned}
            disabled={!activeSession}
          >
            <HugeiconsIcon icon={PinIcon} size={20} strokeWidth={1.5} />
            {pinned ? 'Unpin' : 'Pin'}
          </Button>
        </SettingsRow>
        <SettingsRow
          label="Export conversation"
          description="Download the current thread in a portable format"
        >
          <ExportMenu onExport={onExport} disabled={exportDisabled} />
        </SettingsRow>
      </PanelSection>
      <SessionRenameDialog
        open={renameDialogOpen}
        onOpenChange={setRenameDialogOpen}
        sessionTitle={sessionTitle}
        onSave={handleSaveRename}
        onCancel={function handleCancelRename() {
          setRenameDialogOpen(false)
        }}
      />
    </div>
  )
}

function RightSidebarComponent({
  isOpen,
  isMobile = false,
  activeTab,
  onTabChange,
  onClose,
  onExport,
  exportDisabled = false,
  conversationId,
  sessions,
  activeSessionKey,
}: RightSidebarProps) {
  const activeSession = useMemo(
    function findActiveSession() {
      if (!activeSessionKey) return undefined
      return sessions.find(function matchesActiveSession(session) {
        return session.key === activeSessionKey
      })
    },
    [activeSessionKey, sessions],
  )

  if (isMobile) {
    return (
      <AnimatePresence initial={false}>
        {isOpen ? (
          <>
            <motion.button
              type="button"
              aria-label="Close panel"
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
              className="fixed inset-y-0 right-0 z-50 flex w-[280px] max-w-[calc(100vw-2rem)] flex-col overflow-hidden border-l border-primary-200 bg-surface shadow-xl"
            >
              <div className="flex h-12 shrink-0 items-center justify-between border-b border-primary-200 px-2">
                <SidebarTabs activeTab={activeTab} onTabChange={onTabChange} />
                <Button
                  size="icon-sm"
                  variant="ghost"
                  onClick={onClose}
                  className="text-primary-500 hover:bg-primary-100"
                  aria-label="Close panel"
                >
                  <HugeiconsIcon
                    icon={Cancel01Icon}
                    size={16}
                    strokeWidth={1.5}
                  />
                </Button>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto px-1">
                {activeTab === 'options' ? (
                  <OptionsPanel
                    conversationId={conversationId}
                    activeSession={activeSession}
                    onExport={onExport}
                    exportDisabled={exportDisabled}
                  />
                ) : null}
                {activeTab === 'branches' ? (
                  <BranchTreePanel
                    sessions={sessions}
                    activeSessionKey={activeSessionKey}
                  />
                ) : null}
              </div>
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
          initial={{ width: 0, opacity: 0 }}
          animate={{ width: 280, opacity: 1 }}
          exit={{ width: 0, opacity: 0 }}
          transition={{ duration: 0.2, ease: 'easeInOut' }}
          className="relative z-30 flex h-full shrink-0 flex-col overflow-hidden border-l border-primary-200 bg-surface"
        >
          <div className="flex h-12 shrink-0 items-center justify-between border-b border-primary-200 px-2">
            <SidebarTabs activeTab={activeTab} onTabChange={onTabChange} />
            <Button
              size="icon-sm"
              variant="ghost"
              onClick={onClose}
              className="text-primary-500 hover:bg-primary-100"
              aria-label="Close panel"
            >
              <HugeiconsIcon icon={Cancel01Icon} size={16} strokeWidth={1.5} />
            </Button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-1">
              {activeTab === 'options' ? (
                <OptionsPanel
                  conversationId={conversationId}
                  activeSession={activeSession}
                  onExport={onExport}
                  exportDisabled={exportDisabled}
                />
            ) : null}
            {activeTab === 'branches' ? (
              <BranchTreePanel
                sessions={sessions}
                activeSessionKey={activeSessionKey}
              />
            ) : null}
          </div>
        </motion.aside>
      ) : null}
    </AnimatePresence>
  )
}

export const RightSidebar = memo(RightSidebarComponent)
