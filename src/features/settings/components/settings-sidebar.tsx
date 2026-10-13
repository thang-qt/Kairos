import { HugeiconsIcon } from '@hugeicons/react'
import type { IconSvgElement } from '@hugeicons/react'
import {
  AiBrain01Icon,
  ArrowLeft01Icon,
  BubbleChatIcon,
  CloudServerIcon,
  Globe02Icon,
  PaintBoardIcon,
  PlugSocketIcon,
  SidebarLeft01Icon,
  UserCircleIcon,
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

type SettingsNavItem = {
  id: SettingsTab
  label: string
  icon: IconSvgElement
}

const SETTINGS_GROUPS: Array<{ label: string; items: Array<SettingsNavItem> }> =
  [
    {
      label: 'General',
      items: [
        { id: 'account', label: 'Account', icon: UserCircleIcon },
        { id: 'appearance', label: 'Appearance', icon: PaintBoardIcon },
      ],
    },
    {
      label: 'AI',
      items: [
        { id: 'providers', label: 'Providers', icon: CloudServerIcon },
        { id: 'models', label: 'Models', icon: AiBrain01Icon },
        { id: 'chat', label: 'Chat defaults', icon: BubbleChatIcon },
      ],
    },
    {
      label: 'Tools',
      items: [
        { id: 'web-tools', label: 'Web search', icon: Globe02Icon },
        { id: 'mcp', label: 'MCP servers', icon: PlugSocketIcon },
      ],
    },
  ]

const SETTINGS_ITEMS = SETTINGS_GROUPS.flatMap((group) => group.items)

export function getSettingsTabLabel(activeTab: SettingsTab) {
  return (
    SETTINGS_ITEMS.find((item) => item.id === activeTab)?.label ??
    SETTINGS_ITEMS[0].label
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
      className="flex h-full flex-col overflow-hidden bg-primary-100"
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

        <Button
          size="icon-sm"
          variant="ghost"
          onClick={onToggleCollapse}
          aria-label="Collapse sidebar"
        >
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
            <div className="px-2 pb-2">
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

            <nav
              aria-label="Settings"
              className="flex-1 space-y-5 overflow-y-auto px-2 py-2"
            >
              {SETTINGS_GROUPS.map((group) => (
                <div key={group.label} className="flex flex-col gap-px">
                  <div className="px-1.5 pb-1 text-xs text-primary-500">
                    {group.label}
                  </div>
                  {group.items.map((item) => {
                    const active = activeTab === item.id
                    return (
                      <button
                        key={item.id}
                        type="button"
                        aria-current={active ? 'page' : undefined}
                        onClick={() => onTabChange(item.id)}
                        className={cn(
                          'flex h-8 w-full items-center gap-2 rounded-lg pl-1.5 pr-2 text-left text-sm font-[450] text-primary-950 transition-colors duration-0 hover:bg-primary-200',
                          active && 'bg-primary-200',
                        )}
                      >
                        <HugeiconsIcon
                          icon={item.icon}
                          size={20}
                          strokeWidth={1.5}
                          className="min-w-5 text-primary-700"
                        />
                        <span className="truncate">{item.label}</span>
                      </button>
                    )
                  })}
                </div>
              ))}
            </nav>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </motion.aside>
  )
}
