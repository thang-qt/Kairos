import { createFileRoute } from '@tanstack/react-router'

import { AuthScreen } from '@/screens/auth/auth-screen'
import { configureChatBackend } from '@/lib/chat-backend'

export const Route = createFileRoute('/auth')({
  component: AuthRoute,
})

function AuthRoute() {
  configureChatBackend('mock')
  return <AuthScreen mode="login" />
}
