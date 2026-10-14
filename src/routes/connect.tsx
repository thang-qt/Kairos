import { createFileRoute, redirect } from '@tanstack/react-router'
import { getShell } from '@/lib/shell'
import { ConnectScreen } from '@/features/auth/connect-screen'

export const Route = createFileRoute('/connect')({
  beforeLoad: function redirectLegacyConnectRoute() {
    if (!getShell().isDesktop)
      throw redirect({
        to: '/new',
        replace: true,
      })
  },
  component: ConnectRoute,
})

function ConnectRoute() {
  return <ConnectScreen />
}
