import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useShortcut } from '@/lib/use-shortcut'
import { ShortcutsHelpDialog } from '@/features/chat/components/shortcuts-help-dialog'

export function GlobalShortcuts({
  onToggleSidebar,
}: {
  onToggleSidebar: () => void
}) {
  const navigate = useNavigate()
  const [helpOpen, setHelpOpen] = useState(false)
  function openHelp(event: KeyboardEvent) {
    event.preventDefault()
    setHelpOpen(true)
  }
  useShortcut('help', openHelp)
  useShortcut('help', openHelp, true, 1)
  useShortcut('settings', function openSettings(event) {
    event.preventDefault()
    void navigate({ to: '/settings' })
  })
  useShortcut('sidebar', function toggleSidebar(event) {
    event.preventDefault()
    onToggleSidebar()
  })
  return <ShortcutsHelpDialog open={helpOpen} onOpenChange={setHelpOpen} />
}
