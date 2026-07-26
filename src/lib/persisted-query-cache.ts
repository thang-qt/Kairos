import { dehydrate, hydrate } from '@tanstack/react-query'
import type { DehydratedState, QueryClient } from '@tanstack/react-query'

import { appQueryKeys } from './app-api'
import { chatQueryKeys } from '@/features/chat/chat-queries'

const DATABASE_NAME = 'kairos-query-cache'
const DATABASE_VERSION = 2
const OBJECT_STORE_NAME = 'query-clients'
const CACHE_KEY_PREFIX = 'user:'
const LEGACY_LAST_USER_KEY = 'last-user'
const MAX_PERSISTED_HISTORIES = 5
const MAX_HISTORY_BYTES = 1000 * 1000
const MAX_TOTAL_HISTORY_BYTES = 2 * 1000 * 1000
const PERSIST_THROTTLE_MS = 1000

export const persistedQueryCacheMaxAge = 1000 * 60 * 60 * 24
export const persistedQueryCacheBuster = 'kairos-query-cache-v1'

export type PersistedClient = {
  timestamp: number
  buster: string
  clientState: DehydratedState
}

export type QueryPersister = {
  persistClient: (client: PersistedClient) => Promise<void>
  restoreClient: () => Promise<PersistedClient | undefined>
  removeClient: () => Promise<void>
}

type PersistedQuery = PersistedClient['clientState']['queries'][number]
type PendingWrite<T> = {
  value: T
}

export function createUserScopedQueryPersister(
  queryClient: QueryClient,
): QueryPersister {
  return {
    persistClient: async function persistClient(client) {
      const cacheKey = getCurrentUserCacheKey(queryClient)
      if (!cacheKey) return
      await writePersistedClient(cacheKey, limitPersistedClient(client))
    },
    restoreClient: async function restoreClient() {
      const cacheKey = getCurrentUserCacheKey(queryClient)
      if (!cacheKey) return undefined
      return readPersistedClient(cacheKey)
    },
    removeClient: async function removeClient() {
      const cacheKey = getCurrentUserCacheKey(queryClient)
      if (!cacheKey) return
      await deletePersistedClient(cacheKey)
    },
  }
}

export function subscribeToPersistedQueryCache(
  queryClient: QueryClient,
  persister: QueryPersister,
) {
  let activeUserID = getCurrentUserID(queryClient)
  let identityTransitions = 0
  let transitionChain = Promise.resolve()
  const writer = createCoalescedAsyncWriter({
    delayMs: PERSIST_THROTTLE_MS,
    write: async function persistLatestCache() {
      const clientState = dehydrate(queryClient, {
        shouldDehydrateQuery: shouldPersistQuery,
      })
      await persister.persistClient({
        timestamp: Date.now(),
        buster: persistedQueryCacheBuster,
        clientState,
      })
    },
  })
  const unsubscribe = queryClient
    .getQueryCache()
    .subscribe(function schedule() {
      const currentUserID = getCurrentUserID(queryClient)
      if (activeUserID && currentUserID && activeUserID !== currentUserID) {
        activeUserID = currentUserID
        identityTransitions += 1
        writer.cancel()
        clearUserScopedQueryData(queryClient)
        transitionChain = transitionChain
          .catch(function ignorePreviousTransitionError() {})
          .then(async function restoreNewUserCache() {
            await restoreUserPersistedQueryCache(queryClient, currentUserID)
          })
          .finally(function finishIdentityTransition() {
            identityTransitions -= 1
            if (identityTransitions === 0) {
              writer.schedule(undefined)
            }
          })
        return
      }
      if (currentUserID) {
        activeUserID = currentUserID
      }
      if (identityTransitions > 0) return
      writer.schedule(undefined)
    })

  function flushOnPageHide() {
    void writer.flush()
  }

  window.addEventListener('pagehide', flushOnPageHide)

  return function unsubscribeFromPersistence() {
    unsubscribe()
    window.removeEventListener('pagehide', flushOnPageHide)
    void transitionChain.finally(function flushFinalCache() {
      return writer.flush()
    })
  }
}

export async function restorePersistedQueryCache(
  queryClient: QueryClient,
  persister: QueryPersister,
  shouldHydrate: () => boolean = function alwaysHydrate() {
    return true
  },
) {
  const persistedClient = await persister.restoreClient()
  if (!persistedClient) return false
  const isExpired =
    Date.now() - persistedClient.timestamp > persistedQueryCacheMaxAge
  const isBusted = persistedClient.buster !== persistedQueryCacheBuster
  if (isExpired || isBusted) {
    await persister.removeClient()
    return false
  }
  if (!shouldHydrate()) return false
  hydrate(queryClient, removeEphemeralQueries(persistedClient.clientState))
  return true
}

export function restoreUserPersistedQueryCache(
  queryClient: QueryClient,
  userID: string,
) {
  return restorePersistedQueryCache(
    queryClient,
    createUserIDScopedQueryPersister(userID),
    function isStillCurrentUser() {
      return getCurrentUserID(queryClient) === userID
    },
  )
}

export function createCoalescedAsyncWriter<T>({
  delayMs,
  write,
}: {
  delayMs: number
  write: (value: T) => Promise<void>
}) {
  let pendingWrite: PendingWrite<T> | null = null
  let timer: number | undefined
  let writeChain = Promise.resolve()

  function enqueuePendingWrite() {
    timer = undefined
    const pending = pendingWrite
    pendingWrite = null
    if (!pending) return

    writeChain = writeChain
      .catch(function ignorePreviousWriteError() {})
      .then(function writePendingValue() {
        return write(pending.value)
      })
  }

  function schedule(value: T) {
    pendingWrite = { value }
    if (timer !== undefined) return
    timer = window.setTimeout(enqueuePendingWrite, delayMs)
  }

  async function flush() {
    if (timer !== undefined) {
      window.clearTimeout(timer)
      enqueuePendingWrite()
    }
    await writeChain.catch(function ignoreWriteError() {})
    if (pendingWrite) {
      enqueuePendingWrite()
      await writeChain.catch(function ignoreWriteError() {})
    }
  }

  function cancel() {
    pendingWrite = null
    if (timer === undefined) return
    window.clearTimeout(timer)
    timer = undefined
  }

  return { schedule, flush, cancel }
}

export async function removeCurrentUserPersistedQueryCache(
  queryClient: QueryClient,
) {
  const cacheKey = getCurrentUserCacheKey(queryClient)
  if (!cacheKey) return
  await deletePersistedClient(cacheKey)
}

export function clearUserScopedQueryData(queryClient: QueryClient) {
  queryClient.removeQueries({ queryKey: ['chat'] })
  for (const queryKey of [
    appQueryKeys.providers,
    appQueryKeys.models,
    appQueryKeys.preferences,
    appQueryKeys.chatSettings,
    appQueryKeys.webTools,
  ]) {
    queryClient.removeQueries({
      queryKey,
      exact: true,
    })
  }
}

export function shouldPersistQuery(query: {
  queryKey: ReadonlyArray<unknown>
  state: { status: string }
}) {
  if (query.state.status !== 'success') return false
  if (sameQueryKey(query.queryKey, appQueryKeys.models)) return true
  if (sameQueryKey(query.queryKey, appQueryKeys.chatSettings)) return true
  if (sameQueryKey(query.queryKey, chatQueryKeys.sessions)) return true
  return isPersistableHistoryQuery(query.queryKey)
}

export function limitPersistedClient(client: PersistedClient): PersistedClient {
  const nonHistoryQueries: Array<PersistedQuery> = []
  const historyQueries: Array<PersistedQuery> = []

  for (const query of client.clientState.queries) {
    if (isPersistableHistoryQuery(query.queryKey)) {
      historyQueries.push(query)
      continue
    }
    if (isHistoryQuery(query.queryKey)) continue
    nonHistoryQueries.push(query)
  }

  historyQueries.sort(function sortNewestFirst(left, right) {
    return right.state.dataUpdatedAt - left.state.dataUpdatedAt
  })

  const retainedHistories: Array<PersistedQuery> = []
  let retainedHistoryBytes = 0
  for (const query of historyQueries) {
    if (retainedHistories.length >= MAX_PERSISTED_HISTORIES) break
    const queryBytes = serializedByteLength(query.state.data)
    if (queryBytes > MAX_HISTORY_BYTES) continue
    if (retainedHistoryBytes + queryBytes > MAX_TOTAL_HISTORY_BYTES) continue
    retainedHistories.push(query)
    retainedHistoryBytes += queryBytes
  }

  return {
    ...client,
    clientState: {
      ...client.clientState,
      mutations: [],
      queries: [...nonHistoryQueries, ...retainedHistories],
    },
  }
}

function getCurrentUserCacheKey(queryClient: QueryClient): string | null {
  const userID = getCurrentUserID(queryClient)
  return userID ? `${CACHE_KEY_PREFIX}${userID}` : null
}

function getCurrentUserID(queryClient: QueryClient): string | null {
  const currentUser = queryClient.getQueryData<{ id?: unknown }>(
    appQueryKeys.me,
  )
  const userID =
    typeof currentUser?.id === 'string' ? currentUser.id.trim() : ''
  return userID || null
}

function createUserIDScopedQueryPersister(userID: string): QueryPersister {
  const cacheKey = `${CACHE_KEY_PREFIX}${userID}`
  return {
    persistClient: async function persistClient(client) {
      await writePersistedClient(cacheKey, limitPersistedClient(client))
    },
    restoreClient: async function restoreClient() {
      return readPersistedClient(cacheKey)
    },
    removeClient: async function removeClient() {
      await deletePersistedClient(cacheKey)
    },
  }
}

function sameQueryKey(
  left: ReadonlyArray<unknown>,
  right: ReadonlyArray<unknown>,
) {
  if (left.length !== right.length) return false
  return left.every(function matchKeyPart(part, index) {
    return part === right[index]
  })
}

function isHistoryQuery(queryKey: ReadonlyArray<unknown>) {
  return (
    queryKey.length === 4 && queryKey[0] === 'chat' && queryKey[1] === 'history'
  )
}

function isPersistableHistoryQuery(queryKey: ReadonlyArray<unknown>) {
  return (
    isHistoryQuery(queryKey) &&
    !(queryKey[2] === 'new' && queryKey[3] === 'new')
  )
}

function removeEphemeralQueries(
  clientState: PersistedClient['clientState'],
): PersistedClient['clientState'] {
  return {
    ...clientState,
    queries: clientState.queries.filter(function keepPersistableQuery(query) {
      return (
        !isHistoryQuery(query.queryKey) ||
        isPersistableHistoryQuery(query.queryKey)
      )
    }),
  }
}

function serializedByteLength(value: unknown) {
  try {
    return new TextEncoder().encode(JSON.stringify(value)).byteLength
  } catch {
    return Number.POSITIVE_INFINITY
  }
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise(function open(resolve, reject) {
    const request = window.indexedDB.open(DATABASE_NAME, DATABASE_VERSION)
    request.addEventListener('upgradeneeded', function createObjectStore() {
      const database = request.result
      if (!database.objectStoreNames.contains(OBJECT_STORE_NAME)) {
        database.createObjectStore(OBJECT_STORE_NAME)
      }
      request.transaction
        ?.objectStore(OBJECT_STORE_NAME)
        .delete(LEGACY_LAST_USER_KEY)
    })
    request.addEventListener('success', function resolveDatabase() {
      resolve(request.result)
    })
    request.addEventListener('error', function rejectDatabase() {
      reject(request.error)
    })
  })
}

async function readPersistedClient(
  cacheKey: string,
): Promise<PersistedClient | undefined> {
  const database = await openDatabase()
  return new Promise(function read(resolve, reject) {
    const transaction = database.transaction(OBJECT_STORE_NAME, 'readonly')
    const request = transaction.objectStore(OBJECT_STORE_NAME).get(cacheKey)
    request.addEventListener('success', function resolveValue() {
      resolve(request.result as PersistedClient | undefined)
    })
    request.addEventListener('error', function rejectRead() {
      reject(request.error)
    })
    transaction.addEventListener('complete', function closeDatabase() {
      database.close()
    })
  })
}

async function writePersistedClient(
  cacheKey: string,
  client: PersistedClient,
): Promise<void> {
  const database = await openDatabase()
  return new Promise(function write(resolve, reject) {
    const transaction = database.transaction(OBJECT_STORE_NAME, 'readwrite')
    transaction.objectStore(OBJECT_STORE_NAME).put(client, cacheKey)
    transaction.addEventListener('complete', function finishWrite() {
      database.close()
      resolve()
    })
    transaction.addEventListener('error', function rejectWrite() {
      database.close()
      reject(transaction.error)
    })
  })
}

async function deletePersistedClient(cacheKey: string): Promise<void> {
  const database = await openDatabase()
  return new Promise(function remove(resolve, reject) {
    const transaction = database.transaction(OBJECT_STORE_NAME, 'readwrite')
    const objectStore = transaction.objectStore(OBJECT_STORE_NAME)
    objectStore.delete(cacheKey)
    objectStore.delete(LEGACY_LAST_USER_KEY)
    transaction.addEventListener('complete', function finishDelete() {
      database.close()
      resolve()
    })
    transaction.addEventListener('error', function rejectDelete() {
      database.close()
      reject(transaction.error)
    })
  })
}
