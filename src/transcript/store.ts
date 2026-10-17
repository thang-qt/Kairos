import { initialState, reduceTranscript } from './protocol'
import type { NativeCommand, WebEvent } from './protocol'

let state = initialState
const listeners = new Set<() => void>()
export let followBottom = true
export function setFollowBottom(value: boolean) {
  followBottom = state.scrollPolicy === 'bottom' && value
}
export function getSnapshot() {
  return state
}
export function subscribe(listener: () => void) {
  listeners.add(listener)
  return function unsubscribe() {
    listeners.delete(listener)
  }
}
export function post(event: WebEvent) {
  const bridgeWindow = window as typeof window & {
    kairosNative?: { postMessage: (json: string) => void }
  }
  bridgeWindow.kairosNative?.postMessage(JSON.stringify(event))
}
export function receive(command: NativeCommand) {
  state = reduceTranscript(state, command)
  if (command.type === 'init' || command.type === 'scroll-policy')
    followBottom = state.scrollPolicy === 'bottom'
  document.documentElement.className = `theme-${state.theme.palette} ${state.theme.mode}`
  listeners.forEach(function notify(listener) {
    listener()
  })
}
