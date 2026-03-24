import { Link, useNavigate } from '@tanstack/react-router'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  ArrowLeft01Icon,
  Settings01Icon,
} from '@hugeicons/core-free-icons'
import { ModelMetadataPanel } from './components/model-metadata-panel'
import { AppearanceSettingsPanel } from './components/appearance-settings-panel'
import { DisplaySettingsPanel } from './components/display-settings-panel'
import { Button, buttonVariants } from '@/components/ui/button'
import { ProviderSettingsPanel } from '@/screens/chat/components/provider-settings-panel'
import { KairosIconBig } from '@/components/icons/kairos-icon-big'
import { cn } from '@/lib/utils'

export type SettingsTab = 'models' | 'providers' | 'appearance' | 'display'

type SettingsScreenProps = {
  activeTab: SettingsTab
  onTabChange: (tab: SettingsTab) => void
}

const SETTINGS_TABS: Array<{
  id: SettingsTab
  label: string
}> = [
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

function renderTabPanel(activeTab: SettingsTab) {
  if (activeTab === 'models') {
    return <ModelMetadataPanel />
  }
  if (activeTab === 'providers') {
    return <ProviderSettingsPanel />
  }
  if (activeTab === 'appearance') {
    return <AppearanceSettingsPanel />
  }
  return <DisplaySettingsPanel />
}

type SettingsSidebarProps = {
  activeTab: SettingsTab
  onTabChange: (tab: SettingsTab) => void
}

function SettingsSidebar({
  activeTab,
  onTabChange,
}: SettingsSidebarProps) {
  const navigate = useNavigate()

  function handleBackToChat() {
    if (typeof window !== 'undefined' && window.history.length > 1) {
      window.history.back()
      return
    }
    void navigate({ to: '/new' })
  }

  return (
    <aside className="h-full w-[300px] shrink-0 overflow-hidden border-r border-primary-200 bg-primary-100">
      <div className="flex h-full flex-col">
        <div className="flex h-12 items-center justify-between px-2">
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
        </div>

        <div className="border-b border-primary-200 px-3 pb-4 pt-2">
          <div className="flex items-center gap-2 px-1">
            <HugeiconsIcon
              icon={Settings01Icon}
              size={20}
              strokeWidth={1.5}
              className="text-primary-700"
            />
            <div className="min-w-0">
              <h1 className="text-balance text-sm text-primary-900">
                Settings
              </h1>
            </div>
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
                <span className="text-primary-900">{tab.label}</span>
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
      </div>
    </aside>
  )
}

export function SettingsScreen({
  activeTab,
  onTabChange,
}: SettingsScreenProps) {
  const activeTabMeta =
    SETTINGS_TABS.find(function matchTab(tab) {
      return tab.id === activeTab
    }) ?? SETTINGS_TABS[0]

  return (
    <div className="h-screen bg-surface text-primary-900">
      <div className="flex h-full min-h-0 overflow-hidden">
        <SettingsSidebar activeTab={activeTab} onTabChange={onTabChange} />

        <main className="relative flex h-full min-h-0 flex-1 flex-col">
          <div
            className="pointer-events-none absolute left-0 right-0 top-0 z-10"
            style={{
              height: 80,
              background:
                'linear-gradient(to bottom, var(--color-surface), transparent)',
            }}
          >
            <div className="pointer-events-auto px-6 py-4 backdrop-blur-sm">
              <h1 className="text-balance text-lg text-primary-950">
                {activeTabMeta.label}
              </h1>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6 pt-24">
            <div className="mx-auto w-full max-w-5xl">
              {renderTabPanel(activeTab)}
            </div>
          </div>
        </main>
      </div>
    </div>
  )
}
