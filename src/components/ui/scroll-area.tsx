'use client'

import { ScrollArea } from '@base-ui/react/scroll-area'
import { cn } from '@/lib/utils'

type ScrollAreaRootProps = React.ComponentProps<typeof ScrollArea.Root>

function ScrollAreaRoot({ className, ...props }: ScrollAreaRootProps) {
  return (
    <ScrollArea.Root
      className={cn(
        'group/scroll-area relative outline-none focus-visible:outline-none',
        className,
      )}
      {...props}
    />
  )
}

type ScrollAreaViewportProps = React.ComponentProps<typeof ScrollArea.Viewport>

function ScrollAreaViewport({ className, ...props }: ScrollAreaViewportProps) {
  return (
    <ScrollArea.Viewport
      className={cn(
        'h-full w-full outline-none focus-visible:outline-none',
        className,
      )}
      {...props}
    />
  )
}

type ScrollAreaScrollbarProps = React.ComponentProps<
  typeof ScrollArea.Scrollbar
>

function ScrollAreaScrollbar({
  className,
  ...props
}: ScrollAreaScrollbarProps) {
  return (
    <ScrollArea.Scrollbar
      className={cn(
        'z-20 flex w-2 touch-none select-none p-0.5 outline-none focus-visible:outline-none',
        'opacity-0 transition-opacity duration-150',
        'data-hovering:opacity-100 data-scrolling:opacity-100 group-hover/scroll-area:opacity-100',
        className,
      )}
      {...props}
    />
  )
}

type ScrollAreaThumbProps = React.ComponentProps<typeof ScrollArea.Thumb>

function ScrollAreaThumb({ className, ...props }: ScrollAreaThumbProps) {
  return (
    <ScrollArea.Thumb
      className={cn(
        'flex-1 rounded-full bg-primary-500 outline-none focus-visible:outline-none',
        className,
      )}
      {...props}
    />
  )
}

type ScrollAreaCornerProps = React.ComponentProps<typeof ScrollArea.Corner>

function ScrollAreaCorner({ className, ...props }: ScrollAreaCornerProps) {
  return (
    <ScrollArea.Corner
      className={cn(
        'z-20 bg-primary-100 outline-none focus-visible:outline-none',
        className,
      )}
      {...props}
    />
  )
}

// A vertical scroll region with the app's overlay scrollbar, for panels that
// would otherwise use `overflow-y-auto`. `className` sizes the region;
// `viewportClassName` styles the scrolling element (padding, list layout).
function ScrollPanel({
  className,
  viewportClassName,
  children,
}: {
  className?: string
  viewportClassName?: string
  children: React.ReactNode
}) {
  return (
    <ScrollAreaRoot className={cn('min-h-0', className)}>
      <ScrollAreaViewport className={viewportClassName}>
        {children}
      </ScrollAreaViewport>
      <ScrollAreaScrollbar orientation="vertical">
        <ScrollAreaThumb />
      </ScrollAreaScrollbar>
    </ScrollAreaRoot>
  )
}

export {
  ScrollPanel,
  ScrollAreaRoot,
  ScrollAreaViewport,
  ScrollAreaScrollbar,
  ScrollAreaThumb,
  ScrollAreaCorner,
}
