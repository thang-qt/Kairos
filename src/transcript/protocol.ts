import type { ConversationTurn } from '@/features/chat/types'

export type Theme = {
  palette: 'default' | 'harvest' | 'mist' | 'canopy' | 'ember' | 'tide'
  mode: 'light' | 'dark'
}
export type Insets = { top: number; bottom: number }
export type NativeCommand =
  | {
      type: 'init'
      theme: Theme
      insets: Insets
      messages: ConversationTurn[]
      sessionId: string | null
    }
  | { type: 'upsert'; message: ConversationTurn }
  | { type: 'remove'; id: string }
  | ({ type: 'theme' } & Theme)
  | ({ type: 'insets' } & Insets)
export type WebEvent =
  | { type: 'ready'; firstPaintMs: number }
  | { type: 'longPress'; id: string }
  | { type: 'activity'; id: string }
  | { type: 'link'; href: string }
  | { type: 'hscroll'; active: boolean; phase: 'start' | 'move' | 'end' }
  | { type: 'atBottom'; value: boolean }
export type TranscriptState = {
  theme: Theme
  insets: Insets
  messages: ConversationTurn[]
  sessionId: string | null
}
export const initialState: TranscriptState = {
  theme: { palette: 'default', mode: 'light' },
  insets: { top: 64, bottom: 110 },
  messages: [],
  sessionId: null,
}
export function reduceTranscript(
  state: TranscriptState,
  command: NativeCommand,
): TranscriptState {
  switch (command.type) {
    case 'init':
      return {
        theme: command.theme,
        insets: command.insets,
        messages: command.messages,
        sessionId: command.sessionId,
      }
    case 'upsert': {
      const index = state.messages.findIndex(function sameId(message) {
        return message.id === command.message.id
      })
      const messages = [...state.messages]
      if (index < 0) messages.push(command.message)
      else messages[index] = command.message
      return { ...state, messages }
    }
    case 'remove':
      return {
        ...state,
        messages: state.messages.filter(function keep(message) {
          return message.id !== command.id
        }),
      }
    case 'theme':
      return {
        ...state,
        theme: { palette: command.palette, mode: command.mode },
      }
    case 'insets':
      return { ...state, insets: { top: command.top, bottom: command.bottom } }
  }
}
