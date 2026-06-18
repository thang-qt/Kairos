import { useCallback, useEffect, useRef, useState } from 'react'

import {
  hasPendingGeneration,
  hasPendingSend,
  setPendingGeneration,
} from '../pending-send'
import { useChatGenerationGuard } from './use-chat-generation-guard'

type UseChatRunsInput = {
  refreshHistory: () => void
}

export function useChatRuns({ refreshHistory }: UseChatRunsInput) {
  const [waitingForResponse, setWaitingForResponse] = useState(
    () => hasPendingSend() || hasPendingGeneration(),
  )
  const pendingRunIdsRef = useRef(new Set<string>())
  const pendingRunTimersRef = useRef(new Map<string, number>())

  const beginGeneration = useCallback(function beginGeneration() {
    setPendingGeneration(true)
    setWaitingForResponse(true)
  }, [])

  const finishGeneration = useCallback(function finishGeneration() {
    setPendingGeneration(false)
    setWaitingForResponse(false)
  }, [])

  const finishRun = useCallback(
    function finishRun(runId: string) {
      if (!runId) return
      const timer = pendingRunTimersRef.current.get(runId)
      if (typeof timer === 'number') {
        window.clearTimeout(timer)
      }
      pendingRunTimersRef.current.delete(runId)
      pendingRunIdsRef.current.delete(runId)
      if (pendingRunIdsRef.current.size === 0) {
        finishGeneration()
      }
    },
    [finishGeneration],
  )

  const startRun = useCallback(
    function startRun(runId: string) {
      if (!runId) return
      pendingRunIdsRef.current.add(runId)
      const existingTimer = pendingRunTimersRef.current.get(runId)
      if (typeof existingTimer === 'number') {
        window.clearTimeout(existingTimer)
      }
      const timeout = window.setTimeout(() => {
        pendingRunTimersRef.current.delete(runId)
        pendingRunIdsRef.current.delete(runId)
        refreshHistory()
        if (pendingRunIdsRef.current.size === 0) {
          finishGeneration()
        }
      }, 120000)
      pendingRunTimersRef.current.set(runId, timeout)
      beginGeneration()
    },
    [beginGeneration, finishGeneration, refreshHistory],
  )

  const finishAllRuns = useCallback(
    function finishAllRuns() {
      for (const [, timer] of pendingRunTimersRef.current) {
        window.clearTimeout(timer)
      }
      pendingRunTimersRef.current.clear()
      pendingRunIdsRef.current.clear()
      finishGeneration()
    },
    [finishGeneration],
  )

  useEffect(() => {
    return function cleanupRuns() {
      finishAllRuns()
    }
  }, [finishAllRuns])

  useChatGenerationGuard({
    waitingForResponse,
    refreshHistory,
    setWaitingForResponse,
  })

  return {
    beginGeneration,
    finishAllRuns,
    finishGeneration,
    finishRun,
    setWaitingForResponse,
    startRun,
    waitingForResponse,
  }
}
