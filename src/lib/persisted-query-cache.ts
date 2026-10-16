import { dehydrate, hydrate } from '@tanstack/react-query'
import type { DehydratedState, QueryClient } from '@tanstack/react-query'

import { appQueryKeys } from './app-api'
import { chatQueryKeys } from '@/features/chat/chat-queries'
import { useChatSettingsStore } from '@/app/preferences/app-preferences'

const DATABASE_NAME = 'kairos-query-cache'
const DATABASE_VERSION = 2
const OBJECT_STORE_NAME = 'query-clients'
const CACHE_KEY_PREFIX = 'user:'
const LEGACY_LAST_USER_KEY = 'last-user'
const MAX_PERSISTED_HISTORIES = 5
const MAX_HISTORY_BYTES = 1000 * 1000
const MAX_TOTAL_HISTORY_BYTES = 2 * 1000 * 1000
const PERSIST_THROTTLE_MS = 1000
const HISTORY_SIZE_OVERFLOW = MAX_HISTORY_BYTES + 1
const cachedJsonSizeByObject = new WeakMap<object, number>()

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
      if (!offlineCacheEnabled()) return
      const clientState = dehydrate(queryClient, {
        shouldDehydrateQuery: shouldPersistQuery,
        shouldDehydrateMutation: function nonSensitiveMutation(mutation) {
          return mutation.state.isPaused && mutation.meta?.persist !== false
        },
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
      if (offlineCacheEnabled()) writer.schedule(undefined)
    })

  function clearDisabledCache() {
    writer.cancel()
    void clearPersistedQueryCache().catch(function reportClearFailure(error) {
      console.error('Could not clear the offline cache.', error)
    })
  }
  const unsubscribePreferences = useChatSettingsStore.subscribe(
    function onCachePreferenceChange(state, previous) {
      if (
        state.settings.offlineCacheEnabled ===
        previous.settings.offlineCacheEnabled
      )
        return
      if (!offlineCacheEnabled()) {
        clearDisabledCache()
      } else {
        writer.schedule(undefined)
      }
    },
  )
  function syncCachePreferenceFromAnotherTab(event: StorageEvent) {
    if (event.key !== 'chat-settings' || !event.newValue) return
    try {
      const enabled = JSON.parse(event.newValue)?.state?.settings
        ?.offlineCacheEnabled
      if (typeof enabled !== 'boolean' || enabled === offlineCacheEnabled())
        return
      useChatSettingsStore
        .getState()
        .updateSettings({ offlineCacheEnabled: enabled })
    } catch {
      // Ignore unrelated or malformed preference data.
    }
  }
  window.addEventListener('storage', syncCachePreferenceFromAnotherTab)
  if (!offlineCacheEnabled()) clearDisabledCache()

  function flushOnPageHide() {
    void writer.flush()
  }

  window.addEventListener('pagehide', flushOnPageHide)

  return function unsubscribeFromPersistence() {
    unsubscribe()
    unsubscribePreferences()
    window.removeEventListener('storage', syncCachePreferenceFromAnotherTab)
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
  if (!offlineCacheEnabled()) return false
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
    const queryBytes = estimateJsonByteLength(query.state.data)
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

function estimateJsonByteLength(value: unknown): number {
  const ancestors = new WeakSet<object>()
  return estimateJsonValue(value, ancestors)
}

function estimateJsonValue(value: unknown, ancestors: WeakSet<object>): number {
  if (value === null) return 4
  if (typeof value === 'boolean') return value ? 5 : 6
  if (typeof value === 'number') return 32
  if (typeof value === 'string') return escapedStringSize(value)
  if (typeof value !== 'object') return HISTORY_SIZE_OVERFLOW

  const cachedSize = cachedJsonSizeByObject.get(value)
  if (cachedSize !== undefined) return cachedSize
  if (ancestors.has(value)) return HISTORY_SIZE_OVERFLOW
  ancestors.add(value)

  let size = 2
  try {
    if (Array.isArray(value)) {
      let first = true
      for (const item of value) {
        if (!first) size += 1
        first = false
        size += estimateJsonValue(item, ancestors)
        if (size >= HISTORY_SIZE_OVERFLOW) break
      }
    } else {
      let first = true
      for (const key in value) {
        if (!Object.prototype.hasOwnProperty.call(value, key)) continue
        const record = value as Record<string, unknown>
        const child = record[key]
        if (
          child === undefined ||
          typeof child === 'function' ||
          typeof child === 'symbol'
        ) {
          continue
        }
        if (!first) size += 1
        first = false
        size += escapedStringSize(key) + 1 + estimateJsonValue(child, ancestors)
        if (size >= HISTORY_SIZE_OVERFLOW) break
      }
    }
  } catch {
    size = HISTORY_SIZE_OVERFLOW
  } finally {
    ancestors.delete(value)
  }

  const boundedSize = Math.min(size, HISTORY_SIZE_OVERFLOW)
  cachedJsonSizeByObject.set(value, boundedSize)
  return boundedSize
}

function escapedStringSize(value: string): number {
  let size = 2
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    let characterSize: number
    if (code === 0x22 || code === 0x5c) {
      characterSize = 2
    } else if (code < 0x20) {
      characterSize = 6
    } else if (code < 0x80) {
      characterSize = 1
    } else if (code < 0x800) {
      characterSize = 2
    } else if (code >= 0xd800 && code <= 0xdbff) {
      const nextCode = value.charCodeAt(index + 1)
      if (nextCode >= 0xdc00 && nextCode <= 0xdfff) {
        characterSize = 4
        index += 1
      } else {
        characterSize = 6
      }
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      characterSize = 6
    } else {
      characterSize = 3
    }
    size += characterSize
    if (size >= HISTORY_SIZE_OVERFLOW) return HISTORY_SIZE_OVERFLOW
  }
  return size
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
  if (!offlineCacheEnabled()) return undefined
  const database = await openDatabase()
  return new Promise(function read(resolve, reject) {
    const transaction = database.transaction(OBJECT_STORE_NAME, 'readonly')
    const request = transaction.objectStore(OBJECT_STORE_NAME).get(cacheKey)
    request.addEventListener('success', function resolveValue() {
      resolve(
        offlineCacheEnabled()
          ? (request.result as PersistedClient | undefined)
          : undefined,
      )
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
  if (!offlineCacheEnabled()) return
  const database = await openDatabase()
  if (!offlineCacheEnabled()) {
    database.close()
    return
  }
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

function offlineCacheEnabled(): boolean {
  return useChatSettingsStore.getState().settings.offlineCacheEnabled !== false
}

export async function clearPersistedQueryCache(): Promise<void> {
  const database = await openDatabase()
  return new Promise(function clear(resolve, reject) {
    const transaction = database.transaction(OBJECT_STORE_NAME, 'readwrite')
    transaction.objectStore(OBJECT_STORE_NAME).clear()
    transaction.addEventListener('complete', function finishClear() {
      database.close()
      resolve()
    })
    function rejectClear() {
      database.close()
      reject(
        transaction.error ?? new Error('Offline cache clearing was aborted.'),
      )
    }
    transaction.addEventListener('error', rejectClear)
    transaction.addEventListener('abort', rejectClear)
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
