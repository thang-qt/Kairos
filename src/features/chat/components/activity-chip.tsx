import { HugeiconsIcon } from '@hugeicons/react'
import { ArrowRight01Icon, Brain01Icon } from '@hugeicons/core-free-icons'
import { TextShimmer } from '@/components/prompt-kit/text-shimmer'
import { activityLabel } from './message-item-utils'
import { ElapsedTime } from './elapsed-time'
import { useSettledValue } from '../hooks/use-settled-value'

// The chip is a glanceable status, not a live log: each step stays up long
// enough to read and short-lived steps are skipped.
const LATEST_SETTLE = { minDwellMs: 2000, settleMs: 800 }

type ActivityChipProps = {
  streaming: boolean
  durationMs: number
  toolCount: number
  hasThinking: boolean
  startedAt?: unknown
  // Newest step while streaming, e.g. "Searching “sauna recovery”".
  latest?: string
  selected?: boolean
  onOpen?: () => void
}

export function ActivityChip({
  streaming,
  durationMs,
  toolCount,
  hasThinking,
  startedAt,
  latest,
  selected = false,
  onOpen,
}: ActivityChipProps) {
  const label = activityLabel({ streaming, toolCount, hasThinking, durationMs })
  const settledLatest = useSettledValue(latest ?? '', LATEST_SETTLE)

  return (
    <button
      type="button"
      onClick={onOpen}
      aria-pressed={selected}
      aria-label={label}
      className="group/activity -mx-2 inline-flex max-w-full items-center gap-2 rounded-lg px-2 py-1 text-sm text-primary-700 transition-colors hover:bg-primary-100"
    >
      <HugeiconsIcon
        icon={Brain01Icon}
        size={16}
        strokeWidth={1.5}
        className="shrink-0 text-primary-500"
      />
      {streaming ? (
        <TextShimmer className="min-w-0 truncate">
          {settledLatest || label}
        </TextShimmer>
      ) : (
        <span className="truncate font-medium">{label}</span>
      )}
      {streaming ? (
        <ElapsedTime
          startedAt={startedAt}
          className="shrink-0 tabular-nums text-primary-500"
        />
      ) : null}
      <HugeiconsIcon
        icon={ArrowRight01Icon}
        size={14}
        strokeWidth={1.5}
        className="shrink-0 text-primary-400 transition-transform group-hover/activity:translate-x-0.5"
      />
    </button>
  )
}
