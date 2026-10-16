import { useCallback, useEffect, useSyncExternalStore } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { invalidateChatSessionQueries } from '../chat-queries'
import { appQueryKeys } from '@/lib/app-api'
import type { AppUser } from '@/lib/app-api'
import { getChatBackend } from '@/lib/chat-backend'
import { getShell } from '@/lib/shell'

const SESSION_SYNC_DEBOUNCE_MS = 200

export function createSessionListRefreshScheduler(
  refresh: () => Promise<unknown>,
) {
  let timer: number | undefined
  let refreshing = false
  let dirty = false
  let disposed = false

  function scheduleRefresh() {
    if (disposed) return
    dirty = true
    if (timer !== undefined || refreshing) return
    timer = window.setTimeout(runRefresh, SESSION_SYNC_DEBOUNCE_MS)
  }

  function runRefresh() {
    timer = undefined
    if (disposed || !dirty) return
    dirty = false
    refreshing = true
    void Promise.resolve()
      .then(function startRefresh() {
        if (!disposed) return refresh()
      })
      .catch(function ignoreRefreshFailure() {})
      .then(function finishRefresh() {
        refreshing = false
        if (dirty && !disposed) scheduleRefresh()
      })
  }

  function dispose() {
    disposed = true
    dirty = false
    if (timer !== undefined) window.clearTimeout(timer)
    timer = undefined
  }

  return { scheduleRefresh, dispose }
}

export function useChatSessionSync(userId: string | undefined) {
  const queryClient = useQueryClient()

  useEffect(
    function subscribeToSessionChanges() {
      if (!userId || typeof window === 'undefined') return

      const scheduler = createSessionListRefreshScheduler(function refresh() {
        return invalidateChatSessionQueries(queryClient)
      })
      const unsubscribe = getChatBackend().subscribeToSessionList?.({
        onChange: scheduler.scheduleRefresh,
      })

      return function unsubscribeFromSessionChanges() {
        scheduler.dispose()
        unsubscribe?.()
      }
    },
    [queryClient, userId],
  )
}

function useCurrentUserID() {
  const queryClient = useQueryClient()
  const subscribe = useCallback(
    function subscribeToCurrentUser(onChange: () => void) {
      return queryClient
        .getQueryCache()
        .subscribe(function handleQueryChange(event) {
          if (
            event.query.queryKey[0] === appQueryKeys.me[0] &&
            event.query.queryKey[1] === appQueryKeys.me[1]
          )
            onChange()
        })
    },
    [queryClient],
  )
  const getSnapshot = useCallback(
    function readCurrentUser() {
      return queryClient.getQueryData<AppUser>(appQueryKeys.me)
    },
    [queryClient],
  )
  const user = useSyncExternalStore(
    subscribe,
    getSnapshot,
    function serverSnapshot() {
      return undefined
    },
  )
  return user?.id
}

export function ChatSessionSync() {
  const shell = getShell()
  const currentUserID = useCurrentUserID()
  const userId =
    shell.isDesktop && shell.server === null ? undefined : currentUserID

  useChatSessionSync(userId)
  return null
}
