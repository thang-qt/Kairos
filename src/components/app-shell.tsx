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
  const showMobileSidebar = !hideChrome && isMobile && !isSidebarCollapsed
  // On desktop the main column floats as a rounded card inside the
  // sidebar-colored frame, so the sidebars read as surrounding it.
  const insetMain = !isMobile && !hideChrome

  return (
    <div
      className={cn(
        'h-screen text-primary-900',
        insetMain ? 'bg-primary-100' : 'bg-surface',
      )}
    >
      <div
        className={cn('h-full overflow-hidden', isMobile ? 'relative' : 'flex')}
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

        <div
          className={cn(
            'flex h-full min-w-0 flex-1',
            insetMain && 'py-2 pr-2 transition-[padding] duration-150',
            insetMain && isSidebarCollapsed && 'pl-2',
          )}
        >
          <main
            className={cn(
              'relative flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-surface',
              insetMain && 'rounded-xl border border-primary-200 shadow-xs/5',
            )}
            ref={mainRef}
          >
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
        </div>

        {hideChrome ? null : rightSidebar}
      </div>
    </div>
  )
}
