import { createFileRoute } from '@tanstack/react-router'

import { AuthScreen } from '@/screens/auth/auth-screen'
import { configureChatBackend } from '@/lib/chat-backend'

export const Route = createFileRoute('/signup')({
  component: SignupRoute,
})

function SignupRoute() {
  configureChatBackend('mock')
  return <AuthScreen mode="signup" />
}
