import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { ChangeEvent, FormEvent, ReactNode } from 'react'
import {
  ApiError,
  appQueryKeys,
  changeEmail,
  changePassword,
  useCurrentUserQuery,
} from '@/lib/app-api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

type SettingsCardProps = {
  title: string
  description: string
  children: ReactNode
}

type MessageTone = 'success' | 'error'

type InlineMessageProps = {
  tone: MessageTone
  message: string
}

function getErrorMessage(error: unknown, fallback: string) {
  if (error instanceof ApiError) {
    return error.message
  }
  if (error instanceof Error) {
    return error.message
  }
  return fallback
}

function SettingsCard({ title, description, children }: SettingsCardProps) {
  return (
    <section className="rounded-xl border border-primary-200 bg-surface p-5">
      <div className="mb-4 max-w-2xl">
        <h2 className="text-balance text-base text-primary-950">{title}</h2>
        <p className="mt-1 text-pretty text-sm text-primary-500">
          {description}
        </p>
      </div>
      {children}
    </section>
  )
}

function FieldLabel({
  htmlFor,
  label,
}: {
  htmlFor: string
  label: string
}) {
  return (
    <label htmlFor={htmlFor} className="text-sm text-primary-900">
      {label}
    </label>
  )
}

function InlineMessage({ tone, message }: InlineMessageProps) {
  return (
    <div
      className={cn(
        'rounded-lg px-3 py-2 text-sm',
        tone === 'success'
          ? 'border border-primary-200 bg-primary-50 text-primary-800'
          : 'border border-red-200 bg-red-50 text-red-700',
      )}
    >
      {message}
    </div>
  )
}

export function AccountSettingsPanel() {
  const queryClient = useQueryClient()
  const currentUserQuery = useCurrentUserQuery()
  const [nextEmail, setNextEmail] = useState('')
  const [emailPassword, setEmailPassword] = useState('')
  const [emailMessage, setEmailMessage] = useState<InlineMessageProps | null>(
    null,
  )
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [passwordMessage, setPasswordMessage] =
    useState<InlineMessageProps | null>(null)

  const emailMutation = useMutation({
    mutationFn: changeEmail,
    onSuccess: function handleSuccess(user) {
      queryClient.setQueryData(appQueryKeys.me, user)
      setNextEmail(user.email)
      setEmailPassword('')
      setEmailMessage({
        tone: 'success',
        message: 'Email address updated.',
      })
    },
    onError: function handleError(error) {
      setEmailMessage({
        tone: 'error',
        message: getErrorMessage(error, 'Failed to update email address.'),
      })
    },
  })

  const passwordMutation = useMutation({
    mutationFn: changePassword,
    onSuccess: function handleSuccess() {
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
      setPasswordMessage({
        tone: 'success',
        message: 'Password updated. Other sessions were signed out.',
      })
    },
    onError: function handleError(error) {
      setPasswordMessage({
        tone: 'error',
        message: getErrorMessage(error, 'Failed to update password.'),
      })
    },
  })

  const currentEmail = currentUserQuery.data?.email ?? ''

  return (
    <div className="space-y-4">
      <SettingsCard
        title="Account"
        description="Manage the email address and password used to sign in to this workspace."
      >
        <div className="rounded-lg border border-primary-200 bg-primary-50/60 px-4 py-3">
          <div className="text-xs text-primary-500">Current email</div>
          <div className="mt-1 truncate text-sm text-primary-900 tabular-nums">
            {currentEmail || 'Loading...'}
          </div>
        </div>
      </SettingsCard>

      <SettingsCard
        title="Change email"
        description="Confirm your password before replacing the email used for future logins."
      >
        <form
          className="space-y-3"
          onSubmit={function handleSubmit(event: FormEvent<HTMLFormElement>) {
            event.preventDefault()
            setEmailMessage(null)

            const trimmedEmail = nextEmail.trim()
            if (!trimmedEmail) {
              setEmailMessage({
                tone: 'error',
                message: 'Enter a new email address.',
              })
              return
            }
            if (!emailPassword) {
              setEmailMessage({
                tone: 'error',
                message: 'Enter your current password.',
              })
              return
            }

            emailMutation.mutate({
              newEmail: trimmedEmail,
              currentPassword: emailPassword,
            })
          }}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <FieldLabel htmlFor="next-email" label="New email" />
              <Input
                id="next-email"
                nativeInput
                type="email"
                autoComplete="email"
                placeholder={currentEmail || 'name@example.com'}
                value={nextEmail}
                onChange={function handleChange(event: ChangeEvent<HTMLInputElement>) {
                  setNextEmail(event.target.value)
                }}
              />
            </div>
            <div className="space-y-1.5">
              <FieldLabel
                htmlFor="confirm-email-password"
                label="Current password"
              />
              <Input
                id="confirm-email-password"
                nativeInput
                type="password"
                autoComplete="current-password"
                value={emailPassword}
                onChange={function handleChange(event: ChangeEvent<HTMLInputElement>) {
                  setEmailPassword(event.target.value)
                }}
              />
            </div>
          </div>

          {emailMessage ? <InlineMessage {...emailMessage} /> : null}

          <div className="flex justify-end">
            <Button type="submit" disabled={emailMutation.isPending}>
              {emailMutation.isPending ? 'Updating...' : 'Update email'}
            </Button>
          </div>
        </form>
      </SettingsCard>

      <SettingsCard
        title="Change password"
        description="Use your current password to set a new one. Updating it will sign out your other active sessions."
      >
        <form
          className="space-y-3"
          onSubmit={function handleSubmit(event: FormEvent<HTMLFormElement>) {
            event.preventDefault()
            setPasswordMessage(null)

            if (!currentPassword) {
              setPasswordMessage({
                tone: 'error',
                message: 'Enter your current password.',
              })
              return
            }
            if (!newPassword) {
              setPasswordMessage({
                tone: 'error',
                message: 'Enter a new password.',
              })
              return
            }
            if (newPassword !== confirmPassword) {
              setPasswordMessage({
                tone: 'error',
                message: 'New passwords do not match.',
              })
              return
            }

            passwordMutation.mutate({
              currentPassword,
              newPassword,
            })
          }}
        >
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <FieldLabel
                htmlFor="current-password"
                label="Current password"
              />
              <Input
                id="current-password"
                nativeInput
                type="password"
                autoComplete="current-password"
                value={currentPassword}
                onChange={function handleChange(event: ChangeEvent<HTMLInputElement>) {
                  setCurrentPassword(event.target.value)
                }}
              />
            </div>
            <div className="space-y-1.5">
              <FieldLabel htmlFor="new-password" label="New password" />
              <Input
                id="new-password"
                nativeInput
                type="password"
                autoComplete="new-password"
                value={newPassword}
                onChange={function handleChange(event: ChangeEvent<HTMLInputElement>) {
                  setNewPassword(event.target.value)
                }}
              />
            </div>
            <div className="space-y-1.5">
              <FieldLabel
                htmlFor="confirm-new-password"
                label="Confirm new password"
              />
              <Input
                id="confirm-new-password"
                nativeInput
                type="password"
                autoComplete="new-password"
                value={confirmPassword}
                onChange={function handleChange(event: ChangeEvent<HTMLInputElement>) {
                  setConfirmPassword(event.target.value)
                }}
              />
            </div>
          </div>

          {passwordMessage ? <InlineMessage {...passwordMessage} /> : null}

          <div className="flex justify-end">
            <Button type="submit" disabled={passwordMutation.isPending}>
              {passwordMutation.isPending ? 'Updating...' : 'Update password'}
            </Button>
          </div>
        </form>
      </SettingsCard>
    </div>
  )
}
