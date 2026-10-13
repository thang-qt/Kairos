import { useState } from 'react'
import { Collapsible } from '@/components/ui/collapsible'
import {
  ChainOfThoughtContent,
  ChainOfThoughtTrigger,
} from '@/components/prompt-kit/chain-of-thought'

type AssistantWorkProps = {
  durationMs: number
  toolCount: number
  children: React.ReactNode
}

export function AssistantWork({
  durationMs,
  toolCount,
  children,
}: AssistantWorkProps) {
  const [open, setOpen] = useState(false)
  const duration =
    durationMs < 1000
      ? `${Math.max(1, Math.round(durationMs))}ms`
      : `${(durationMs / 1000).toFixed(1)}s`
  const label =
    durationMs > 0
      ? `Worked for ${duration}`
      : toolCount > 0
        ? `Used ${toolCount} ${toolCount === 1 ? 'tool' : 'tools'}`
        : 'Worked'
  return (
    <Collapsible
      open={open}
      onOpenChange={function change(open) {
        setOpen(open)
      }}
    >
      <ChainOfThoughtTrigger>{label}</ChainOfThoughtTrigger>
      <ChainOfThoughtContent>{children}</ChainOfThoughtContent>
    </Collapsible>
  )
}
