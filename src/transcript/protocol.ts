export type Message = {
  id: string
  role: 'user' | 'assistant'
  text: string
  model?: string
  streaming?: boolean
  attachment?: { url: string; width: number; height: number }
}
export type Theme = {
  palette: 'default' | 'harvest' | 'mist' | 'canopy' | 'ember' | 'tide'
  mode: 'light' | 'dark'
}
export type Insets = { top: number; bottom: number }
export type NativeCommand = (
  | { type: 'init'; theme: Theme; insets: Insets; messages: Message[] }
  | { type: 'append'; message: Message }
  | { type: 'delta'; id: string; text: string }
  | { type: 'done'; id: string }
  | ({ type: 'theme' } & Theme)
  | ({ type: 'insets' } & Insets)
) & { trace?: number }
export type WebEvent =
  | { type: 'ready'; firstPaintMs: number }
  | { type: 'longPress'; id: string }
  | { type: 'link'; href: string }
  | { type: 'hscroll'; active: boolean; phase: 'start' | 'move' | 'end' }
  | { type: 'atBottom'; value: boolean }
  // Prototype instrumentation: acknowledged after commit and two animation frames.
  | {
      type: 'paint'
      trace: number
      stage: NativeCommand['type']
      elapsedMs: number
    }
export type TranscriptState = {
  theme: Theme
  insets: Insets
  messages: Message[]
}
export const initialState: TranscriptState = {
  theme: { palette: 'default', mode: 'light' },
  insets: { top: 64, bottom: 110 },
  messages: [],
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
      }
    case 'append':
      return { ...state, messages: [...state.messages, command.message] }
    case 'delta':
      return {
        ...state,
        messages: state.messages.map(function appendDelta(message) {
          return message.id === command.id
            ? { ...message, text: message.text + command.text }
            : message
        }),
      }
    case 'done':
      return {
        ...state,
        messages: state.messages.map(function finishMessage(message) {
          return message.id === command.id
            ? { ...message, streaming: false }
            : message
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
