import { DesktopCloseButton } from '@/components/desktop-close-button'
import { isDesktopShell } from '@/lib/desktop-bridge'

export function DesktopWindowBar() {
  if (!isDesktopShell()) return null
  return (
    <div className="app-drag fixed inset-x-0 top-0 z-50 flex h-10 items-center justify-end px-4">
      <DesktopCloseButton />
    </div>
  )
}
