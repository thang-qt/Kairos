import { useCallback, useEffect, useRef, useState } from 'react'

import { hasPendingGeneration, setPendingGeneration } from '../pending-send'
import { useChatGenerationGuard } from './use-chat-generation-guard'

type UseChatRunsInput = {
  refreshHistory: () => void
  scopeKey?: string
}

export function useChatRuns({
  refreshHistory,
  scopeKey = '',
}: UseChatRunsInput) {
  const [waitingForResponse, setWaitingForResponse] = useState(() =>
    hasPendingGeneration(),
  )
  const [activeRunIds, setActiveRunIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  )
  const pendingRunIdsRef = useRef(new Set<string>())
  const completedRunIdsRef = useRef(new Set<string>())
  const pendingRunTimersRef = useRef(new Map<string, number>())
  const scopeKeyRef = useRef(scopeKey)

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
      completedRunIdsRef.current.add(runId)
      const timer = pendingRunTimersRef.current.get(runId)
      if (typeof timer === 'number') {
        window.clearTimeout(timer)
      }
      pendingRunTimersRef.current.delete(runId)
      pendingRunIdsRef.current.delete(runId)
      setActiveRunIds(new Set(pendingRunIdsRef.current))
      if (pendingRunIdsRef.current.size === 0) {
        finishGeneration()
      }
    },
    [finishGeneration],
  )

  const startRun = useCallback(
    function startRun(runId: string) {
      if (!runId) return
      if (completedRunIdsRef.current.has(runId)) {
        if (pendingRunIdsRef.current.size === 0) {
          finishGeneration()
        }
        return
      }
      pendingRunIdsRef.current.add(runId)
      setActiveRunIds(new Set(pendingRunIdsRef.current))
      const existingTimer = pendingRunTimersRef.current.get(runId)
      if (typeof existingTimer === 'number') {
        window.clearTimeout(existingTimer)
      }
      const timeout = window.setTimeout(() => {
        pendingRunTimersRef.current.delete(runId)
        pendingRunIdsRef.current.delete(runId)
        setActiveRunIds(new Set(pendingRunIdsRef.current))
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
      completedRunIdsRef.current.clear()
      setActiveRunIds(new Set())
      finishGeneration()
    },
    [finishGeneration],
  )

  const reconcileActiveRunIds = useCallback(
    function reconcileActiveRunIds(runIds: Array<string>) {
      const nextRunIds = new Set(
        runIds.map((runId) => runId.trim()).filter((runId) => runId.length > 0),
      )
      for (const [runId, timer] of pendingRunTimersRef.current) {
        if (nextRunIds.has(runId)) continue
        window.clearTimeout(timer)
        pendingRunTimersRef.current.delete(runId)
      }
      pendingRunIdsRef.current = nextRunIds
      completedRunIdsRef.current.clear()
      setActiveRunIds(new Set(nextRunIds))
      if (nextRunIds.size > 0) {
        beginGeneration()
      } else {
        finishGeneration()
      }
    },
    [beginGeneration, finishGeneration],
  )

  useEffect(() => {
    if (scopeKeyRef.current !== scopeKey) {
      scopeKeyRef.current = scopeKey
      finishAllRuns()
    }
  }, [finishAllRuns, scopeKey])

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
    activeRunIds,
    beginGeneration,
    finishAllRuns,
    finishGeneration,
    finishRun,
    reconcileActiveRunIds,
    setWaitingForResponse,
    startRun,
    waitingForResponse,
  }
}
