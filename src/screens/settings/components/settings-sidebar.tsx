import { HugeiconsIcon } from '@hugeicons/react'
import {
  ArrowLeft01Icon,
  Settings01Icon,
  SidebarLeft01Icon,
} from '@hugeicons/core-free-icons'
import { AnimatePresence, motion } from 'motion/react'
import { Link, useNavigate } from '@tanstack/react-router'
import type { SettingsTab } from '../settings-screen'
import { Button, buttonVariants } from '@/components/ui/button'
import { KairosIconBig } from '@/components/icons/kairos-icon-big'
import { cn } from '@/lib/utils'

type SettingsSidebarProps = {
  activeTab: SettingsTab
  onTabChange: (tab: SettingsTab) => void
  isCollapsed: boolean
  onToggleCollapse: () => void
}

const SETTINGS_TABS: Array<{
  id: SettingsTab
  label: string
}> = [
  {
    id: 'account',
    label: 'Account',
  },
  {
    id: 'models',
    label: 'Models',
  },
  {
    id: 'providers',
    label: 'Providers',
  },
  {
    id: 'appearance',
    label: 'Appearance',
  },
  {
    id: 'display',
    label: 'Display',
  },
]

export function getSettingsTabLabel(activeTab: SettingsTab) {
  return (
    SETTINGS_TABS.find(function matchTab(tab) {
      return tab.id === activeTab
    })?.label ?? SETTINGS_TABS[0].label
  )
}

export function SettingsSidebar({
  activeTab,
  onTabChange,
  isCollapsed,
  onToggleCollapse,
}: SettingsSidebarProps) {
  const navigate = useNavigate()
  const transition = {
    duration: 0.15,
    ease: isCollapsed ? 'easeIn' : 'easeOut',
  } as const

  function handleBackToChat() {
    if (typeof window !== 'undefined' && window.history.length > 1) {
      window.history.back()
      return
    }
    void navigate({ to: '/new' })
  }

  return (
    <motion.aside
      initial={false}
      animate={{ width: isCollapsed ? 0 : 300 }}
      transition={transition}
      className="flex h-full flex-col overflow-hidden border-r border-primary-200 bg-primary-100"
      style={{ overflow: 'hidden' }}
    >
      <motion.div
        layout
        transition={{ layout: transition }}
        className="flex h-12 items-center justify-between px-2"
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
                className={cn(
                  buttonVariants({ variant: 'ghost', size: 'sm' }),
                  'w-full justify-start pl-1.5',
                )}
              >
                <KairosIconBig className="size-5 rounded-sm" />
                Kairos
              </Link>
            </motion.div>
          ) : null}
        </AnimatePresence>

        <Button size="icon-sm" variant="ghost" onClick={onToggleCollapse}>
          <HugeiconsIcon icon={SidebarLeft01Icon} size={20} strokeWidth={1.5} />
        </Button>
      </motion.div>

      <AnimatePresence initial={false}>
        {!isCollapsed ? (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={transition}
            className="flex min-h-0 flex-1 flex-col"
          >
            <div className="border-b border-primary-200 px-3 pb-4 pt-2">
              <div className="flex items-center gap-2 px-1">
                <HugeiconsIcon
                  icon={Settings01Icon}
                  size={20}
                  strokeWidth={1.5}
                  className="text-primary-700"
                />
                <h1 className="text-sm text-primary-900">Settings</h1>
              </div>
            </div>

            <nav className="flex-1 space-y-1 overflow-y-auto px-2 py-3">
              {SETTINGS_TABS.map(function renderTab(tab) {
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={function handleSelectTab() {
                      onTabChange(tab.id)
                    }}
                    className={cn(
                      'flex w-full rounded-lg px-3 py-2 text-left text-sm transition-colors hover:bg-primary-50',
                      activeTab === tab.id && 'bg-primary-50 text-primary-950',
                    )}
                  >
                    <span className="truncate text-primary-900">
                      {tab.label}
                    </span>
                  </button>
                )
              })}
            </nav>

            <div className="border-t border-primary-200 bg-primary-100 px-2 py-3">
              <Button
                variant="ghost"
                size="sm"
                onClick={handleBackToChat}
                className="w-full justify-start pl-1.5"
              >
                <HugeiconsIcon
                  icon={ArrowLeft01Icon}
                  size={20}
                  strokeWidth={1.5}
                  className="min-w-5"
                />
                Back to chat
              </Button>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </motion.aside>
  )
}
