import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { ChangeEvent, FormEvent } from 'react'
import {
  ApiError,
  appQueryKeys,
  changeEmail,
  changePassword,
  useCurrentUserQuery,
} from '@/lib/app-api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useNavigate } from '@tanstack/react-router'
import { getShell } from '@/lib/shell'
import {
  SettingsField,
  SettingsNotice,
  SettingsPage,
  SettingsRow,
  SettingsSection,
} from './settings-layout'

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

function readInputValue(value: unknown) {
  if (typeof value === 'string') {
    return value
  }
  if (
    value &&
    typeof value === 'object' &&
    'currentTarget' in value &&
    value.currentTarget &&
    typeof value.currentTarget === 'object' &&
    'value' in value.currentTarget &&
    typeof value.currentTarget.value === 'string'
  ) {
    return value.currentTarget.value
  }
  if (
    value &&
    typeof value === 'object' &&
    'target' in value &&
    value.target &&
    typeof value.target === 'object' &&
    'value' in value.target &&
    typeof value.target.value === 'string'
  ) {
    return value.target.value
  }
  return ''
}

export function AccountSettingsPanel() {
  const shell = getShell()
  const navigate = useNavigate()
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
    <SettingsPage
      title="Account"
      description="Your sign-in details. Changing your password signs out your other sessions."
    >
      {shell.canChangeServer ? (
        <SettingsSection>
          <SettingsRow label="Server">
            <span className="max-w-64 min-w-0 truncate text-sm text-primary-700">
              {shell.server ? new URL(shell.server).host : 'Not configured'}
            </span>
            <Button
              size="sm"
              variant="ghost"
              onClick={function changeServer() {
                void navigate({ to: '/connect' })
              }}
            >
              Change
            </Button>
          </SettingsRow>
        </SettingsSection>
      ) : null}
      <SettingsSection title="Profile">
        <SettingsRow label="Email" description="Used to sign in.">
          <span className="truncate text-sm tabular-nums text-primary-700">
            {currentEmail || 'Loading…'}
          </span>
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title="Change email">
        <form
          className="flex flex-col gap-4 p-4"
          onSubmit={function handleSubmit(event: FormEvent<HTMLFormElement>) {
            event.preventDefault()
            setEmailMessage(null)

            const trimmedEmail = readInputValue(nextEmail).trim()
            if (!trimmedEmail) {
              setEmailMessage({
                tone: 'error',
                message: 'Enter a new email address.',
              })
              return
            }
            if (!readInputValue(emailPassword)) {
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
          <div className="grid gap-4 sm:grid-cols-2">
            <SettingsField label="New email" htmlFor="next-email">
              <Input
                id="next-email"
                nativeInput
                type="email"
                autoComplete="email"
                placeholder={currentEmail || 'name@example.com'}
                value={nextEmail}
                onChange={function handleChange(
                  event: ChangeEvent<HTMLInputElement>,
                ) {
                  setNextEmail(readInputValue(event))
                }}
              />
            </SettingsField>
            <SettingsField
              label="Current password"
              htmlFor="confirm-email-password"
            >
              <Input
                id="confirm-email-password"
                nativeInput
                type="password"
                autoComplete="current-password"
                value={emailPassword}
                onChange={function handleChange(
                  event: ChangeEvent<HTMLInputElement>,
                ) {
                  setEmailPassword(readInputValue(event))
                }}
              />
            </SettingsField>
          </div>

          {emailMessage ? (
            <SettingsNotice tone={emailMessage.tone}>
              {emailMessage.message}
            </SettingsNotice>
          ) : null}

          <div className="flex justify-end">
            <Button type="submit" size="sm" disabled={emailMutation.isPending}>
              {emailMutation.isPending ? 'Updating…' : 'Update email'}
            </Button>
          </div>
        </form>
      </SettingsSection>

      <SettingsSection title="Change password">
        <form
          className="flex flex-col gap-4 p-4"
          onSubmit={function handleSubmit(event: FormEvent<HTMLFormElement>) {
            event.preventDefault()
            setPasswordMessage(null)

            if (!readInputValue(currentPassword)) {
              setPasswordMessage({
                tone: 'error',
                message: 'Enter your current password.',
              })
              return
            }
            const normalizedNewPassword = readInputValue(newPassword)
            const normalizedConfirmPassword = readInputValue(confirmPassword)
            if (!normalizedNewPassword) {
              setPasswordMessage({
                tone: 'error',
                message: 'Enter a new password.',
              })
              return
            }
            if (normalizedNewPassword !== normalizedConfirmPassword) {
              setPasswordMessage({
                tone: 'error',
                message: 'New passwords do not match.',
              })
              return
            }

            passwordMutation.mutate({
              currentPassword: readInputValue(currentPassword),
              newPassword: normalizedNewPassword,
            })
          }}
        >
          <SettingsField label="Current password" htmlFor="current-password">
            <Input
              id="current-password"
              nativeInput
              type="password"
              autoComplete="current-password"
              value={currentPassword}
              onChange={function handleChange(
                event: ChangeEvent<HTMLInputElement>,
              ) {
                setCurrentPassword(readInputValue(event))
              }}
            />
          </SettingsField>
          <div className="grid gap-4 sm:grid-cols-2">
            <SettingsField label="New password" htmlFor="new-password">
              <Input
                id="new-password"
                nativeInput
                type="password"
                autoComplete="new-password"
                value={newPassword}
                onChange={function handleChange(
                  event: ChangeEvent<HTMLInputElement>,
                ) {
                  setNewPassword(readInputValue(event))
                }}
              />
            </SettingsField>
            <SettingsField
              label="Confirm new password"
              htmlFor="confirm-new-password"
            >
              <Input
                id="confirm-new-password"
                nativeInput
                type="password"
                autoComplete="new-password"
                value={confirmPassword}
                onChange={function handleChange(
                  event: ChangeEvent<HTMLInputElement>,
                ) {
                  setConfirmPassword(readInputValue(event))
                }}
              />
            </SettingsField>
          </div>

          {passwordMessage ? (
            <SettingsNotice tone={passwordMessage.tone}>
              {passwordMessage.message}
            </SettingsNotice>
          ) : null}

          <div className="flex justify-end">
            <Button
              type="submit"
              size="sm"
              disabled={passwordMutation.isPending}
            >
              {passwordMutation.isPending ? 'Updating…' : 'Update password'}
            </Button>
          </div>
        </form>
      </SettingsSection>
    </SettingsPage>
  )
}
