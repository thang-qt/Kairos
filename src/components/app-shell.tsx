import { useRef, useState, useSyncExternalStore } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { SidebarResizeHandle } from './sidebar-resize-handle'
import { cn } from '@/lib/utils'

const SIDEBAR_WIDTH = 300
const WIDTHS_STORAGE_KEY = 'kairos-sidebar-widths'
function subscribeViewport(onChange: () => void) {
  window.addEventListener('resize', onChange)
  return function unsubscribe() {
    window.removeEventListener('resize', onChange)
  }
}
function getViewportWidth() {
  return window.innerWidth
}
function getServerViewportWidth() {
  return 1280
}

type SidebarWidths = { left: number; right?: number }

function readWidths(): SidebarWidths {
  try {
    const stored = JSON.parse(
      localStorage.getItem(WIDTHS_STORAGE_KEY) ?? '{}',
    ) as Partial<SidebarWidths>
    return {
      left:
        typeof stored.left === 'number' && Number.isFinite(stored.left)
          ? Math.min(480, Math.max(240, stored.left))
          : SIDEBAR_WIDTH,
      right:
        typeof stored.right === 'number' && Number.isFinite(stored.right)
          ? Math.min(560, Math.max(260, stored.right))
          : undefined,
    }
  } catch {
    return { left: SIDEBAR_WIDTH }
  }
}

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

// Sidebars slide with transforms while the main column eases to match.
// Width changes stay local to this shell while dragging.
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
  const viewportWidth = useSyncExternalStore(
    subscribeViewport,
    getViewportWidth,
    getServerViewportWidth,
  )
  const [resizing, setResizing] = useState(false)
  const lastRightDefault = useRef(rightPanelWidth || 280)
  if (rightPanelWidth > 0) lastRightDefault.current = rightPanelWidth
  const [widths, setWidths] = useState(readWidths)
  const widthsRef = useRef(widths)
  function changeWidth(side: 'left' | 'right', width: number | undefined) {
    const next = {
      ...widthsRef.current,
      ...(scale < 1
        ? {
            left: leftWidth,
            right: rightOpen ? rightWidth : widthsRef.current.right,
          }
        : {}),
      [side]: width,
    }
    widthsRef.current = next
    setWidths(next)
  }
  function persistWidths() {
    try {
      localStorage.setItem(
        WIDTHS_STORAGE_KEY,
        JSON.stringify(widthsRef.current),
      )
    } catch {
      // Resizing still works when browser storage is unavailable.
    }
  }
  function resetWidth(side: 'left' | 'right') {
    changeWidth(side, side === 'left' ? SIDEBAR_WIDTH : undefined)
    persistWidths()
  }
  const sidebarOpen = !hideChrome && !isSidebarCollapsed
  const desktopChrome = !isMobile && !hideChrome
  const rightOpen = rightPanelWidth > 0
  const preferredRight = widths.right ?? lastRightDefault.current
  const available = Math.max(0, viewportWidth - 320)
  const total =
    (sidebarOpen ? widths.left : 0) + (rightOpen ? preferredRight : 0)
  const scale = total > available && total > 0 ? available / total : 1
  const leftWidth = Math.round(
    sidebarOpen ? widths.left * scale : Math.min(widths.left, available),
  )
  const rightWidth = Math.round(
    rightOpen ? preferredRight * scale : Math.min(preferredRight, available),
  )
  const leftInset = desktopChrome && sidebarOpen ? leftWidth : 0
  const rightInset = desktopChrome && rightOpen ? rightWidth : 0
  const leftMaximum = Math.min(480, Math.max(0, available - rightInset))
  const rightMaximum = Math.min(560, Math.max(0, available - leftInset))
  // Keep the desktop main column inset even when both sidebars are closed.
  const insetMain = desktopChrome

  return (
    <div
      data-shell-top={insetMain ? 'frame' : 'surface'}
      style={
        {
          '--left-sidebar-width': `${leftWidth}px`,
          '--right-sidebar-width': `${rightWidth}px`,
        } as CSSProperties
      }
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
            'absolute inset-y-0 left-0 z-20 w-(--left-sidebar-width) transition-transform duration-200 ease-out',
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
          'absolute inset-y-0 isolate flex duration-200 ease-out',
          resizing ? 'transition-none' : 'transition-[left,right,padding]',
          insetMain && 'py-2 pr-2',
          insetMain && leftInset === 0 && 'pl-2',
        )}
        style={{
          left: leftInset,
          right: rightInset,
        }}
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
            className="pointer-events-none absolute left-0 right-0 top-0 z-10 h-12"
            style={{
              // Matches the 48px header so scrolled text recedes without a solid band
              // and does not fade content below the topbar.
              background:
                'linear-gradient(to bottom, var(--color-surface) 0%, color-mix(in oklab, var(--color-surface) 93%, transparent) 65%, color-mix(in oklab, var(--color-surface) 80%, transparent) 85%, transparent 100%)',
            }}
          >
            <div className="pointer-events-auto">{header}</div>
          </div>

          {children}
        </main>
        {desktopChrome && sidebarOpen ? (
          <SidebarResizeHandle
            side="left"
            width={leftWidth}
            maximum={leftMaximum}
            onResizingChange={setResizing}
            onChange={function resizeLeft(width) {
              changeWidth('left', width)
            }}
            onCommit={persistWidths}
            onReset={function resetLeft() {
              resetWidth('left')
            }}
          />
        ) : null}
        {desktopChrome && rightInset > 0 ? (
          <SidebarResizeHandle
            side="right"
            width={rightWidth}
            maximum={rightMaximum}
            onResizingChange={setResizing}
            onChange={function resizeRight(width) {
              changeWidth('right', width)
            }}
            onCommit={persistWidths}
            onReset={function resetRight() {
              resetWidth('right')
            }}
          />
        ) : null}
      </div>

      {hideChrome ? null : rightSidebar}
    </div>
  )
}
