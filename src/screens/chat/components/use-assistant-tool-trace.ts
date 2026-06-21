import { useMemo } from 'react'

import type { ToolPart } from '@/components/prompt-kit/tool'
import type { GatewayMessage, MessageContent, RoundSummary } from '../types'
import { mapToolCallToToolPart } from './message-item-utils'
import type { ToolStep } from './tool-steps'

type UseAssistantToolTraceInput = {
  message: GatewayMessage
  assistantParts: Array<MessageContent>
  isAssistant: boolean
  assistantIsStreaming: boolean
  searchToolPart: ToolPart | null
  toolResultsByCallId?: Map<string, GatewayMessage>
}

export function useAssistantToolTrace({
  message,
  assistantParts,
  isAssistant,
  assistantIsStreaming,
  searchToolPart,
  toolResultsByCallId,
}: UseAssistantToolTraceInput) {
  const roundSummaries = useMemo(
    function extractRoundSummaries(): Array<RoundSummary> {
      const raw = message.details?.roundSummaries
      return Array.isArray(raw) ? (raw as Array<RoundSummary>) : []
    },
    [message.details],
  )

  const firstToolPartIndex = useMemo(
    function findFirstToolPartIndex(): number {
      if (!isAssistant) return -1
      return assistantParts.findIndex((part) => part.type === 'toolCall')
    },
    [assistantParts, isAssistant],
  )

  const lastToolPartIndex = useMemo(
    function findLastToolPartIndex(): number {
      if (!isAssistant) return -1
      for (let i = assistantParts.length - 1; i >= 0; i--) {
        if (assistantParts[i].type === 'toolCall') return i
      }
      return -1
    },
    [assistantParts, isAssistant],
  )

  const streamingLeadingReasoning = useMemo(
    function extractStreamingLeadingReasoning(): string {
      if (!isAssistant || !assistantIsStreaming || roundSummaries.length > 0) {
        return ''
      }
      if (firstToolPartIndex !== -1) return ''
      return assistantParts.map(reasoningTextFromPart).join('').trim()
    },
    [
      assistantParts,
      assistantIsStreaming,
      firstToolPartIndex,
      isAssistant,
      roundSummaries.length,
    ],
  )

  const leadingToolReasoning = useMemo(
    function extractLeadingToolReasoning(): string {
      if (streamingLeadingReasoning) return streamingLeadingReasoning
      if (!isAssistant || roundSummaries.length > 0) return ''
      if (firstToolPartIndex <= 0) return ''
      return assistantParts
        .slice(0, firstToolPartIndex)
        .map(reasoningTextFromPart)
        .join('')
        .trim()
    },
    [
      assistantParts,
      firstToolPartIndex,
      isAssistant,
      roundSummaries.length,
      streamingLeadingReasoning,
    ],
  )

  const toolSteps = useMemo(
    function buildToolSteps(): Array<ToolStep> {
      if (!isAssistant) return []
      const steps: Array<ToolStep> = []
      const webToolCallIds = assistantParts
        .filter(
          (part) =>
            part.type === 'toolCall' &&
            (part.name === 'web_search' || part.name === 'web_fetch') &&
            typeof part.id === 'string' &&
            part.id.trim().length > 0,
        )
        .map((part) => ('id' in part ? part.id : undefined))
        .filter((id): id is string => Boolean(id))
      let addedWebStep = false

      for (const part of assistantParts) {
        if (part.type !== 'toolCall') continue
        if (part.name === 'web_search' || part.name === 'web_fetch') {
          steps.push({
            kind: 'web',
            key: `web-tool-${part.id || steps.length}`,
            message,
            toolCallIds: part.id ? [part.id] : undefined,
          })
          addedWebStep = true
          continue
        }

        const resultMessage = part.id
          ? toolResultsByCallId?.get(part.id)
          : undefined
        steps.push({
          kind: 'tool',
          key: `tool-${part.id || steps.length}`,
          toolPart: mapToolCallToToolPart(part, resultMessage, message),
        })
      }

      if (!addedWebStep && searchToolPart) {
        steps.push({
          kind: 'web',
          key: 'web-tools-details',
          message,
          toolCallIds: webToolCallIds,
        })
      }

      return steps
    },
    [assistantParts, isAssistant, message, searchToolPart, toolResultsByCallId],
  )

  return {
    firstToolPartIndex,
    lastToolPartIndex,
    leadingToolReasoning,
    roundSummaries,
    toolSteps,
  }
}

function reasoningTextFromPart(part: MessageContent): string {
  if (part.type === 'thinking') return String(part.thinking ?? '')
  if (part.type === 'text') return String(part.text ?? '')
  return ''
}
