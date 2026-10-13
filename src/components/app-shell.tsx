import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

// Matches the w-[300px] sidebar containers below.
const SIDEBAR_WIDTH = 300

type AppShellProps = {
  isMobile: boolean
  isSidebarCollapsed: boolean
  onCloseSidebar?: () => void
  sidebar: ReactNode
  header: ReactNode
  children: ReactNode
  rightSidebar?: ReactNode
  // Width of the open right panel, or 0 when none is open.
  rightPanelWidth?: number
  mainRef?: React.Ref<HTMLDivElement>
  hideChrome?: boolean
}

// Sidebars are fixed-width overlays that slide with transforms, so their
// contents never relayout while animating. The main column's edges ease to
// match.
export function AppShell({
  isMobile,
  isSidebarCollapsed,
  onCloseSidebar,
  sidebar,
  header,
  children,
  rightSidebar,
  rightPanelWidth = 0,
  mainRef,
  hideChrome = false,
}: AppShellProps) {
  const sidebarOpen = !hideChrome && !isSidebarCollapsed
  const desktopChrome = !isMobile && !hideChrome
  const leftInset = desktopChrome && sidebarOpen ? SIDEBAR_WIDTH : 0
  const rightInset = desktopChrome ? rightPanelWidth : 0
  // While any sidebar is open the main column floats as a rounded card inside
  // the sidebar-colored frame, so the sidebars read as surrounding it.
  const insetMain = leftInset > 0 || rightInset > 0

  return (
    <div
      className={cn(
        'relative h-screen overflow-hidden text-primary-900',
        desktopChrome ? 'bg-primary-100' : 'bg-surface',
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
              sidebarOpen
                ? 'pointer-events-auto opacity-100'
                : 'pointer-events-none opacity-0',
            )}
          />
          <div
            inert={!sidebarOpen}
            className={cn(
              'fixed inset-y-0 left-0 z-50 w-[300px] transition-transform duration-200 ease-out',
              sidebarOpen ? 'translate-x-0' : '-translate-x-full',
            )}
          >
            {sidebar}
          </div>
        </>
      ) : (
        <div
          inert={!sidebarOpen}
          className={cn(
            'absolute inset-y-0 left-0 z-20 w-[300px] transition-transform duration-200 ease-out',
            sidebarOpen ? 'translate-x-0' : '-translate-x-full',
          )}
        >
          {sidebar}
        </div>
      )}

      <div
        className={cn(
          // The edges and the 8px inset ease in step with the sidebar slide, so
          // the main column grows into (or yields) the sidebar's space. The
          // chat column inside is max-width and centered, so on wide windows
          // the per-frame relayout only re-centers it rather than re-wrapping.
          'absolute inset-y-0 isolate flex transition-[left,right,padding] duration-200 ease-out',
          insetMain && 'py-2 pr-2',
          insetMain && leftInset === 0 && 'pl-2',
        )}
        style={{ left: leftInset, right: rightInset }}
      >
        <main
          className={cn(
            'relative flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden border bg-surface transition-[border-radius,border-color,box-shadow] duration-200 ease-out',
            insetMain
              ? 'rounded-xl border-primary-200 shadow-xs/5'
              : 'rounded-none border-transparent',
          )}
          ref={mainRef}
        >
          <div
            className="pointer-events-none absolute left-0 right-0 top-0 z-10"
            style={{
              height: 80,
              // Denser than a linear fade behind the 48px header (~80% at its
              // bottom edge) so scrolled text recedes without a solid band.
              background:
                'linear-gradient(to bottom, var(--color-surface) 0%, color-mix(in oklab, var(--color-surface) 93%, transparent) 35%, color-mix(in oklab, var(--color-surface) 80%, transparent) 60%, transparent 100%)',
            }}
          >
            <div className="pointer-events-auto">{header}</div>
          </div>

          {children}
        </main>
      </div>

      {hideChrome ? null : rightSidebar}
    </div>
  )
}
