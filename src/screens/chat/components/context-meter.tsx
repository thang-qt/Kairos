import { memo } from 'react'
import {
  PreviewCard,
  PreviewCardPopup,
  PreviewCardTrigger,
} from '@/components/ui/preview-card'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'

type ContextMeterProps = {
  usedTokens?: number
  maxTokens?: number
}

function formatTokenCount(tokens: number) {
  if (tokens >= 1000) {
    return `${(tokens / 1000).toFixed(0)}K`
  }

  return String(tokens)
}

function ContextMeterComponent({ usedTokens, maxTokens }: ContextMeterProps) {
  if (typeof maxTokens !== 'number' || maxTokens <= 0) {
    return null
  }

  const normalizedUsedTokens =
    typeof usedTokens === 'number' && usedTokens > 0 ? usedTokens : 0
  const percentage = Math.min((normalizedUsedTokens / maxTokens) * 100, 100)
  const leftPercentage = Math.max(0, 100 - percentage)
  const compactUsageLabel = `${formatTokenCount(normalizedUsedTokens)} / ${formatTokenCount(maxTokens)}`
  const usedLabel = `${compactUsageLabel} tokens used`

  return (
    <PreviewCard>
      <PreviewCardTrigger
        className={cn(
          buttonVariants({ size: 'icon-sm', variant: 'ghost' }),
          'text-primary-800 hover:bg-primary-100',
        )}
        aria-label={usedLabel}
      >
        <div className="size-4 shrink-0 text-primary-200">
          <svg
            viewBox="0 0 36 36"
            className="size-4 -rotate-90"
            aria-hidden="true"
          >
            <circle
              cx="18"
              cy="18"
              r="15.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="4"
              className="text-primary-300"
            />
            <circle
              cx="18"
              cy="18"
              r="15.5"
              fill="none"
              stroke="currentColor"
              className="text-primary-600"
              strokeWidth="4"
              strokeLinecap="round"
              strokeDasharray={`${(percentage / 100) * 97.4} 97.4`}
            />
          </svg>
        </div>
      </PreviewCardTrigger>
      <PreviewCardPopup align="end" sideOffset={0} className="w-52 px-2 py-1">
        <div className="space-y-0.5 text-xs text-primary-900">
          <div className="font-medium text-primary-950">Context window:</div>
          <div className="tabular-nums text-primary-700">
            {percentage.toFixed(0)}% used ({leftPercentage.toFixed(0)}% left)
          </div>
          <div className="tabular-nums text-primary-700">{usedLabel}</div>
        </div>
      </PreviewCardPopup>
    </PreviewCard>
  )
}

export const ContextMeter = memo(ContextMeterComponent)
