import { createFileRoute } from '@tanstack/react-router'

import { AuthScreen } from '@/screens/auth/auth-screen'
import { requireGuestUser } from '@/lib/route-auth'

export const Route = createFileRoute('/signup')({
  beforeLoad: async function ensureGuestRoute({ context }) {
    await requireGuestUser(context)
  },
  component: SignupRoute,
})

function SignupRoute() {
  return <AuthScreen mode="signup" />
}
