import { createMockChatBackend } from './mock-chat-backend'
import type { ChatBackend } from './types'

let backend: ChatBackend | null = null

export function getChatBackend(): ChatBackend {
  if (!backend) {
    backend = createMockChatBackend()
  }
  return backend
}

export function setChatBackend(nextBackend: ChatBackend) {
  backend = nextBackend
}

export type * from './types'
