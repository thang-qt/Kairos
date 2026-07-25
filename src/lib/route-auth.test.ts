// @vitest-environment jsdom

import { QueryClient } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { appQueryKeys } from './app-api'
import { requireAuthenticatedUser } from './route-auth'

const currentUser = {
  id: 'user-1',
  email: 'user@example.com',
  role: 'user',
  createdAt: 100,
}

const otherUser = {
  id: 'user-2',
  email: 'other@example.com',
  role: 'user',
  createdAt: 200,
}

function successfulUserResponse(user: typeof currentUser) {
  return {
    ok: true,
    status: 200,
    text: async function readPayload() {
      return JSON.stringify({ user })
    },
  } as Response
}

describe('route authentication', function routeAuthenticationSuite() {
  afterEach(function restoreMocks() {
    vi.restoreAllMocks()
  })

  it('does not treat a cached user as authenticated', async function () {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    queryClient.setQueryData(appQueryKeys.me, currentUser, { updatedAt: 0 })
    let resolveRequest: (response: Response) => void = function noop() {}
    vi.stubGlobal(
      'fetch',
      vi.fn(function waitForNetwork() {
        return new Promise<Response>(function captureResolve(resolve) {
          resolveRequest = resolve
        })
      }),
    )

    let settled = false
    const authentication = requireAuthenticatedUser({ queryClient }).finally(
      function markSettled() {
        settled = true
      },
    )
    await Promise.resolve()
    expect(settled).toBe(false)

    resolveRequest(successfulUserResponse(currentUser))
    await expect(authentication).resolves.toEqual(currentUser)
    expect(fetch).toHaveBeenCalledWith('/api/me', {
      credentials: 'include',
    })
  })

  it('clears the previous user cache when the authenticated account changes', async function () {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    queryClient.setQueryData(appQueryKeys.me, currentUser, { updatedAt: 0 })
    queryClient.setQueryData(
      ['chat', 'sessions'],
      [{ friendlyId: 'private-user-1-chat' }],
    )
    queryClient.setQueryData(appQueryKeys.models, {
      models: [{ id: 'private-user-1-model' }],
    })
    vi.stubGlobal(
      'fetch',
      vi.fn(function authenticateOtherUser() {
        return Promise.resolve(successfulUserResponse(otherUser))
      }),
    )

    await expect(requireAuthenticatedUser({ queryClient })).resolves.toEqual(
      otherUser,
    )
    expect(queryClient.getQueryData(appQueryKeys.me)).toEqual(otherUser)
    expect(queryClient.getQueryData(['chat', 'sessions'])).toBeUndefined()
    expect(queryClient.getQueryData(appQueryKeys.models)).toBeUndefined()
  })

  it('does not render cached private data while offline auth is unresolved', async function () {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    queryClient.setQueryData(appQueryKeys.me, currentUser, { updatedAt: 0 })
    vi.stubGlobal(
      'fetch',
      vi.fn(function rejectNetworkRequest() {
        return Promise.reject(new TypeError('offline'))
      }),
    )

    await expect(
      requireAuthenticatedUser({ queryClient }),
    ).rejects.toThrowError('offline')
  })
})
