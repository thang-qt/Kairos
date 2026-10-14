import { useShortcut } from '@/lib/use-shortcut'

type SessionShortcutOptions = {
  onNewSession: () => void
  onSearchSessions: () => void
  onNavigateSession?: (direction: 'up' | 'down') => void
}
export function useSessionShortcuts({
  onNewSession,
  onSearchSessions,
  onNavigateSession,
}: SessionShortcutOptions) {
  useShortcut('searchSessions', function search(event) {
    event.preventDefault()
    onSearchSessions()
  })
  useShortcut('newSession', function create(event) {
    event.preventDefault()
    onNewSession()
  })
  useShortcut('previousSession', function previous(event) {
    event.preventDefault()
    onNavigateSession?.('up')
  })
  useShortcut('nextSession', function next(event) {
    event.preventDefault()
    onNavigateSession?.('down')
  })
}
