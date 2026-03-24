import { useQuery } from '@tanstack/react-query'

export type AppCapabilities = {
  auth: {
    enabled: boolean
    signupEnabled: boolean
  }
  providers: {
    systemProvidersEnabled: boolean
    userProvidersEnabled: boolean
    canDisableSystemProvider: boolean
    canAddCustomBaseUrl: boolean
    canSyncModels: boolean
  }
  models: {
    canSelectModel: boolean
    defaultModelLocked: boolean
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

export type UserPreferences = {
  useSystemProviders: boolean
  defaultModelId?: string
}

export type ProviderRecord = {
  id: string
  ref: string
  owner: 'system' | 'user'
  kind: string
  label: string
  baseUrl?: string
  enabled: boolean
  supportsModelSync: boolean
  systemManaged: boolean
}

export type ProviderModel = {
  id: string
  object: 'model'
  created: number
  owned_by: string
  name?: string
  description?: string
  contextWindow?: number
  providerRef?: string
  providerLabel?: string
}

export type ProviderPayload = {
  providers: Array<ProviderRecord>
  preferences: UserPreferences
}

export type ModelsPayload = {
  models: Array<ProviderModel>
  preferences: UserPreferences
  capabilities: AppCapabilities['models']
}

export type CreateProviderPayload = {
  kind?: string
  label: string
  baseUrl: string
  apiKey: string
  enabled?: boolean
  supportsModelSync?: boolean
}

export type UpdateProviderPayload = {
  label?: string
  baseUrl?: string
  apiKey?: string
  enabled?: boolean
  supportsModelSync?: boolean
}

export type UpdatePreferencesPayload = {
  useSystemProviders?: boolean
  defaultModelId?: string
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
  providers: ['app', 'providers'] as const,
  models: ['app', 'models'] as const,
  preferences: ['app', 'preferences'] as const,
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

export async function fetchProviders(): Promise<ProviderPayload> {
  const response = await fetch('/api/providers', {
    credentials: 'include',
  })
  return parseJSON<ProviderPayload>(response)
}

export async function fetchModels(): Promise<ModelsPayload> {
  const response = await fetch('/api/models', {
    credentials: 'include',
  })
  return parseJSON<ModelsPayload>(response)
}

export async function fetchPreferences(): Promise<UserPreferences> {
  const response = await fetch('/api/me/preferences', {
    credentials: 'include',
  })
  const data = await parseJSON<{ preferences: UserPreferences }>(response)
  return data.preferences
}

export async function createProvider(
  payload: CreateProviderPayload,
): Promise<ProviderRecord> {
  const response = await fetch('/api/providers', {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })
  const data = await parseJSON<{ provider: ProviderRecord }>(response)
  return data.provider
}

export async function updateProvider(
  providerId: string,
  payload: UpdateProviderPayload,
): Promise<ProviderRecord> {
  const response = await fetch(`/api/providers/${encodeURIComponent(providerId)}`, {
    method: 'PATCH',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })
  const data = await parseJSON<{ provider: ProviderRecord }>(response)
  return data.provider
}

export async function deleteProvider(providerId: string): Promise<void> {
  const response = await fetch(`/api/providers/${encodeURIComponent(providerId)}`, {
    method: 'DELETE',
    credentials: 'include',
  })
  await parseJSON(response)
}

export async function updatePreferences(
  payload: UpdatePreferencesPayload,
): Promise<UserPreferences> {
  const response = await fetch('/api/me/preferences', {
    method: 'PATCH',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })
  const data = await parseJSON<{ preferences: UserPreferences }>(response)
  return data.preferences
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

export function useProvidersQuery() {
  return useQuery({
    queryKey: appQueryKeys.providers,
    queryFn: fetchProviders,
    staleTime: 1000 * 30,
    retry: false,
  })
}

export function useModelsQuery() {
  return useQuery({
    queryKey: appQueryKeys.models,
    queryFn: fetchModels,
    staleTime: 1000 * 30,
    retry: false,
  })
}

export function usePreferencesQuery() {
  return useQuery({
    queryKey: appQueryKeys.preferences,
    queryFn: fetchPreferences,
    staleTime: 1000 * 30,
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
