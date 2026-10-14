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
import { MessageActionsSheetTrigger } from './message-actions-sheet'
import {
  TooltipContent,
  TooltipProvider,
  TooltipRoot,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { shortcutTooltip } from '@/lib/shortcuts'

type MessageActionsBarProps = {
  text: string
  align: 'start' | 'end'
  timestamp: number
  showTimestamp?: boolean
  forceVisible?: boolean
  available?: boolean
  onClone?: () => void
  editShortcut?: boolean
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
  editShortcut = false,
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

  function copyMessage() {
    handleCopy().catch(() => {})
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
          available &&
            'group-hover:opacity-100 group-hover:pointer-events-auto group-focus-within:opacity-100 group-focus-within:pointer-events-auto',
          available && forceVisible
            ? 'pointer-events-auto opacity-100'
            : 'pointer-events-none opacity-0',
          align === 'end'
            ? 'pointer-coarse:hidden'
            : available &&
                'pointer-coarse:opacity-100 pointer-coarse:pointer-events-auto',
        )}
      >
        <TooltipProvider>
          <TooltipRoot>
            <TooltipTrigger
              type="button"
              onClick={copyMessage}
              aria-label="Copy message"
              className="inline-flex items-center justify-center rounded border border-transparent bg-transparent p-1 pointer-coarse:size-10 text-primary-700 hover:bg-primary-100 hover:text-primary-900"
            >
              <HugeiconsIcon
                icon={copied ? Tick02Icon : Copy01Icon}
                size={20}
                strokeWidth={1.5}
              />
            </TooltipTrigger>
            <TooltipContent side="top">
              {align === 'start' && forceVisible
                ? shortcutTooltip('Copy', 'copyResponse')
                : 'Copy'}
            </TooltipContent>
          </TooltipRoot>
        </TooltipProvider>
        {onClone ? (
          <TooltipProvider>
            <TooltipRoot>
              <TooltipTrigger
                type="button"
                onClick={onClone}
                aria-label="Clone message"
                className="inline-flex items-center justify-center rounded border border-transparent bg-transparent p-1 pointer-coarse:size-10 text-primary-700 hover:bg-primary-100 hover:text-primary-900"
              >
                <HugeiconsIcon
                  icon={CopyLinkIcon}
                  size={20}
                  strokeWidth={1.5}
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
                data-edit-user-message
                aria-label="Edit message"
                onClick={onEdit}
                className="inline-flex items-center justify-center rounded border border-transparent bg-transparent p-1 pointer-coarse:size-10 text-primary-700 hover:bg-primary-100 hover:text-primary-900"
              >
                <HugeiconsIcon
                  icon={PencilEdit02Icon}
                  size={20}
                  strokeWidth={1.5}
                />
              </TooltipTrigger>
              <TooltipContent side="top">
                {editShortcut
                  ? shortcutTooltip('Edit (empty composer)', 'editLastMessage')
                  : 'Edit'}
              </TooltipContent>
            </TooltipRoot>
          </TooltipProvider>
        ) : null}
        {onDelete ? (
          <TooltipProvider>
            <TooltipRoot>
              <TooltipTrigger
                type="button"
                onClick={onDelete}
                aria-label="Delete message"
                className="inline-flex items-center justify-center rounded border border-transparent bg-transparent p-1 pointer-coarse:size-10 text-primary-700 hover:bg-primary-100 hover:text-primary-900"
              >
                <HugeiconsIcon
                  icon={Delete01Icon}
                  size={20}
                  strokeWidth={1.5}
                />
              </TooltipTrigger>
              <TooltipContent side="top">Delete</TooltipContent>
            </TooltipRoot>
          </TooltipProvider>
        ) : null}
        {showTimestamp ? <MessageTimestamp timestamp={timestamp} /> : null}
      </div>
      {align === 'end' ? (
        <div className="hidden items-center gap-2 tabular-nums pointer-coarse:flex pointer-fine:hidden">
          {showTimestamp ? <MessageTimestamp timestamp={timestamp} /> : null}
          <MessageActionsSheetTrigger
            onCopy={copyMessage}
            onEdit={onEdit}
            onClone={onClone}
            onDelete={onDelete}
          />
        </div>
      ) : null}
    </div>
  )
}
