import { useQuery, useQueryClient } from '@tanstack/react-query'
import { HugeiconsIcon } from '@hugeicons/react'
import { SidebarLeft01Icon } from '@hugeicons/core-free-icons'
import { ModelsSettingsPanel } from './components/models-settings-panel'
import { ProvidersSettingsPanel } from './components/providers-settings-panel'
import { AppearanceSettingsPanel } from './components/appearance-settings-panel'
import { AccountSettingsPanel } from './components/account-settings-panel'
import { WebToolsSettingsPanel } from './components/web-tools-settings-panel'
import { MCPServersPanel } from './components/mcp-servers-panel'
import { ChatSettingsPanel } from './components/chat-settings-panel'
import { ConversationExportPanel } from './components/conversation-export-panel'
import { ConversationImportPanel } from './components/conversation-import-panel'
import { AboutSettingsPanel } from './components/about-settings-panel'
import { DesktopSettingsPanel } from './components/desktop-settings-panel'
import {
  SettingsSidebar,
  getSettingsTabLabel,
} from './components/settings-sidebar'
import { AppShell } from '@/components/app-shell'
import { GlobalShortcuts } from '@/components/global-shortcuts'
import { Button } from '@/components/ui/button'
import { ScrollPanel } from '@/components/ui/scroll-area'
import { getShell } from '@/lib/shell'
import { useAppMobile } from '@/app/layout/use-app-mobile'
import {
  appShellUiQueryKey,
  getAppShellUiState,
  setAppShellUiState,
} from '@/app/layout/app-shell-ui'

export type SettingsTab =
  | 'account'
  | 'appearance'
  | 'desktop'
  | 'about'
  | 'providers'
  | 'models'
  | 'chat'
  | 'web-tools'
  | 'mcp'
  | 'import'
  | 'export'

type SettingsScreenProps = {
  activeTab: SettingsTab
  onTabChange: (tab: SettingsTab) => void
}

function renderTabPanel(
  activeTab: SettingsTab,
  onTabChange: (tab: SettingsTab) => void,
) {
  switch (activeTab) {
    case 'about':
      return <AboutSettingsPanel />
    case 'appearance':
      return <AppearanceSettingsPanel />
    case 'desktop':
      return getShell().canConfigureDesktop ? (
        <DesktopSettingsPanel />
      ) : (
        <AccountSettingsPanel />
      )
    case 'providers':
      return (
        <ProvidersSettingsPanel onOpenModels={() => onTabChange('models')} />
      )
    case 'models':
      return (
        <ModelsSettingsPanel onOpenProviders={() => onTabChange('providers')} />
      )
    case 'chat':
      return <ChatSettingsPanel />
    case 'export':
      return <ConversationExportPanel />
    case 'import':
      return <ConversationImportPanel />
    case 'web-tools':
      return <WebToolsSettingsPanel />
    case 'mcp':
      return <MCPServersPanel />
    default:
      return <AccountSettingsPanel />
  }
}

type SettingsHeaderProps = {
  title: string
  isSidebarCollapsed: boolean
  onOpenSidebar: () => void
}

function SettingsHeader({
  title,
  isSidebarCollapsed,
  onOpenSidebar,
}: SettingsHeaderProps) {
  return (
    <div className="flex h-12 items-center gap-2 px-4">
      {isSidebarCollapsed ? (
        <Button
          size="icon-sm"
          variant="ghost"
          onClick={onOpenSidebar}
          className="mr-1 text-primary-800 hover:bg-primary-100"
          aria-label="Open sidebar"
        >
          <HugeiconsIcon icon={SidebarLeft01Icon} size={20} strokeWidth={1.5} />
        </Button>
      ) : null}

      <div className="flex min-w-0 flex-1 items-center gap-1.5 text-sm">
        <span className="text-primary-500">Settings</span>
        <span aria-hidden className="text-primary-300">
          /
        </span>
        <span className="truncate text-primary-900">{title}</span>
      </div>
    </div>
  )
}

export function SettingsScreen({
  activeTab,
  onTabChange,
}: SettingsScreenProps) {
  const queryClient = useQueryClient()
  const { isMobile } = useAppMobile(queryClient)
  const uiQuery = useQuery({
    queryKey: appShellUiQueryKey,
    queryFn: function readUiState() {
      return getAppShellUiState(queryClient)
    },
    initialData: function initialUiState() {
      return getAppShellUiState(queryClient)
    },
    staleTime: Infinity,
  })
  const isSidebarCollapsed = uiQuery.data.isSidebarCollapsed
  const activeTabLabel = getSettingsTabLabel(activeTab)

  function handleOpenSidebar() {
    setAppShellUiState(queryClient, function openSidebar(state) {
      return { ...state, isSidebarCollapsed: false }
    })
  }

  function handleToggleSidebarCollapse() {
    setAppShellUiState(queryClient, function toggleSidebar(state) {
      return { ...state, isSidebarCollapsed: !state.isSidebarCollapsed }
    })
  }

  return (
    <AppShell
      isMobile={isMobile}
      isSidebarCollapsed={isSidebarCollapsed}
      onCloseSidebar={handleToggleSidebarCollapse}
      sidebar={
        <SettingsSidebar
          activeTab={activeTab}
          onTabChange={function handleTabChange(tab) {
            onTabChange(tab)
            if (isMobile) {
              handleToggleSidebarCollapse()
            }
          }}
          onToggleCollapse={handleToggleSidebarCollapse}
        />
      }
      header={
        <SettingsHeader
          title={activeTabLabel}
          isSidebarCollapsed={isSidebarCollapsed}
          onOpenSidebar={handleOpenSidebar}
        />
      }
    >
      <GlobalShortcuts onToggleSidebar={handleToggleSidebarCollapse} />
      <ScrollPanel
        className="flex-1"
        viewportClassName="px-4 pb-16 pt-16 sm:px-8"
      >
        <div className="mx-auto w-full max-w-3xl">
          {renderTabPanel(activeTab, onTabChange)}
        </div>
      </ScrollPanel>
    </AppShell>
  )
}
