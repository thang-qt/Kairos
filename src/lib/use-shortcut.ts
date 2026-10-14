import { useHotkey } from '@tanstack/react-hotkeys'
import { shortcuts } from './shortcuts'
import type { Shortcut, ShortcutId } from './shortcuts'
import { canHandleShortcut, isShortcutEditableTarget } from './shortcut-events'

export function useShortcut(
  id: ShortcutId,
  callback: (event: KeyboardEvent) => void,
  enabled = true,
  bindingIndex = 0,
) {
  const shortcut: Omit<Shortcut, 'id'> = shortcuts[id]
  const binding = shortcut.bindings[bindingIndex]
  const allowsEditing =
    shortcut.editable ||
    (typeof binding.hotkey === 'string'
      ? /Mod|Alt/.test(binding.hotkey)
      : Boolean(binding.hotkey.mod || binding.hotkey.alt))
  useHotkey(
    binding.hotkey,
    function handleShortcut(event) {
      if (
        !canHandleShortcut(event) ||
        (!allowsEditing && isShortcutEditableTarget(event.target))
      )
        return
      callback(event)
    },
    {
      enabled,
      ignoreInputs: false,
      preventDefault: false,
      stopPropagation: false,
    },
  )
}
