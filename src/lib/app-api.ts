import { queryOptions, useQuery } from '@tanstack/react-query'
import { ApiError, parseJSON } from './api-client'
export { ApiError } from './api-client'

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

export type ChangeEmailPayload = {
  newEmail: string
  currentPassword: string
}

export type ChangePasswordPayload = {
  currentPassword: string
  newPassword: string
}

export type UserPreferences = {
  useSystemProviders: boolean
  defaultModelId?: string
  autoGenerateTitle: boolean
  useSeparateTitleModel: boolean
  titleGenerationModelId?: string
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
  modelRef?: string
  object: 'model'
  created: number
  owned_by: string
  name?: string
  description?: string
  contextWindow?: number
  providerRef?: string
  providerLabel?: string
  isCustom?: boolean
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

function normalizeModelsPayload(payload: ModelsPayload): ModelsPayload {
  return {
    ...payload,
    models: Array.isArray(payload.models) ? payload.models : [],
  }
}

export type UpdateModelMetadataPayload = {
  modelId: string
  name?: string
  description?: string
  contextWindow?: number
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
  autoGenerateTitle?: boolean
  useSeparateTitleModel?: boolean
  titleGenerationModelId?: string
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

export async function changeEmail(
  payload: ChangeEmailPayload,
): Promise<AppUser> {
  const response = await fetch('/api/me/email', {
    method: 'PATCH',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })

  const data = await parseJSON<{ user: AppUser }>(response)
  return data.user
}

export async function changePassword(
  payload: ChangePasswordPayload,
): Promise<void> {
  const response = await fetch('/api/me/password', {
    method: 'PATCH',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
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
  const data = await parseJSON<ModelsPayload>(response)
  return normalizeModelsPayload(data)
}

export async function syncModels(): Promise<ModelsPayload> {
  const response = await fetch('/api/models/sync', {
    method: 'POST',
    credentials: 'include',
  })
  const data = await parseJSON<ModelsPayload>(response)
  return normalizeModelsPayload(data)
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
  const response = await fetch(
    `/api/providers/${encodeURIComponent(providerId)}`,
    {
      method: 'PATCH',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    },
  )
  const data = await parseJSON<{ provider: ProviderRecord }>(response)
  return data.provider
}

export async function deleteProvider(providerId: string): Promise<void> {
  const response = await fetch(
    `/api/providers/${encodeURIComponent(providerId)}`,
    {
      method: 'DELETE',
      credentials: 'include',
    },
  )
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

export async function updateModelMetadata(
  payload: UpdateModelMetadataPayload,
): Promise<ProviderModel> {
  const response = await fetch('/api/models/metadata', {
    method: 'PATCH',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })
  const data = await parseJSON<{ model: ProviderModel }>(response)
  return data.model
}

export function getCapabilitiesQueryOptions() {
  return queryOptions({
    queryKey: appQueryKeys.capabilities,
    queryFn: fetchAppCapabilities,
    staleTime: 1000 * 60 * 5,
    retry: false,
  })
}

export function getCurrentUserQueryOptions() {
  return queryOptions({
    queryKey: appQueryKeys.me,
    queryFn: fetchCurrentUser,
    staleTime: 1000 * 60,
    retry: false,
  })
}

export function useCapabilitiesQuery() {
  return useQuery(getCapabilitiesQueryOptions())
}

export function useCurrentUserQuery() {
  return useQuery(getCurrentUserQueryOptions())
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
    staleTime: 1000 * 60 * 15,
    retry: false,
    refetchOnWindowFocus: false,
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

export type CreateModelPayload = {
  providerRef: string
  modelId: string
  name: string
  description?: string
  contextWindow?: number
}

export async function createCustomModel(
  payload: CreateModelPayload,
): Promise<ProviderModel> {
  const response = await fetch('/api/models', {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })
  const data = await parseJSON<{ model: ProviderModel }>(response)
  return data.model
}

export async function deleteCustomModel(
  providerRef: string,
  modelId: string,
): Promise<void> {
  const params = new URLSearchParams({
    providerRef,
    modelId,
  })
  const response = await fetch(`/api/models?${params.toString()}`, {
    method: 'DELETE',
    credentials: 'include',
  })
  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(errorText || 'Failed to delete custom model')
  }
}
