export const defaultHotkey = 'Control+Alt+Space'

export type HotkeyAction = 'show' | 'new-chat'

export function isHotkeyAction(value: unknown): value is HotkeyAction {
  return value === 'show' || value === 'new-chat'
}
