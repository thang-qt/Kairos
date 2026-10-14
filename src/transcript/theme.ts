import { useSyncExternalStore } from 'react'
import { getSnapshot, subscribe } from './store'

function getModeSnapshot() {
  return getSnapshot().theme.mode
}

export function useResolvedTheme() {
  // Historical code blocks subscribe only to the mode, so deltas don't rerender them.
  return useSyncExternalStore(subscribe, getModeSnapshot)
}
