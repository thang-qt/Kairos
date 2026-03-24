import { Link } from '@tanstack/react-router'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

type AuthMode = 'login' | 'signup'

type AuthFormCardProps = {
  email: string
  password: string
  passwordConfirmation?: string
  errorMessage: string | null
  isPending: boolean
  mode: AuthMode
  signupEnabled: boolean
  onEmailChange: (value: string) => void
  onPasswordChange: (value: string) => void
  onPasswordConfirmationChange?: (value: string) => void
  onSubmit: () => void
}

export function AuthFormCard({
  email,
  password,
  passwordConfirmation,
  errorMessage,
  isPending,
  mode,
  signupEnabled,
  onEmailChange,
  onPasswordChange,
  onPasswordConfirmationChange,
  onSubmit,
}: AuthFormCardProps) {
  const isLogin = mode === 'login'
  const title = isLogin ? 'Welcome back' : 'Create your account'
  const subtitle = isLogin
    ? 'Sign in to continue your conversations.'
    : 'Get started with Kairos today.'
  const helper = isLogin
    ? "Don't have an account?"
    : 'Already have an account?'
  const submitLabel = isLogin
    ? isPending
      ? 'Signing in…'
      : 'Sign in'
    : isPending
      ? 'Creating account…'
      : 'Create account'

  return (
    <section>
      {/* Heading */}
      <div className="mb-7 space-y-1.5">
        <h1 className="font-serif text-[1.75rem] font-medium leading-tight text-primary-950">
          {title}
        </h1>
        <p className="text-sm text-primary-600">{subtitle}</p>
      </div>

      {/* Divider */}
      <div className="mb-7 h-px w-full bg-primary-200" />

      {/* Form */}
      <form
        className="space-y-4"
        onSubmit={function handleSubmit(event) {
          event.preventDefault()
          onSubmit()
        }}
      >
        <label className="block space-y-1.5">
          <span className="text-xs font-semibold uppercase tracking-wider text-primary-600">
            Email
          </span>
          <Input
            autoComplete="email"
            name="email"
            onChange={function handleEmailChange(event) {
              onEmailChange(event.target.value)
            }}
            placeholder="you@example.com"
            required
            type="email"
            value={email}
          />
        </label>

        <label className="block space-y-1.5">
          <span className="text-xs font-semibold uppercase tracking-wider text-primary-600">
            Password
          </span>
          <Input
            autoComplete={isLogin ? 'current-password' : 'new-password'}
            minLength={8}
            name="password"
            onChange={function handlePasswordChange(event) {
              onPasswordChange(event.target.value)
            }}
            placeholder="At least 8 characters"
            required
            type="password"
            value={password}
          />
        </label>

        {mode === 'signup' ? (
          <label className="block space-y-1.5">
            <span className="text-xs font-semibold uppercase tracking-wider text-primary-600">
              Confirm password
            </span>
            <Input
              autoComplete="new-password"
              minLength={8}
              name="passwordConfirmation"
              onChange={function handlePasswordConfirmationChange(event) {
                onPasswordConfirmationChange?.(event.target.value)
              }}
              placeholder="Repeat your password"
              required
              type="password"
              value={passwordConfirmation ?? ''}
            />
          </label>
        ) : null}

        {errorMessage ? (
          <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50/70 px-3.5 py-3 text-sm leading-5 text-red-700">
            <span className="mt-px shrink-0 text-base leading-none">⚠</span>
            <p className="text-pretty">{errorMessage}</p>
          </div>
        ) : null}

        <div className="pt-1">
          <Button className="w-full" disabled={isPending} type="submit" size="lg">
            {submitLabel}
          </Button>
        </div>
      </form>

      {/* Mode switcher */}
      {isLogin && signupEnabled ? (
        <p className="mt-6 text-center text-sm text-primary-600">
          {helper}{' '}
          <Link
            className="font-medium text-primary-900 underline underline-offset-2 hover:text-primary-950"
            to="/signup"
          >
            Sign up
          </Link>
        </p>
      ) : null}

      {mode === 'signup' ? (
        <p className="mt-6 text-center text-sm text-primary-600">
          {helper}{' '}
          <Link
            className="font-medium text-primary-900 underline underline-offset-2 hover:text-primary-950"
            to="/auth"
          >
            Sign in
          </Link>
        </p>
      ) : null}
    </section>
  )
}
