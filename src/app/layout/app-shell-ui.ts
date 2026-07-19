import type { QueryClient } from '@tanstack/react-query'

export type AppShellUiState = {
  isSidebarCollapsed: boolean
}

const CHAT_UI_STORAGE_KEY = 'kairos.chat-ui.v1'

const defaultAppShellUiState: AppShellUiState = {
  isSidebarCollapsed: false,
}

export const appShellUiQueryKey = ['chat', 'ui'] as const

export function getAppShellUiState(queryClient: QueryClient): AppShellUiState {
  const cached = queryClient.getQueryData(appShellUiQueryKey)
  if (cached && typeof cached === 'object') {
    return {
      ...defaultAppShellUiState,
      ...(cached as Partial<AppShellUiState>),
    }
  }

  const persisted = readPersistedAppShellUiState()
  if (persisted) {
    return persisted
  }

  return defaultAppShellUiState
}

export function setAppShellUiState(
  queryClient: QueryClient,
  updater: (state: AppShellUiState) => AppShellUiState,
) {
  queryClient.setQueryData(appShellUiQueryKey, function update(state: unknown) {
    const current =
      state && typeof state === 'object'
        ? {
            ...defaultAppShellUiState,
            ...(state as Partial<AppShellUiState>),
          }
        : defaultAppShellUiState
    const next = updater(current)
    persistAppShellUiState(next)
    return next
  })
}

function readPersistedAppShellUiState(): AppShellUiState | null {
  if (typeof window === 'undefined') {
    return null
  }

  try {
    const rawValue = window.localStorage.getItem(CHAT_UI_STORAGE_KEY)
    if (!rawValue) {
      return null
    }

    const parsed = JSON.parse(rawValue) as Partial<AppShellUiState>
    return {
      ...defaultAppShellUiState,
      ...parsed,
    }
  } catch {
    return null
  }
}

function persistAppShellUiState(state: AppShellUiState) {
  if (typeof window === 'undefined') {
    return
  }

  try {
    window.localStorage.setItem(CHAT_UI_STORAGE_KEY, JSON.stringify(state))
  } catch {
    // Ignore storage failures and keep UI state in-memory.
  }
}
