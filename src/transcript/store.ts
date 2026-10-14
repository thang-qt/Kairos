import { initialState, reduceTranscript } from './protocol'
import type { NativeCommand, WebEvent } from './protocol'

let state = initialState
const listeners = new Set<() => void>()
export let followBottom = true
export function setFollowBottom(value: boolean) {
  followBottom = value
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
  if (command.type === 'init') followBottom = true
  state = reduceTranscript(state, command)
  document.documentElement.className = `theme-${state.theme.palette} ${state.theme.mode}`
  listeners.forEach(function notify(listener) {
    listener()
  })
}
