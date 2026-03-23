import { useState } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  ArrowLeft01Icon,
  ArrowRight01Icon,
  Copy01Icon,
  Delete01Icon,
  GitBranchIcon,
  PencilEdit02Icon,
  Tick02Icon,
} from '@hugeicons/core-free-icons'
import { MessageTimestamp } from './message-timestamp'
import type { BranchNavigatorState } from './branch-inline-navigator'
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
  forceVisible?: boolean
  onFork?: () => void
  onEdit?: () => void
  onDelete?: () => void
  branchState?: BranchNavigatorState
  onSelectBranch?: (friendlyId: string) => void
}

export function MessageActionsBar({
  text,
  align,
  timestamp,
  forceVisible = false,
  onFork,
  onEdit,
  onDelete,
  branchState,
  onSelectBranch,
}: MessageActionsBarProps) {
  const [copied, setCopied] = useState(false)
  const currentBranchIndex = branchState
    ? Math.max(
        0,
        branchState.options.findIndex(
          (option) => option.friendlyId === branchState.activeFriendlyId,
        ),
      )
    : -1
  const currentBranchTitle =
    branchState && currentBranchIndex >= 0
      ? branchState.options[currentBranchIndex]?.title
      : undefined
  const hasMultipleBranches =
    branchState !== undefined && branchState.options.length > 1

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1400)
    } catch {
      setCopied(false)
    }
  }

  function handleSelectRelativeBranch(offset: number) {
    if (!branchState || !onSelectBranch || !hasMultipleBranches) return
    const nextIndex =
      (currentBranchIndex + offset + branchState.options.length) %
      branchState.options.length
    const nextBranch = branchState.options[nextIndex]
    if (nextBranch.friendlyId !== branchState.activeFriendlyId) {
      onSelectBranch(nextBranch.friendlyId)
    }
  }

  const positionClass = align === 'end' ? 'justify-end' : 'justify-start'

  return (
    <div
      className={cn(
        'flex items-center gap-2 text-xs text-primary-600',
        positionClass,
      )}
    >
      {branchState ? (
        <div className="inline-flex items-center gap-1 rounded-full border border-primary-200 bg-primary-50 px-1.5 py-0.5 text-primary-700">
          <TooltipProvider>
            <TooltipRoot>
              <TooltipTrigger
                type="button"
                onClick={() => handleSelectRelativeBranch(-1)}
                disabled={!hasMultipleBranches}
                className="inline-flex items-center justify-center rounded-full p-0.5 text-primary-700 hover:bg-primary-100 disabled:opacity-50"
              >
                <HugeiconsIcon
                  icon={ArrowLeft01Icon}
                  size={14}
                  strokeWidth={1.5}
                />
              </TooltipTrigger>
              <TooltipContent side="top">Previous branch</TooltipContent>
            </TooltipRoot>
          </TooltipProvider>
          <TooltipProvider>
            <TooltipRoot>
              <TooltipTrigger
                type="button"
                className="inline-flex items-center gap-1 rounded-full px-1 py-0.5 text-primary-700"
              >
                <HugeiconsIcon
                  icon={GitBranchIcon}
                  size={14}
                  strokeWidth={1.5}
                />
                <span className="tabular-nums">
                  {currentBranchIndex + 1}/{branchState.options.length}
                </span>
              </TooltipTrigger>
              <TooltipContent side="top">
                {currentBranchTitle ?? 'Branch'}
              </TooltipContent>
            </TooltipRoot>
          </TooltipProvider>
          <TooltipProvider>
            <TooltipRoot>
              <TooltipTrigger
                type="button"
                onClick={() => handleSelectRelativeBranch(1)}
                disabled={!hasMultipleBranches}
                className="inline-flex items-center justify-center rounded-full p-0.5 text-primary-700 hover:bg-primary-100 disabled:opacity-50"
              >
                <HugeiconsIcon
                  icon={ArrowRight01Icon}
                  size={14}
                  strokeWidth={1.5}
                />
              </TooltipTrigger>
              <TooltipContent side="top">Next branch</TooltipContent>
            </TooltipRoot>
          </TooltipProvider>
        </div>
      ) : null}
      <div
        className={cn(
          'flex items-center gap-2 transition-opacity duration-100 ease-out group-hover:opacity-100 group-focus-within:opacity-100',
          forceVisible ? 'opacity-100' : 'opacity-0',
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
        {onFork ? (
          <TooltipProvider>
            <TooltipRoot>
              <TooltipTrigger
                type="button"
                onClick={onFork}
                className="inline-flex items-center justify-center rounded border border-transparent bg-transparent p-1 text-primary-700 hover:bg-primary-100 hover:text-primary-900"
              >
                <HugeiconsIcon
                  icon={GitBranchIcon}
                  size={16}
                  strokeWidth={1.6}
                />
              </TooltipTrigger>
              <TooltipContent side="top">Fork</TooltipContent>
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
        <MessageTimestamp timestamp={timestamp} />
      </div>
    </div>
  )
}
