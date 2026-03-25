import { createFileRoute } from '@tanstack/react-router'

import { AuthScreen } from '@/screens/auth/auth-screen'
import { requireGuestUser } from '@/lib/route-auth'

export const Route = createFileRoute('/auth')({
  beforeLoad: async function ensureGuestRoute({ context }) {
    await requireGuestUser(context)
  },
  component: AuthRoute,
})

function AuthRoute() {
  return <AuthScreen mode="login" />
}
