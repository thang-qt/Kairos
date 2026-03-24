import { createFileRoute } from '@tanstack/react-router'

import { AuthScreen } from '@/screens/auth/auth-screen'

export const Route = createFileRoute('/signup')({
  component: SignupRoute,
})

function SignupRoute() {
  return <AuthScreen mode="signup" />
}
