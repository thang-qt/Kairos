// @vitest-environment jsdom

import { QueryClient } from '@tanstack/react-query'
import { IDBFactory } from 'fake-indexeddb'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { appQueryKeys } from './app-api'
import {
  createCoalescedAsyncWriter,
  createUserScopedQueryPersister,
  limitPersistedClient,
  persistedQueryCacheBuster,
  restorePersistedQueryCache,
  shouldPersistQuery,
  subscribeToPersistedQueryCache,
} from './persisted-query-cache'
import type { PersistedClient, QueryPersister } from './persisted-query-cache'

type PersistedQuery = PersistedClient['clientState']['queries'][number]
const testDatabaseName = 'kairos-query-cache'
const testObjectStoreName = 'query-clients'

function createPersistedQuery(
  queryKey: ReadonlyArray<unknown>,
  dataUpdatedAt: number,
  data: unknown = { value: dataUpdatedAt },
): PersistedQuery {
  return {
    dehydratedAt: dataUpdatedAt,
    queryHash: JSON.stringify(queryKey),
    queryKey,
    promise: undefined,
    state: {
      data,
      dataUpdateCount: 1,
      dataUpdatedAt,
      error: null,
      errorUpdateCount: 0,
      errorUpdatedAt: 0,
      fetchFailureCount: 0,
      fetchFailureReason: null,
      fetchMeta: null,
      isInvalidated: false,
      status: 'success',
      fetchStatus: 'idle',
    },
  }
}

function createPersistedClient(
  queries: Array<PersistedQuery>,
): PersistedClient {
  return {
    timestamp: 100,
    buster: 'test',
    clientState: {
      mutations: [],
      queries,
    },
  }
}

function openTestDatabase(version: number): Promise<IDBDatabase> {
  return new Promise(function open(resolve, reject) {
    const request = window.indexedDB.open(testDatabaseName, version)
    request.addEventListener('upgradeneeded', function createStore() {
      if (!request.result.objectStoreNames.contains(testObjectStoreName)) {
        request.result.createObjectStore(testObjectStoreName)
      }
    })
    request.addEventListener('success', function resolveOpen() {
      resolve(request.result)
    })
    request.addEventListener('error', function rejectOpen() {
      reject(request.error)
    })
  })
}

function waitForTransaction(transaction: IDBTransaction): Promise<void> {
  return new Promise(function wait(resolve, reject) {
    transaction.addEventListener('complete', function resolveTransaction() {
      resolve()
    })
    transaction.addEventListener('error', function rejectTransaction() {
      reject(transaction.error)
    })
  })
}

function readTestStoreValue(database: IDBDatabase, key: string) {
  return new Promise<unknown>(function read(resolve, reject) {
    const transaction = database.transaction(testObjectStoreName, 'readonly')
    const request = transaction.objectStore(testObjectStoreName).get(key)
    request.addEventListener('success', function resolveRead() {
      resolve(request.result)
    })
    request.addEventListener('error', function rejectRead() {
      reject(request.error)
    })
  })
}

describe('persisted query cache', function persistedQueryCacheSuite() {
  afterEach(function restoreTimers() {
    vi.useRealTimers()
  })

  it('selects only startup data and conversation histories', function () {
    expect(
      shouldPersistQuery({
        queryKey: ['app', 'models'],
        state: { status: 'success' },
      }),
    ).toBe(true)
    expect(
      shouldPersistQuery({
        queryKey: ['chat', 'history', 'friendly-id', 'session-id'],
        state: { status: 'success' },
      }),
    ).toBe(true)
    expect(
      shouldPersistQuery({
        queryKey: ['app', 'me'],
        state: { status: 'success' },
      }),
    ).toBe(false)
    expect(
      shouldPersistQuery({
        queryKey: ['chat', 'sessions'],
        state: { status: 'error' },
      }),
    ).toBe(false)
  })

  it('keeps only the five most recently updated histories', function () {
    const modelQuery = createPersistedQuery(['app', 'models'], 1)
    const histories = Array.from(
      { length: 7 },
      function createHistory(_, index) {
        return createPersistedQuery(
          ['chat', 'history', `friendly-${index}`, `session-${index}`],
          index + 1,
        )
      },
    )

    const limited = limitPersistedClient(
      createPersistedClient([modelQuery, ...histories]),
    )

    expect(limited.clientState.mutations).toEqual([])
    expect(limited.clientState.queries).toHaveLength(6)
    expect(limited.clientState.queries[0]).toBe(modelQuery)
    expect(
      limited.clientState.queries.slice(1).map(function readUpdatedAt(query) {
        return query.state.dataUpdatedAt
      }),
    ).toEqual([7, 6, 5, 4, 3])
  })

  it('coalesces burst cache updates before dehydration and persistence', async function () {
    vi.useFakeTimers()
    const queryClient = new QueryClient()
    const persistedClients: Array<PersistedClient> = []
    const persister: QueryPersister = {
      persistClient: async function persistClient(client) {
        persistedClients.push(client)
      },
      restoreClient: async function restoreClient() {
        return undefined
      },
      removeClient: async function removeClient() {},
    }
    const unsubscribe = subscribeToPersistedQueryCache(queryClient, persister)

    for (let index = 0; index < 100; index += 1) {
      queryClient.setQueryData(['app', 'models'], { version: index })
    }

    expect(persistedClients).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(1000)
    expect(persistedClients).toHaveLength(1)
    expect(persistedClients[0].clientState.queries[0]?.state.data).toEqual({
      version: 99,
    })

    unsubscribe()
  })

  it('cancels a pending write before an identity transition', async function () {
    vi.useFakeTimers()
    const writes: Array<string> = []
    const writer = createCoalescedAsyncWriter({
      delayMs: 1000,
      write: async function writeValue(value: string) {
        writes.push(value)
      },
    })

    writer.schedule('old-user')
    writer.cancel()
    await vi.advanceTimersByTimeAsync(1000)

    expect(writes).toEqual([])
  })

  it('restores the new user cache when mounted identity changes', async function () {
    Object.defineProperty(window, 'indexedDB', {
      configurable: true,
      value: new IDBFactory(),
    })
    const newUser = { id: 'user-2' }
    const newUserSource = new QueryClient()
    newUserSource.setQueryData(appQueryKeys.me, newUser)
    newUserSource.setQueryData(appQueryKeys.models, {
      models: [{ id: 'private-user-2-model' }],
    })
    await createUserScopedQueryPersister(newUserSource).persistClient({
      timestamp: Date.now(),
      buster: persistedQueryCacheBuster,
      clientState: {
        mutations: [],
        queries: [
          createPersistedQuery(appQueryKeys.models, Date.now(), {
            models: [{ id: 'private-user-2-model' }],
          }),
        ],
      },
    })

    const queryClient = new QueryClient()
    queryClient.setQueryData(appQueryKeys.me, { id: 'user-1' })
    queryClient.setQueryData(
      ['chat', 'sessions'],
      [{ friendlyId: 'private-user-1-chat' }],
    )
    queryClient.setQueryData(appQueryKeys.models, {
      models: [{ id: 'private-user-1-model' }],
    })
    const unsubscribe = subscribeToPersistedQueryCache(
      queryClient,
      createUserScopedQueryPersister(queryClient),
    )

    queryClient.setQueryData(
      ['chat', 'history', 'user-1-chat', 'user-1-session'],
      { messages: [{ content: 'pending old-user write' }] },
    )
    queryClient.setQueryData(appQueryKeys.me, newUser)

    expect(queryClient.getQueryData(['chat', 'sessions'])).toBeUndefined()
    await vi.waitFor(function waitForNewUserRestore() {
      expect(queryClient.getQueryData(appQueryKeys.models)).toEqual({
        models: [{ id: 'private-user-2-model' }],
      })
    })
    await new Promise(function waitForCoalescedWrite(resolve) {
      window.setTimeout(resolve, 1100)
    })
    const verificationClient = new QueryClient()
    verificationClient.setQueryData(appQueryKeys.me, newUser)
    await restorePersistedQueryCache(
      verificationClient,
      createUserScopedQueryPersister(verificationClient),
    )
    expect(verificationClient.getQueryData(appQueryKeys.models)).toEqual({
      models: [{ id: 'private-user-2-model' }],
    })
    unsubscribe()
  })

  it('restores a cache only after the authenticated user is known', async function () {
    Object.defineProperty(window, 'indexedDB', {
      configurable: true,
      value: new IDBFactory(),
    })
    const currentUser = {
      id: 'user-1',
      email: 'user@example.com',
      role: 'user',
      createdAt: 100,
    }
    const sourceClient = new QueryClient()
    sourceClient.setQueryData(appQueryKeys.me, currentUser)
    const persistedModels = createPersistedQuery(
      appQueryKeys.models,
      Date.now(),
      { models: [{ id: 'model-1' }] },
    )
    await createUserScopedQueryPersister(sourceClient).persistClient({
      timestamp: Date.now(),
      buster: persistedQueryCacheBuster,
      clientState: {
        mutations: [],
        queries: [persistedModels],
      },
    })

    const restoredClient = new QueryClient()
    restoredClient.setQueryData(appQueryKeys.me, currentUser)
    await expect(
      restorePersistedQueryCache(
        restoredClient,
        createUserScopedQueryPersister(restoredClient),
      ),
    ).resolves.toBe(true)
    expect(restoredClient.getQueryData(appQueryKeys.me)).toEqual(currentUser)
    expect(restoredClient.getQueryData(appQueryKeys.models)).toEqual({
      models: [{ id: 'model-1' }],
    })
  })

  it('deletes legacy unscoped identity metadata during upgrade', async function () {
    Object.defineProperty(window, 'indexedDB', {
      configurable: true,
      value: new IDBFactory(),
    })
    const legacyDatabase = await openTestDatabase(1)
    const transaction = legacyDatabase.transaction(
      testObjectStoreName,
      'readwrite',
    )
    transaction.objectStore(testObjectStoreName).put(
      {
        id: 'legacy-user',
        email: 'legacy@example.com',
        role: 'user',
      },
      'last-user',
    )
    await waitForTransaction(transaction)
    legacyDatabase.close()

    const queryClient = new QueryClient()
    queryClient.setQueryData(appQueryKeys.me, { id: 'current-user' })
    await createUserScopedQueryPersister(queryClient).restoreClient()

    const upgradedDatabase = await openTestDatabase(2)
    await expect(
      readTestStoreValue(upgradedDatabase, 'last-user'),
    ).resolves.toBeUndefined()
    upgradedDatabase.close()
  })
})
