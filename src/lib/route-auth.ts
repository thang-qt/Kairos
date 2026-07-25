import { redirect } from '@tanstack/react-router'
import type { QueryClient } from '@tanstack/react-query'

import {
  appQueryKeys,
  getCurrentUserQueryOptions,
  isUnauthorizedError,
} from '@/lib/app-api'
import type { AppUser } from '@/lib/app-api'
import {
  clearUserScopedQueryData,
  removeCurrentUserPersistedQueryCache,
  restoreUserPersistedQueryCache,
} from '@/lib/persisted-query-cache'

type RouteAuthContext = {
  queryClient: QueryClient
}

const restoredUserIDs = new WeakMap<QueryClient, string>()

function isServerRender() {
  return typeof window === 'undefined'
}

export async function requireAuthenticatedUser({
  queryClient,
}: RouteAuthContext) {
  if (isServerRender()) {
    return
  }

  try {
    return await authenticateAndRestoreUser(queryClient)
  } catch (error) {
    if (isUnauthorizedError(error)) {
      await clearUnauthorizedUser(queryClient)
      throw redirect({
        to: '/auth',
        replace: true,
      })
    }

    throw error
  }
}

export async function requireGuestUser({ queryClient }: RouteAuthContext) {
  if (isServerRender()) {
    return
  }

  try {
    await authenticateAndRestoreUser(queryClient)
  } catch (error) {
    if (isUnauthorizedError(error)) {
      return
    }

    throw error
  }

  throw redirect({
    to: '/new',
    replace: true,
  })
}

function fetchCurrentUser(queryClient: QueryClient) {
  return queryClient.fetchQuery({
    ...getCurrentUserQueryOptions(),
    staleTime: 0,
  })
}

async function authenticateAndRestoreUser(queryClient: QueryClient) {
  const previousUser = queryClient.getQueryData<AppUser>(appQueryKeys.me)
  const currentUser = await fetchCurrentUser(queryClient)
  if (previousUser && previousUser.id !== currentUser.id) {
    clearUserScopedQueryData(queryClient)
  }
  await restoreAuthenticatedUserCache(queryClient, currentUser.id)
  return currentUser
}

async function restoreAuthenticatedUserCache(
  queryClient: QueryClient,
  userID: string,
) {
  if (restoredUserIDs.get(queryClient) === userID) return
  await restoreUserPersistedQueryCache(queryClient, userID).catch(
    function ignorePersistenceError() {},
  )
  restoredUserIDs.set(queryClient, userID)
}

async function clearUnauthorizedUser(queryClient: QueryClient) {
  await removeCurrentUserPersistedQueryCache(queryClient).catch(
    function ignorePersistenceError() {},
  )
  clearUserScopedQueryData(queryClient)
  queryClient.removeQueries({ queryKey: appQueryKeys.me, exact: true })
  restoredUserIDs.delete(queryClient)
}
