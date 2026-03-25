import { redirect } from '@tanstack/react-router'
import type { QueryClient } from '@tanstack/react-query'

import {
  getCurrentUserQueryOptions,
  isUnauthorizedError,
} from '@/lib/app-api'

type RouteAuthContext = {
  queryClient: QueryClient
}

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
    return await queryClient.ensureQueryData(getCurrentUserQueryOptions())
  } catch (error) {
    if (isUnauthorizedError(error)) {
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
    await queryClient.ensureQueryData(getCurrentUserQueryOptions())
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
