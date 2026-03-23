import { memo } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  Cancel01Icon,
  GitBranchIcon,
  Settings01Icon,
} from '@hugeicons/core-free-icons'
import { AnimatePresence, motion } from 'motion/react'
import { BranchTreePanel } from './branch-tree-panel'
import type { SessionMeta } from '../types'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export type RightSidebarTab = 'branches' | 'config'

type RightSidebarProps = {
  isOpen: boolean
  isMobile?: boolean
  activeTab: RightSidebarTab
  onTabChange: (tab: RightSidebarTab) => void
  onClose: () => void
  sessions: Array<SessionMeta>
  activeSessionKey?: string
}

const TABS = [
  {
    id: 'branches' as const,
    label: 'Branches',
    icon: GitBranchIcon,
  },
  {
    id: 'config' as const,
    label: 'Config',
    icon: Settings01Icon,
  },
]

function RightSidebarComponent({
  isOpen,
  isMobile = false,
  activeTab,
  onTabChange,
  onClose,
  sessions,
  activeSessionKey,
}: RightSidebarProps) {
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
                <div className="flex items-center gap-0.5">
                  {TABS.map((tab) => (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => onTabChange(tab.id)}
                      className={cn(
                        'flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors',
                        activeTab === tab.id
                          ? 'bg-primary-200 text-primary-900'
                          : 'text-primary-600 hover:bg-primary-100 hover:text-primary-800',
                      )}
                    >
                      <HugeiconsIcon
                        icon={tab.icon}
                        size={14}
                        strokeWidth={1.6}
                      />
                      {tab.label}
                    </button>
                  ))}
                </div>
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
                {activeTab === 'branches' ? (
                  <BranchTreePanel
                    sessions={sessions}
                    activeSessionKey={activeSessionKey}
                  />
                ) : null}
                {activeTab === 'config' ? (
                  <div className="flex h-32 flex-col items-center justify-center px-4 text-center text-xs text-primary-500">
                    <HugeiconsIcon
                      icon={Settings01Icon}
                      size={20}
                      strokeWidth={1.5}
                      className="mb-2 text-primary-400"
                    />
                    <p>Model configuration</p>
                    <p className="mt-1 text-primary-400">
                      Temperature, top-p, and more - coming soon
                    </p>
                  </div>
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
            <div className="flex items-center gap-0.5">
              {TABS.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => onTabChange(tab.id)}
                  className={cn(
                    'flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors',
                    activeTab === tab.id
                      ? 'bg-primary-200 text-primary-900'
                      : 'text-primary-600 hover:bg-primary-100 hover:text-primary-800',
                  )}
                >
                  <HugeiconsIcon
                    icon={tab.icon}
                    size={14}
                    strokeWidth={1.6}
                  />
                  {tab.label}
                </button>
              ))}
            </div>
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
            {activeTab === 'branches' ? (
              <BranchTreePanel
                sessions={sessions}
                activeSessionKey={activeSessionKey}
              />
            ) : null}
            {activeTab === 'config' ? (
              <div className="flex h-32 flex-col items-center justify-center px-4 text-center text-xs text-primary-500">
                <HugeiconsIcon
                  icon={Settings01Icon}
                  size={20}
                  strokeWidth={1.5}
                  className="mb-2 text-primary-400"
                />
                <p>Model configuration</p>
                <p className="mt-1 text-primary-400">
                  Temperature, top-p, and more - coming soon
                </p>
              </div>
            ) : null}
          </div>
        </motion.aside>
      ) : null}
    </AnimatePresence>
  )
}

export const RightSidebar = memo(RightSidebarComponent)
