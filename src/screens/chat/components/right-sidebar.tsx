import { memo, useMemo, useState } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  Cancel01Icon,
  FilterHorizontalIcon,
  GitBranchIcon,
  Pen01Icon,
  PinIcon,
  Settings02Icon,
} from '@hugeicons/core-free-icons'
import { AnimatePresence, motion } from 'motion/react'
import { usePinSession } from '../hooks/use-pin-session'
import { useRenameSession } from '../hooks/use-rename-session'
import { BranchTreePanel } from './branch-tree-panel'
import { ModelSettingsPanel } from './model-settings-panel'
import { SessionRenameDialog } from './sidebar/session-rename-dialog'
import type { SessionMeta } from '../types'
import type { ConversationSettings } from '../conversation-settings'
import type { ProviderModel } from '@/lib/app-api'
import { Button } from '@/components/ui/button'
import { ExportMenu } from '@/components/export-menu'
import { cn } from '@/lib/utils'
import {
  TooltipContent,
  TooltipProvider,
  TooltipRoot,
  TooltipTrigger,
} from '@/components/ui/tooltip'

type ExportFormat = 'markdown' | 'json' | 'text'

export type RightSidebarTab = 'options' | 'model' | 'branches'
export type RightSidebarModelSettings = Pick<
  ConversationSettings,
  | 'model'
  | 'systemPrompt'
  | 'temperature'
  | 'topP'
  | 'maxOutputTokens'
  | 'thinkingLevel'
>

type RightSidebarProps = {
  isOpen: boolean
  isMobile?: boolean
  activeTab: RightSidebarTab
  onTabChange: (tab: RightSidebarTab) => void
  onClose: () => void
  onExport: (format: ExportFormat) => void
  exportDisabled?: boolean
  sessions: Array<SessionMeta>
  activeSessionKey?: string
  models: Array<ProviderModel>
  selectedModelId: string
  defaultModelId?: string
  modelsLoading?: boolean
  canSelectModel?: boolean
  defaultModelLocked?: boolean
  modelSettings: RightSidebarModelSettings
  onModelSettingsChange: (updates: Partial<RightSidebarModelSettings>) => void
}

const TABS = [
  {
    id: 'options' as const,
    label: 'Options',
    icon: FilterHorizontalIcon,
  },
  {
    id: 'model' as const,
    label: 'Model',
    icon: Settings02Icon,
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
      {TABS.map(function renderTab(tab) {
        return (
          <TooltipProvider key={tab.id}>
            <TooltipRoot>
              <TooltipTrigger
                type="button"
                onClick={function handleClick() {
                  onTabChange(tab.id)
                }}
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
        )
      })}
    </div>
  )
}

function OptionsPanel({
  activeSession,
  onExport,
  exportDisabled = false,
}: {
  activeSession?: SessionMeta
  onExport: (format: ExportFormat) => void
  exportDisabled?: boolean
}) {
  const { pinSession } = usePinSession()
  const { renameSession } = useRenameSession()
  const [renameDialogOpen, setRenameDialogOpen] = useState(false)
  const sessionTitle =
    activeSession?.label ||
    activeSession?.title ||
    activeSession?.derivedTitle ||
    activeSession?.friendlyId ||
    ''
  const pinned = activeSession?.isPinned === true

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
    if (!activeSession?.key || !activeSession.friendlyId) return
    void pinSession({
      sessionKey: activeSession.key,
      friendlyId: activeSession.friendlyId,
      isPinned: !pinned,
    })
  }

  return (
    <div className="pb-4">
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

function SidebarBody({
  activeTab,
  activeSession,
  activeSessionKey,
  canSelectModel,
  defaultModelId,
  defaultModelLocked,
  exportDisabled,
  modelSettings,
  models,
  modelsLoading,
  onExport,
  onModelSettingsChange,
  selectedModelId,
  sessions,
}: {
  activeTab: RightSidebarTab
  activeSession?: SessionMeta
  activeSessionKey?: string
  canSelectModel: boolean
  defaultModelId?: string
  defaultModelLocked: boolean
  exportDisabled: boolean
  modelSettings: RightSidebarModelSettings
  models: Array<ProviderModel>
  modelsLoading: boolean
  onExport: (format: ExportFormat) => void
  onModelSettingsChange: (updates: Partial<RightSidebarModelSettings>) => void
  selectedModelId: string
  sessions: Array<SessionMeta>
}) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-1">
      {activeTab === 'options' ? (
        <OptionsPanel
          activeSession={activeSession}
          onExport={onExport}
          exportDisabled={exportDisabled}
        />
      ) : null}
      {activeTab === 'model' ? (
        <ModelSettingsPanel
          models={models}
          selectedModelId={selectedModelId}
          defaultModelId={defaultModelId}
          loading={modelsLoading}
          canSelectModel={canSelectModel}
          defaultModelLocked={defaultModelLocked}
          value={modelSettings}
          onChange={onModelSettingsChange}
        />
      ) : null}
      {activeTab === 'branches' ? (
        <BranchTreePanel
          sessions={sessions}
          activeSessionKey={activeSessionKey}
        />
      ) : null}
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
  sessions,
  activeSessionKey,
  models,
  selectedModelId,
  defaultModelId,
  modelsLoading = false,
  canSelectModel = true,
  defaultModelLocked = false,
  modelSettings,
  onModelSettingsChange,
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

              <SidebarBody
                activeTab={activeTab}
                activeSession={activeSession}
                activeSessionKey={activeSessionKey}
                canSelectModel={canSelectModel}
                defaultModelId={defaultModelId}
                defaultModelLocked={defaultModelLocked}
                exportDisabled={exportDisabled}
                modelSettings={modelSettings}
                models={models}
                modelsLoading={modelsLoading}
                onExport={onExport}
                onModelSettingsChange={onModelSettingsChange}
                selectedModelId={selectedModelId}
                sessions={sessions}
              />
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

          <SidebarBody
            activeTab={activeTab}
            activeSession={activeSession}
            activeSessionKey={activeSessionKey}
            canSelectModel={canSelectModel}
            defaultModelId={defaultModelId}
            defaultModelLocked={defaultModelLocked}
            exportDisabled={exportDisabled}
            modelSettings={modelSettings}
            models={models}
            modelsLoading={modelsLoading}
            onExport={onExport}
            onModelSettingsChange={onModelSettingsChange}
            selectedModelId={selectedModelId}
            sessions={sessions}
          />
        </motion.aside>
      ) : null}
    </AnimatePresence>
  )
}

export const RightSidebar = memo(RightSidebarComponent)
