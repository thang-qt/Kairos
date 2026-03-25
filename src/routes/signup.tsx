import { createFileRoute } from '@tanstack/react-router'

import { AuthScreen } from '@/screens/auth/auth-screen'
import { configureChatBackend } from '@/lib/chat-backend'
import { requireGuestUser } from '@/lib/route-auth'

export const Route = createFileRoute('/signup')({
  beforeLoad: async function ensureGuestRoute({ context }) {
    configureChatBackend('mock')
    await requireGuestUser(context)
  },
  component: SignupRoute,
})

function SignupRoute() {
  configureChatBackend('mock')
  return <AuthScreen mode="signup" />
}
