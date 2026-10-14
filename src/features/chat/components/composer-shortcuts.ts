import { useShortcut } from '@/lib/use-shortcut'
import { canHandleShortcut, hasShortcutModal } from '@/lib/shortcut-events'
import { useEffect } from 'react'
import { matchesKeyboardEvent } from '@tanstack/react-hotkeys'
import { shortcuts } from '@/lib/shortcuts'
import type { KeyboardEvent as ReactKeyboardEvent, RefObject } from 'react'

export function useComposerShortcuts(
  promptRef: RefObject<HTMLTextAreaElement | null>,
  canStop: boolean,
  onStop?: () => void,
) {
  useShortcut(
    'stopResponse',
    function stop(event) {
      event.preventDefault()
      onStop?.()
    },
    canStop && Boolean(onStop),
  )
  // Capture Shift+Escape before overlay dismiss handlers, which otherwise
  // treat it as Escape. Focus is an imperative subscription, not render state.
  useEffect(
    function bindFocusShortcut() {
      function focus(event: KeyboardEvent) {
        if (
          !matchesKeyboardEvent(
            event,
            shortcuts.focusComposer.bindings[0].hotkey,
          ) ||
          event.isComposing
        )
          return
        event.stopPropagation()
        if (event.defaultPrevented) return
        event.preventDefault()
        if (hasShortcutModal()) return
        const prompt = promptRef.current
        if (prompt && !prompt.closest('[hidden]')) prompt.focus()
      }
      document.addEventListener('keydown', focus, true)
      return function unbindFocusShortcut() {
        document.removeEventListener('keydown', focus, true)
      }
    },
    [promptRef],
  )
}

export function editLastMessageFromComposer(
  event: ReactKeyboardEvent<HTMLTextAreaElement>,
) {
  const prompt = event.currentTarget
  if (
    event.key !== shortcuts.editLastMessage.bindings[0].hotkey ||
    event.shiftKey ||
    event.altKey ||
    event.ctrlKey ||
    event.metaKey ||
    prompt.value !== '' ||
    prompt.selectionStart !== 0 ||
    prompt.selectionEnd !== 0 ||
    prompt.readOnly ||
    document.activeElement !== prompt ||
    !canHandleShortcut(event.nativeEvent)
  )
    return
  const messages = document.querySelectorAll('[data-message-role="user"]')
  const lastMessage = messages[messages.length - 1]
  const editButton = lastMessage?.querySelector<HTMLButtonElement>(
    '[data-edit-user-message]',
  )
  if (!editButton || editButton.closest('[inert]')) return
  event.preventDefault()
  lastMessage.scrollIntoView?.({ block: 'nearest' })
  editButton.click()
}
