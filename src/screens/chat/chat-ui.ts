import type { QueryClient } from '@tanstack/react-query'

export type ChatUiState = {
  isSidebarCollapsed: boolean
}

const CHAT_UI_STORAGE_KEY = 'kairos.chat-ui.v1'

const defaultChatUiState: ChatUiState = {
  isSidebarCollapsed: false,
}

export const chatUiQueryKey = ['chat', 'ui'] as const

export function getChatUiState(queryClient: QueryClient): ChatUiState {
  const cached = queryClient.getQueryData(chatUiQueryKey)
  if (cached && typeof cached === 'object') {
    return {
      ...defaultChatUiState,
        ...(cached as Partial<ChatUiState>),
    }
  }

  const persisted = readPersistedChatUiState()
  if (persisted) {
    return persisted
  }

  return defaultChatUiState
}

export function setChatUiState(
  queryClient: QueryClient,
  updater: (state: ChatUiState) => ChatUiState,
) {
  queryClient.setQueryData(chatUiQueryKey, function update(state: unknown) {
    const current =
      state && typeof state === 'object'
        ? {
            ...defaultChatUiState,
            ...(state as Partial<ChatUiState>),
          }
        : defaultChatUiState
    const next = updater(current)
    persistChatUiState(next)
    return next
  })
}

function readPersistedChatUiState(): ChatUiState | null {
  if (typeof window === 'undefined') {
    return null
  }

  try {
    const rawValue = window.localStorage.getItem(CHAT_UI_STORAGE_KEY)
    if (!rawValue) {
      return null
    }

    const parsed = JSON.parse(rawValue) as Partial<ChatUiState>
    return {
      ...defaultChatUiState,
      ...parsed,
    }
  } catch {
    return null
  }
}

function persistChatUiState(state: ChatUiState) {
  if (typeof window === 'undefined') {
    return
  }

  try {
    window.localStorage.setItem(CHAT_UI_STORAGE_KEY, JSON.stringify(state))
  } catch {
    // Ignore storage failures and keep UI state in-memory.
  }
}
