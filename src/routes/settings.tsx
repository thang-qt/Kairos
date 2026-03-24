import { Navigate, createFileRoute, useNavigate } from '@tanstack/react-router'
import type { SettingsTab } from '@/screens/settings/settings-screen'
import { FullScreenMessage } from '@/components/full-screen-message'
import { isUnauthorizedError, useCurrentUserQuery } from '@/lib/app-api'
import { configureChatBackend } from '@/lib/chat-backend'
import { SettingsScreen } from '@/screens/settings/settings-screen'

const SETTINGS_TABS = new Set<SettingsTab>([
  'models',
  'providers',
  'appearance',
  'display',
])

export const Route = createFileRoute('/settings')({
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
  const currentUserQuery = useCurrentUserQuery()
  const navigate = useNavigate()
  const search = Route.useSearch()

  if (currentUserQuery.isPending) {
    return (
      <FullScreenMessage
        title="Checking session"
        detail="Loading the authenticated app shell before opening settings."
      />
    )
  }

  if (currentUserQuery.error) {
    if (isUnauthorizedError(currentUserQuery.error)) {
      configureChatBackend('mock')
      return <Navigate replace to="/auth" />
    }

    return (
      <FullScreenMessage
        title="Session check failed"
        detail={
          currentUserQuery.error instanceof Error
            ? currentUserQuery.error.message
            : 'Failed to validate the current session.'
        }
        tone="error"
      />
    )
  }

  configureChatBackend('http')

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
