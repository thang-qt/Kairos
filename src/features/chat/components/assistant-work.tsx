import { useState } from 'react'
import { Collapsible } from '@/components/ui/collapsible'
import {
  ChainOfThoughtContent,
  ChainOfThoughtTrigger,
} from '@/components/prompt-kit/chain-of-thought'

type AssistantWorkProps = {
  streaming: boolean
  durationMs: number
  toolCount: number
  children: React.ReactNode
}

export function AssistantWork({
  streaming,
  durationMs,
  toolCount,
  children,
}: AssistantWorkProps) {
  const [choice, setChoice] = useState<{
    streaming: boolean
    open: boolean
  } | null>(null)
  const open = choice?.streaming === streaming ? choice.open : streaming
  const duration =
    durationMs < 1000
      ? `${Math.max(1, Math.round(durationMs))}ms`
      : `${(durationMs / 1000).toFixed(1)}s`
  const label = streaming
    ? 'Working…'
    : durationMs > 0
      ? `Worked for ${duration}`
      : `Used ${toolCount} ${toolCount === 1 ? 'tool' : 'tools'}`
  return (
    <Collapsible
      open={open}
      onOpenChange={function change(open) {
        setChoice({ streaming, open })
      }}
    >
      <ChainOfThoughtTrigger>{label}</ChainOfThoughtTrigger>
      <ChainOfThoughtContent>{children}</ChainOfThoughtContent>
    </Collapsible>
  )
}
