import { createHTTPChatBackend } from './http-chat-backend'
import type { ChatBackend } from './types'

let backend: ChatBackend | null = null

export function getChatBackend(): ChatBackend {
  if (!backend) {
    backend = createHTTPChatBackend()
  }
  return backend
}

export function setChatBackend(nextBackend: ChatBackend) {
  backend = nextBackend
}

export type * from './types'
