import { useQuery } from '@tanstack/react-query'

export type AppCapabilities = {
  auth: {
    enabled: boolean
    signupEnabled: boolean
  }
}

export type AppUser = {
  id: string
  email: string
  role: string
  createdAt: number
  disabledAt?: number | null
}

export type AuthPayload = {
  email: string
  password: string
}

export type ApiErrorOptions = {
  message: string
  status: number
}

export class ApiError extends Error {
  status: number

  constructor({ message, status }: ApiErrorOptions) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

export const appQueryKeys = {
  capabilities: ['app', 'capabilities'] as const,
  me: ['app', 'me'] as const,
} as const

export async function fetchAppCapabilities(): Promise<AppCapabilities> {
  const response = await fetch('/api/app/capabilities', {
    credentials: 'include',
  })

  const payload = await parseJSON<{ capabilities: AppCapabilities }>(response)
  return payload.capabilities
}

export async function fetchCurrentUser(): Promise<AppUser> {
  const response = await fetch('/api/me', {
    credentials: 'include',
  })

  const payload = await parseJSON<{ user: AppUser }>(response)
  return payload.user
}

export async function login(payload: AuthPayload): Promise<AppUser> {
  const response = await fetch('/api/auth/login', {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })

  const data = await parseJSON<{ user: AppUser }>(response)
  return data.user
}

export async function signup(payload: AuthPayload): Promise<AppUser> {
  const response = await fetch('/api/auth/signup', {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })

  const data = await parseJSON<{ user: AppUser }>(response)
  return data.user
}

export async function logout(): Promise<void> {
  const response = await fetch('/api/auth/logout', {
    method: 'POST',
    credentials: 'include',
  })

  await parseJSON(response)
}

export function useCapabilitiesQuery() {
  return useQuery({
    queryKey: appQueryKeys.capabilities,
    queryFn: fetchAppCapabilities,
    staleTime: 1000 * 60 * 5,
    retry: false,
  })
}

export function useCurrentUserQuery() {
  return useQuery({
    queryKey: appQueryKeys.me,
    queryFn: fetchCurrentUser,
    staleTime: 1000 * 60,
    retry: false,
  })
}

export function isUnauthorizedError(error: unknown) {
  return error instanceof ApiError && error.status === 401
}

async function parseJSON<T>(response: Response): Promise<T> {
  const text = await response.text()
  const data = text ? (JSON.parse(text) as { error?: string } & T) : ({} as T)
  if (!response.ok) {
    throw new ApiError({
      message:
        typeof (data as { error?: string }).error === 'string'
          ? (data as { error?: string }).error!
          : 'Request failed',
      status: response.status,
    })
  }
  return data
}
