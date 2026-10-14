import { useRef } from 'react'
import type { KeyboardEvent, PointerEvent } from 'react'
import { cn } from '@/lib/utils'

type SidebarResizeHandleProps = {
  side: 'left' | 'right'
  width: number
  maximum: number
  onResizingChange: (resizing: boolean) => void
  onChange: (width: number) => void
  onCommit: () => void
  onReset: () => void
}

export function SidebarResizeHandle({
  side,
  width,
  maximum,
  onResizingChange,
  onChange,
  onCommit,
  onReset,
}: SidebarResizeHandleProps) {
  const drag = useRef<{ pointerId: number; x: number; width: number } | null>(
    null,
  )
  const minimum = Math.min(side === 'left' ? 240 : 260, maximum)

  function resize(next: number) {
    onChange(Math.round(Math.min(maximum, Math.max(minimum, next))))
  }

  function handlePointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    drag.current = { pointerId: event.pointerId, x: event.clientX, width }
    onResizingChange(true)
  }

  function handlePointerMove(event: PointerEvent<HTMLDivElement>) {
    if (!drag.current || drag.current.pointerId !== event.pointerId) return
    resize(
      drag.current.width +
        (event.clientX - drag.current.x) * (side === 'left' ? 1 : -1),
    )
  }

  function handlePointerEnd(event: PointerEvent<HTMLDivElement>) {
    if (!drag.current || drag.current.pointerId !== event.pointerId) return
    drag.current = null
    onResizingChange(false)
    onCommit()
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault()
      const direction = event.key === 'ArrowRight' ? 1 : -1
      resize(
        width +
          direction * (side === 'left' ? 1 : -1) * (event.shiftKey ? 40 : 10),
      )
    } else if (event.key === 'Home') {
      event.preventDefault()
      resize(minimum)
    } else if (event.key === 'End') {
      event.preventDefault()
      resize(maximum)
    }
  }

  return (
    <div
      role="separator"
      aria-label={`Resize ${side} sidebar`}
      aria-orientation="vertical"
      aria-valuemin={minimum}
      aria-valuemax={maximum}
      aria-valuenow={width}
      tabIndex={0}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerEnd}
      onPointerCancel={handlePointerEnd}
      onLostPointerCapture={handlePointerEnd}
      onKeyDown={handleKeyDown}
      onKeyUp={onCommit}
      onBlur={onCommit}
      onDoubleClick={onReset}
      className={cn(
        'group absolute inset-y-5 z-30 w-2 cursor-col-resize touch-none select-none focus-visible:outline-none',
        side === 'left' ? 'left-0 -translate-x-1/2' : 'right-2 translate-x-1/2',
      )}
    >
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-primary-400 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100 group-active:opacity-100"
      />
    </div>
  )
}
