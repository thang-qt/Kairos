import { useQuery, useQueryClient } from '@tanstack/react-query'
import { HugeiconsIcon } from '@hugeicons/react'
import { Settings01Icon, SidebarLeft01Icon } from '@hugeicons/core-free-icons'
import { ModelMetadataPanel } from './components/model-metadata-panel'
import { AppearanceSettingsPanel } from './components/appearance-settings-panel'
import { DisplaySettingsPanel } from './components/display-settings-panel'
import { AccountSettingsPanel } from './components/account-settings-panel'
import {
  SettingsSidebar,
  getSettingsTabLabel,
} from './components/settings-sidebar'
import { ProviderSettingsPanel } from '@/screens/chat/components/provider-settings-panel'
import { AppShell } from '@/components/app-shell'
import { Button } from '@/components/ui/button'
import { useChatMobile } from '@/screens/chat/hooks/use-chat-mobile'
import {
  chatUiQueryKey,
  getChatUiState,
  setChatUiState,
} from '@/screens/chat/chat-ui'

export type SettingsTab =
  | 'account'
  | 'models'
  | 'providers'
  | 'appearance'
  | 'display'

type SettingsScreenProps = {
  activeTab: SettingsTab
  onTabChange: (tab: SettingsTab) => void
}

function renderTabPanel(activeTab: SettingsTab) {
  if (activeTab === 'account') {
    return <AccountSettingsPanel />
  }
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

      <div className="flex min-w-0 flex-1 items-center gap-2">
        <HugeiconsIcon
          icon={Settings01Icon}
          size={20}
          strokeWidth={1.5}
          className="shrink-0 text-primary-700"
        />
        <h1 className="min-w-0 flex-1 truncate text-balance text-base text-primary-950">
          {title}
        </h1>
      </div>
    </div>
  )
}

export function SettingsScreen({
  activeTab,
  onTabChange,
}: SettingsScreenProps) {
  const queryClient = useQueryClient()
  const { isMobile } = useChatMobile(queryClient)
  const uiQuery = useQuery({
    queryKey: chatUiQueryKey,
    queryFn: function readUiState() {
      return getChatUiState(queryClient)
    },
    initialData: function initialUiState() {
      return getChatUiState(queryClient)
    },
    staleTime: Infinity,
  })
  const isSidebarCollapsed = uiQuery.data.isSidebarCollapsed
  const activeTabLabel = getSettingsTabLabel(activeTab)

  function handleOpenSidebar() {
    setChatUiState(queryClient, function openSidebar(state) {
      return { ...state, isSidebarCollapsed: false }
    })
  }

  function handleToggleSidebarCollapse() {
    setChatUiState(queryClient, function toggleSidebar(state) {
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
          isCollapsed={isSidebarCollapsed}
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
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4 pt-20 sm:px-6 sm:pb-6">
        <div className="mx-auto w-full max-w-5xl">
          {renderTabPanel(activeTab)}
        </div>
      </div>
    </AppShell>
  )
}
