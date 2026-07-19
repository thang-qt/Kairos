import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

type AppShellProps = {
  isMobile: boolean
  isSidebarCollapsed: boolean
  onCloseSidebar?: () => void
  sidebar: ReactNode
  header: ReactNode
  children: ReactNode
  rightSidebar?: ReactNode
  mainRef?: React.Ref<HTMLDivElement>
  hideChrome?: boolean
}

export function AppShell({
  isMobile,
  isSidebarCollapsed,
  onCloseSidebar,
  sidebar,
  header,
  children,
  rightSidebar,
  mainRef,
  hideChrome = false,
}: AppShellProps) {
  const hasRightSidebar = rightSidebar != null
  const showMobileSidebar = !hideChrome && isMobile && !isSidebarCollapsed

  return (
    <div className="h-screen bg-surface text-primary-900">
      <div
        className={cn(
          'h-full overflow-hidden',
          isMobile
            ? 'relative'
            : hasRightSidebar
              ? 'grid grid-cols-[auto_1fr_auto]'
              : 'grid grid-cols-[auto_1fr]',
        )}
      >
        {hideChrome ? null : isMobile ? (
          <>
            <button
              type="button"
              aria-label="Close sidebar"
              onClick={onCloseSidebar}
              className={cn(
                'fixed inset-0 z-40 bg-primary-950/10 transition-opacity',
                showMobileSidebar
                  ? 'pointer-events-auto opacity-100'
                  : 'pointer-events-none opacity-0',
              )}
            />
            <div
              className={cn(
                'fixed inset-y-0 left-0 z-50 w-[300px] transition-transform duration-200',
                showMobileSidebar ? 'translate-x-0' : '-translate-x-full',
              )}
            >
              {sidebar}
            </div>
          </>
        ) : (
          sidebar
        )}

        <main className="relative flex h-full min-h-0 flex-col" ref={mainRef}>
          <div
            className="pointer-events-none absolute left-0 right-0 top-0 z-10"
            style={{
              height: 80,
              background:
                'linear-gradient(to bottom, var(--color-surface), transparent)',
            }}
          >
            <div className="pointer-events-auto">{header}</div>
          </div>

          {children}
        </main>

        {hideChrome ? null : rightSidebar}
      </div>
    </div>
  )
}
