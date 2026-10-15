import { HugeiconsIcon } from '@hugeicons/react'
import type { IconSvgElement } from '@hugeicons/react'
import {
  ArrowLeft01Icon,
  BubbleChatIcon,
  CloudServerIcon,
  ComputerIcon,
  CpuIcon,
  Globe02Icon,
  PaintBoardIcon,
  PlugSocketIcon,
  SidebarLeft01Icon,
  UserCircleIcon,
  FileImportIcon,
  FileExportIcon,
} from '@hugeicons/core-free-icons'
import { Link, useNavigate } from '@tanstack/react-router'
import type { SettingsTab } from '../settings-screen'
import { Button, buttonVariants } from '@/components/ui/button'
import { KairosIconBig } from '@/components/icons/kairos-icon-big'
import { cn } from '@/lib/utils'
import { ScrollPanel } from '@/components/ui/scroll-area'
import { getShell } from '@/lib/shell'

type SettingsSidebarProps = {
  activeTab: SettingsTab
  onTabChange: (tab: SettingsTab) => void
  onToggleCollapse: () => void
}

type SettingsNavItem = {
  id: SettingsTab
  label: string
  icon: IconSvgElement
  desktopOnly?: boolean
}

const SETTINGS_GROUPS: Array<{ label: string; items: Array<SettingsNavItem> }> =
  [
    {
      label: 'General',
      items: [
        { id: 'account', label: 'Account', icon: UserCircleIcon },
        { id: 'appearance', label: 'Appearance', icon: PaintBoardIcon },
        {
          id: 'desktop',
          label: 'Desktop app',
          icon: ComputerIcon,
          desktopOnly: true,
        },
      ],
    },
    {
      label: 'AI',
      items: [
        { id: 'providers', label: 'Providers', icon: CloudServerIcon },
        { id: 'models', label: 'Models', icon: CpuIcon },
        { id: 'chat', label: 'Chat defaults', icon: BubbleChatIcon },
      ],
    },
    {
      label: 'Data',
      items: [
        { id: 'import', label: 'Import', icon: FileImportIcon },
        { id: 'export', label: 'Export', icon: FileExportIcon },
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
  onToggleCollapse,
}: SettingsSidebarProps) {
  const navigate = useNavigate()
  function handleBackToChat() {
    if (typeof window !== 'undefined' && window.history.length > 1) {
      window.history.back()
      return
    }
    void navigate({ to: '/new' })
  }

  // The desktop title bar already shows the Kairos identity, so the main
  // window drops the logo row and the first action row takes its place.
  const shell = getShell()
  const providesIdentity = shell.providesIdentity
  const collapseToggle = (
    <Button
      size="icon-sm"
      variant="ghost"
      onClick={onToggleCollapse}
      aria-label="Collapse sidebar"
      className="shrink-0"
    >
      <HugeiconsIcon icon={SidebarLeft01Icon} size={20} strokeWidth={1.5} />
    </Button>
  )

  return (
    <aside className="flex h-full w-full flex-col overflow-hidden bg-primary-100">
      {providesIdentity ? null : (
        <div className="flex shrink-0 h-12 items-center justify-between px-2">
          <Link
            to="/new"
            className={cn(
              buttonVariants({ variant: 'ghost', size: 'sm' }),
              'justify-start pl-1.5',
            )}
          >
            <KairosIconBig className="size-5 rounded-sm" />
            Kairos
          </Link>
          {collapseToggle}
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col">
        <div className={cn('flex items-center gap-1 px-2 pb-2 desktop:pt-4')}>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleBackToChat}
            className="min-w-0 flex-1 justify-start pl-1.5"
          >
            <HugeiconsIcon
              icon={ArrowLeft01Icon}
              size={20}
              strokeWidth={1.5}
              className="min-w-5"
            />
            Back to chat
          </Button>
          {providesIdentity ? collapseToggle : null}
        </div>

        <ScrollPanel className="flex-1">
          <nav aria-label="Settings" className="space-y-5 px-2 py-2">
            {SETTINGS_GROUPS.map((group) => (
              <div key={group.label} className="flex flex-col gap-px">
                <div className="px-1.5 pb-1 text-xs text-primary-500">
                  {group.label}
                </div>
                {group.items.map((item) => {
                  if (item.desktopOnly && !shell.canConfigureDesktop)
                    return null
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
        </ScrollPanel>
      </div>
    </aside>
  )
}
