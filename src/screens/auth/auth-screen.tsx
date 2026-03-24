import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Navigate, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'

import { AuthFormCard } from './components/auth-form-card'
import { AuthShell } from './components/auth-shell'
import {
  appQueryKeys,
  isUnauthorizedError,
  login,
  signup,
  useCapabilitiesQuery,
  useCurrentUserQuery,
} from '@/lib/app-api'
import { FullScreenMessage } from '@/components/full-screen-message'

type AuthScreenProps = {
  mode?: 'login' | 'signup'
}

export function AuthScreen({ mode = 'login' }: AuthScreenProps) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const capabilitiesQuery = useCapabilitiesQuery()
  const currentUserQuery = useCurrentUserQuery()
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

  if (capabilitiesQuery.isPending || currentUserQuery.isPending) {
    return (
      <FullScreenMessage
        title="Checking access"
        detail="Loading the current app policy and session."
      />
    )
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

  if (currentUserQuery.data) {
    return <Navigate to="/new" replace />
  }

  if (!isUnauthorizedError(currentUserQuery.error)) {
    return (
      <FullScreenMessage
        title="Session lookup failed"
        detail={
          currentUserQuery.error instanceof Error
            ? currentUserQuery.error.message
            : 'Failed to resolve the current session.'
        }
        tone="error"
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
