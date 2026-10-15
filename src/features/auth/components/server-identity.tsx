import { Link } from '@tanstack/react-router'
import { getShell } from '@/lib/shell'

export function ServerIdentity() {
  const shell = getShell()
  if (!shell.canChangeServer || !shell.server) return null
  return (
    <p className="flex min-w-0 items-center justify-center gap-1.5 text-pretty text-xs text-primary-600">
      <span className="truncate">{new URL(shell.server).host}</span>
      <span aria-hidden>·</span>
      <Link
        to="/connect"
        className="shrink-0 underline underline-offset-2 hover:text-primary-900"
      >
        Change
      </Link>
    </p>
  )
}
