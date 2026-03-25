import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Navigate, useNavigate } from '@tanstack/react-router'
import { HugeiconsIcon } from '@hugeicons/react'
import { Loading03Icon } from '@hugeicons/core-free-icons'
import { useState } from 'react'

import { AuthFormCard } from './components/auth-form-card'
import { AuthShell } from './components/auth-shell'
import {
  appQueryKeys,
  login,
  signup,
  useCapabilitiesQuery,
} from '@/lib/app-api'
import { FullScreenMessage } from '@/components/full-screen-message'

type AuthScreenProps = {
  mode?: 'login' | 'signup'
}

function AuthLoadingScreen() {
  return (
    <AuthShell>
      <div className="flex min-h-[26rem] items-center justify-center">
        <div className="flex size-12 items-center justify-center rounded-full border border-primary-200 bg-primary-50/80 text-primary-700 shadow-sm backdrop-blur-sm">
          <HugeiconsIcon
            icon={Loading03Icon}
            size={20}
            strokeWidth={1.5}
            className="animate-spin"
          />
          <span className="sr-only">Loading authentication state</span>
        </div>
      </div>
    </AuthShell>
  )
}

export function AuthScreen({ mode = 'login' }: AuthScreenProps) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const capabilitiesQuery = useCapabilitiesQuery()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [passwordConfirmation, setPasswordConfirmation] = useState('')
  const [formError, setFormError] = useState<string | null>(null)

  const signupEnabled = capabilitiesQuery.data?.auth.signupEnabled ?? false
  const activeMode = mode === 'signup' && signupEnabled ? 'signup' : 'login'

  const authMutation = useMutation({
    mutationFn: activeMode === 'signup' ? signup : login,
    onSuccess: async (user) => {
      queryClient.setQueryData(appQueryKeys.me, user)
      await queryClient.invalidateQueries({ queryKey: appQueryKeys.me })
      navigate({ to: '/new', replace: true })
    },
    onError: (error) => {
      setFormError(error instanceof Error ? error.message : 'Request failed')
    },
  })

  if (capabilitiesQuery.isPending) {
    return <AuthLoadingScreen />
  }

  if (capabilitiesQuery.error) {
    return (
      <FullScreenMessage
        title="Backend unavailable"
        detail={
          capabilitiesQuery.error instanceof Error
            ? capabilitiesQuery.error.message
            : 'Failed to load app capabilities.'
        }
        tone="error"
      />
    )
  }

  if (!capabilitiesQuery.data.auth.enabled) {
    return (
      <FullScreenMessage
        title="Authentication disabled"
        detail="This environment has auth turned off, so the new app shell is not available through the browser login flow."
      />
    )
  }

  return (
    <AuthShell>
      <AuthFormCard
        email={email}
        errorMessage={formError}
        isPending={authMutation.isPending}
        mode={activeMode}
        onEmailChange={setEmail}
        onPasswordChange={setPassword}
        onPasswordConfirmationChange={setPasswordConfirmation}
        onSubmit={function handleSubmit() {
          setFormError(null)
          if (activeMode === 'signup' && password !== passwordConfirmation) {
            setFormError('Passwords do not match')
            return
          }
          authMutation.mutate({ email, password })
        }}
        password={password}
        passwordConfirmation={passwordConfirmation}
        signupEnabled={signupEnabled}
      />
    </AuthShell>
  )
}
