import { useSyncExternalStore } from 'react'
import { getSnapshot, subscribe } from './store'

function getModeSnapshot() {
  return getSnapshot().theme.mode
}

export function useResolvedTheme() {
  // Historical code blocks subscribe only to the mode, so deltas don't rerender them.
  return useSyncExternalStore(subscribe, getModeSnapshot)
}

// MessageItem needs only these render preferences. Native owns persistence and appearance;
// this offline island does not create the web app's storage, router or query providers.
const renderPreferences = {
  settings: {
    showReasoningBlocks: true,
    showToolMessages: true,
    reasoningCollapseMode: 'expanded-while-thinking' as const,
  },
}
export function useChatSettingsStore<T>(
  selector: (state: typeof renderPreferences) => T,
): T {
  return selector(renderPreferences)
}
