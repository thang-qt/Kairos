import { createFileRoute, useNavigate } from '@tanstack/react-router'
import type { SettingsTab } from '@/screens/settings/settings-screen'
import { requireAuthenticatedUser } from '@/lib/route-auth'
import { SettingsScreen } from '@/screens/settings/settings-screen'

const SETTINGS_TABS = new Set<SettingsTab>([
  'models',
  'providers',
  'appearance',
  'display',
])

export const Route = createFileRoute('/settings')({
  beforeLoad: async function ensureAuthenticatedRoute({ context }) {
    await requireAuthenticatedUser(context)
  },
  validateSearch: function validateSearch(search: Record<string, unknown>) {
    const tab =
      typeof search.tab === 'string' && SETTINGS_TABS.has(search.tab as SettingsTab)
        ? (search.tab as SettingsTab)
        : 'models'
    return { tab }
  },
  component: SettingsRoute,
})

function SettingsRoute() {
  const navigate = useNavigate()
  const search = Route.useSearch()

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
