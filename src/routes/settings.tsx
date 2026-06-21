import { createFileRoute, useNavigate } from '@tanstack/react-router'
import type { SettingsTab } from '@/screens/settings/settings-screen'
import { requireAuthenticatedUser } from '@/lib/route-auth'
import { SettingsScreen } from '@/screens/settings/settings-screen'

const SETTINGS_TABS = new Set<SettingsTab>([
  'account',
  'models',
  'web-tools',
  'appearance',
  'display',
])

export const Route = createFileRoute('/settings')({
  beforeLoad: async function ensureAuthenticatedRoute({ context }) {
    await requireAuthenticatedUser(context)
  },
  validateSearch: function validateSearch(search: Record<string, unknown>) {
    const tabInput = search.tab
    if (tabInput === 'providers') {
      return { tab: 'models' as SettingsTab }
    }
    const tab =
      typeof tabInput === 'string' && SETTINGS_TABS.has(tabInput as SettingsTab)
        ? (tabInput as SettingsTab)
        : 'account'
    return { tab }
  },
  component: SettingsRoute,
})

function SettingsRoute() {
  const navigate = useNavigate()
  const search = Route.useSearch() as { tab: SettingsTab }

  return (
    <SettingsScreen
      activeTab={search.tab}
      onTabChange={function handleTabChange(tab) {
        void navigate({
          to: '/settings',
          search: { tab },
          replace: true,
        })
      }}
    />
  )
}
