import { useState } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  Copy01Icon,
  CopyLinkIcon,
  Delete01Icon,
  PencilEdit02Icon,
  Tick02Icon,
} from '@hugeicons/core-free-icons'
import { MessageTimestamp } from './message-timestamp'
import {
  TooltipContent,
  TooltipProvider,
  TooltipRoot,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

type MessageActionsBarProps = {
  text: string
  align: 'start' | 'end'
  timestamp: number
  showTimestamp?: boolean
  forceVisible?: boolean
  available?: boolean
  onClone?: () => void
  onEdit?: () => void
  onDelete?: () => void
}

export function MessageActionsBar({
  text,
  align,
  timestamp,
  showTimestamp = true,
  forceVisible = false,
  available = true,
  onClone,
  onEdit,
  onDelete,
}: MessageActionsBarProps) {
  const [copied, setCopied] = useState(false)

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1400)
    } catch {
      setCopied(false)
    }
  }

  const positionClass = align === 'end' ? 'justify-end' : 'justify-start'

  return (
    <div
      aria-hidden={!available}
      data-message-actions-available={available}
      inert={!available}
      className={cn(
        'flex items-center gap-2 text-xs text-primary-600 transition-opacity duration-150 ease-out',
        positionClass,
        !available && 'pointer-events-none opacity-0',
      )}
    >
      <div
        className={cn(
          'flex items-center gap-2 transition-opacity duration-100 ease-out',
          available && 'group-hover:opacity-100 group-focus-within:opacity-100',
          available && forceVisible ? 'opacity-100' : 'opacity-0',
        )}
      >
        <TooltipProvider>
          <TooltipRoot>
            <TooltipTrigger
              type="button"
              onClick={() => {
                handleCopy().catch(() => {})
              }}
              className="inline-flex items-center justify-center rounded border border-transparent bg-transparent p-1 text-primary-700 hover:bg-primary-100 hover:text-primary-900"
            >
              <HugeiconsIcon
                icon={copied ? Tick02Icon : Copy01Icon}
                size={16}
                strokeWidth={1.6}
              />
            </TooltipTrigger>
            <TooltipContent side="top">Copy</TooltipContent>
          </TooltipRoot>
        </TooltipProvider>
        {onClone ? (
          <TooltipProvider>
            <TooltipRoot>
              <TooltipTrigger
                type="button"
                onClick={onClone}
                className="inline-flex items-center justify-center rounded border border-transparent bg-transparent p-1 text-primary-700 hover:bg-primary-100 hover:text-primary-900"
              >
                <HugeiconsIcon
                  icon={CopyLinkIcon}
                  size={16}
                  strokeWidth={1.6}
                />
              </TooltipTrigger>
              <TooltipContent side="top">Clone</TooltipContent>
            </TooltipRoot>
          </TooltipProvider>
        ) : null}
        {onEdit ? (
          <TooltipProvider>
            <TooltipRoot>
              <TooltipTrigger
                type="button"
                onClick={onEdit}
                className="inline-flex items-center justify-center rounded border border-transparent bg-transparent p-1 text-primary-700 hover:bg-primary-100 hover:text-primary-900"
              >
                <HugeiconsIcon
                  icon={PencilEdit02Icon}
                  size={16}
                  strokeWidth={1.6}
                />
              </TooltipTrigger>
              <TooltipContent side="top">Edit</TooltipContent>
            </TooltipRoot>
          </TooltipProvider>
        ) : null}
        {onDelete ? (
          <TooltipProvider>
            <TooltipRoot>
              <TooltipTrigger
                type="button"
                onClick={onDelete}
                className="inline-flex items-center justify-center rounded border border-transparent bg-transparent p-1 text-primary-700 hover:bg-primary-100 hover:text-primary-900"
              >
                <HugeiconsIcon
                  icon={Delete01Icon}
                  size={16}
                  strokeWidth={1.6}
                />
              </TooltipTrigger>
              <TooltipContent side="top">Delete</TooltipContent>
            </TooltipRoot>
          </TooltipProvider>
        ) : null}
        {showTimestamp ? <MessageTimestamp timestamp={timestamp} /> : null}
      </div>
    </div>
  )
}
