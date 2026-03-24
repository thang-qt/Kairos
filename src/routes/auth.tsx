import { createFileRoute } from '@tanstack/react-router'

import { AuthScreen } from '@/screens/auth/auth-screen'

export const Route = createFileRoute('/auth')({
  component: AuthRoute,
})

function AuthRoute() {
  return <AuthScreen mode="login" />
}
