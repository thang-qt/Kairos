import { MessageStatus } from './message-status'

type BackendStatusMessageProps = {
  state: 'checking' | 'error'
  error?: string | null
  onRetry?: () => void
  className?: string
}

export function BackendStatusMessage({
  state,
  error,
  onRetry,
  className,
}: BackendStatusMessageProps) {
  const isChecking = state === 'checking'
  const title = isChecking
    ? 'Checking chat backend...'
    : 'Chat backend is unavailable'
  const description = isChecking
    ? 'Kairos is verifying the configured chat backend.'
    : ''
  return (
    <MessageStatus
      title={title}
      description={
        isChecking ? (
          description
        ) : (
          <>
            The current chat backend did not respond. Retry the request or
            check service availability.
          </>
        )
      }
      detail={isChecking ? null : error}
      actionLabel={isChecking ? undefined : 'Retry'}
      onAction={isChecking ? undefined : onRetry}
      className={className}
    />
  )
}
