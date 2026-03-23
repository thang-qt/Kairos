import { memo } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  ArrowLeft01Icon,
  ArrowRight01Icon,
  GitBranchIcon,
} from '@hugeicons/core-free-icons'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export type BranchNavigatorOption = {
  friendlyId: string
  title: string
}

export type BranchNavigatorState = {
  messageId: string
  activeFriendlyId: string
  options: Array<BranchNavigatorOption>
}

type BranchInlineNavigatorProps = {
  branchState: BranchNavigatorState
  onSelectBranch: (friendlyId: string) => void
}

function BranchInlineNavigatorComponent({
  branchState,
  onSelectBranch,
}: BranchInlineNavigatorProps) {
  const currentIndex = Math.max(
    0,
    branchState.options.findIndex(
      (option) => option.friendlyId === branchState.activeFriendlyId,
    ),
  )
  const currentOption = branchState.options[currentIndex]
  const hasMultiple = branchState.options.length > 1

  function selectRelative(offset: number) {
    if (!hasMultiple) return
    const nextIndex =
      (currentIndex + offset + branchState.options.length) %
      branchState.options.length
    const nextOption = branchState.options[nextIndex]
    if (nextOption.friendlyId !== branchState.activeFriendlyId) {
      onSelectBranch(nextOption.friendlyId)
    }
  }

  return (
    <div className="mt-2 inline-flex max-w-full items-center gap-2 rounded-full border border-primary-200 bg-primary-50/90 px-2 py-1 text-xs text-primary-700 backdrop-blur-sm">
      <HugeiconsIcon icon={GitBranchIcon} size={16} strokeWidth={1.5} />
      <span className="tabular-nums text-primary-500">
        {currentIndex + 1}/{branchState.options.length}
      </span>
      <span className="max-w-[180px] truncate text-primary-900">
        {currentOption.title}
      </span>
      <div className="ml-1 flex items-center gap-1">
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          onClick={() => selectRelative(-1)}
          disabled={!hasMultiple}
          className={cn(
            'size-7 rounded-full text-primary-700 hover:bg-primary-100',
            !hasMultiple && 'opacity-50',
          )}
          aria-label="Previous branch"
        >
          <HugeiconsIcon icon={ArrowLeft01Icon} size={16} strokeWidth={1.5} />
        </Button>
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          onClick={() => selectRelative(1)}
          disabled={!hasMultiple}
          className={cn(
            'size-7 rounded-full text-primary-700 hover:bg-primary-100',
            !hasMultiple && 'opacity-50',
          )}
          aria-label="Next branch"
        >
          <HugeiconsIcon icon={ArrowRight01Icon} size={16} strokeWidth={1.5} />
        </Button>
      </div>
    </div>
  )
}

export const BranchInlineNavigator = memo(BranchInlineNavigatorComponent)
