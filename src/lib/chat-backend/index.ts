import { createHTTPChatBackend } from './http-chat-backend'
import { createMockChatBackend } from './mock-chat-backend'
import type { ChatBackend } from './types'

let backend: ChatBackend | null = null
let backendMode: 'mock' | 'http' = 'mock'

export function getChatBackend(): ChatBackend {
  if (!backend) {
    backend =
      backendMode === 'http' ? createHTTPChatBackend() : createMockChatBackend()
  }
  return backend
}

export function setChatBackend(nextBackend: ChatBackend) {
  backend = nextBackend
}

export function configureChatBackend(mode: 'mock' | 'http') {
  if (backendMode === mode && backend) {
    return
  }
  backendMode = mode
  backend = null
}

export type * from './types'
