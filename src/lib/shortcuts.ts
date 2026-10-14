import type { RegisterableHotkey } from '@tanstack/react-hotkeys'

export type ShortcutBinding = {
  hotkey: RegisterableHotkey
  keys: Array<string>
}
export type Shortcut = {
  id: string
  bindings: Array<ShortcutBinding>
  description: string
  group: 'Navigation' | 'Sessions' | 'Conversation' | 'Composer' | 'General'
  scope: 'global' | 'chat' | 'composer'
  displayKeys?: Array<string>
  editable?: boolean
}

export const shortcutGroups = [
  'Navigation',
  'Sessions',
  'Conversation',
  'Composer',
  'General',
] as const

export const shortcuts = {
  previousMessage: {
    description: 'Previous message',
    group: 'Navigation',
    scope: 'chat',
    bindings: [
      { hotkey: '[', keys: ['['] },
      { hotkey: 'Alt+ArrowUp', keys: ['Alt', '↑'] },
    ],
  },
  nextMessage: {
    description: 'Next message',
    group: 'Navigation',
    scope: 'chat',
    bindings: [
      { hotkey: ']', keys: [']'] },
      { hotkey: 'Alt+ArrowDown', keys: ['Alt', '↓'] },
    ],
  },
  scrollUp: {
    description: 'Scroll up',
    group: 'Navigation',
    scope: 'chat',
    bindings: [{ hotkey: 'K', keys: ['k'] }],
  },
  scrollDown: {
    description: 'Scroll down',
    group: 'Navigation',
    scope: 'chat',
    bindings: [{ hotkey: 'J', keys: ['j'] }],
  },
  newSession: {
    description: 'New session',
    group: 'Sessions',
    scope: 'chat',
    bindings: [{ hotkey: 'Mod+Shift+O', keys: ['Mod', 'Shift', 'O'] }],
  },
  searchSessions: {
    description: 'Search sessions',
    group: 'Sessions',
    scope: 'chat',
    bindings: [{ hotkey: 'Mod+K', keys: ['Mod', 'K'] }],
  },
  previousSession: {
    description: 'Previous session',
    group: 'Sessions',
    scope: 'chat',
    bindings: [{ hotkey: 'Alt+[', keys: ['Alt', '['] }],
  },
  nextSession: {
    description: 'Next session',
    group: 'Sessions',
    scope: 'chat',
    bindings: [{ hotkey: 'Alt+]', keys: ['Alt', ']'] }],
  },
  renameChat: {
    description: 'Rename chat',
    group: 'Sessions',
    scope: 'chat',
    bindings: [{ hotkey: 'F2', keys: ['F2'] }],
  },
  deleteChat: {
    description: 'Delete chat (confirm)',
    group: 'Sessions',
    scope: 'chat',
    bindings: [
      { hotkey: 'Mod+Shift+Backspace', keys: ['Mod', 'Shift', 'Backspace'] },
    ],
  },
  throwaway: {
    description: 'Throwaway mode (empty chat)',
    group: 'Conversation',
    scope: 'chat',
    bindings: [{ hotkey: 'Mod+Shift+P', keys: ['Mod', 'Shift', 'P'] }],
  },
  conversationPanel: {
    description: 'Toggle conversation panel',
    group: 'Conversation',
    scope: 'chat',
    bindings: [
      {
        hotkey: { key: '>', mod: true, shift: true },
        keys: ['Mod', 'Shift', '.'],
      },
    ],
  },
  copyResponse: {
    description: 'Copy last response',
    group: 'Conversation',
    scope: 'chat',
    bindings: [{ hotkey: 'Mod+Shift+C', keys: ['Mod', 'Shift', 'C'] }],
  },
  copyCode: {
    description: 'Copy last code block',
    group: 'Conversation',
    scope: 'chat',
    bindings: [
      {
        hotkey: { key: ':', mod: true, shift: true },
        keys: ['Mod', 'Shift', ';'],
      },
    ],
  },
  modelPicker: {
    description: 'Open model picker',
    group: 'Conversation',
    scope: 'chat',
    bindings: [{ hotkey: 'Mod+Shift+M', keys: ['Mod', 'Shift', 'M'] }],
  },
  focusComposer: {
    description: 'Focus composer',
    group: 'Composer',
    scope: 'chat',
    editable: true,
    bindings: [{ hotkey: 'Shift+Escape', keys: ['Shift', 'Esc'] }],
  },
  stopResponse: {
    description: 'Stop response',
    group: 'Composer',
    scope: 'chat',
    editable: true,
    bindings: [{ hotkey: 'Escape', keys: ['Esc'] }],
  },
  editLastMessage: {
    description: 'Edit last message (empty prompt)',
    group: 'Composer',
    scope: 'composer',
    editable: true,
    bindings: [{ hotkey: 'ArrowUp', keys: ['↑'] }],
  },
  sendMessage: {
    description: 'Send message',
    group: 'Composer',
    scope: 'composer',
    editable: true,
    bindings: [{ hotkey: 'Enter', keys: ['Enter'] }],
  },
  focusByTyping: {
    description: 'Focus composer by typing',
    group: 'Composer',
    scope: 'chat',
    bindings: [],
    displayKeys: ['Any text key'],
  },
  sidebar: {
    description: 'Toggle left sidebar',
    group: 'General',
    scope: 'global',
    bindings: [{ hotkey: 'Mod+Shift+S', keys: ['Mod', 'Shift', 'S'] }],
  },
  settings: {
    description: 'Open settings',
    group: 'General',
    scope: 'global',
    bindings: [{ hotkey: 'Mod+,', keys: ['Mod', ','] }],
  },
  help: {
    description: 'Keyboard shortcuts',
    group: 'General',
    scope: 'global',
    bindings: [
      { hotkey: { key: '?', shift: true }, keys: ['?'] },
      { hotkey: 'Mod+/', keys: ['Mod', '/'] },
    ],
  },
} satisfies Record<string, Omit<Shortcut, 'id'>>

export type ShortcutId = keyof typeof shortcuts
export const shortcutRegistry: Array<Shortcut> = Object.entries(shortcuts).map(
  function entry([id, shortcut]) {
    return { id, ...shortcut }
  },
)

// Pure detection; callers/tests can supply a platform without touching globals.
export function isMacPlatform(platform: string): boolean {
  return /Mac|iPhone|iPad|iPod/i.test(platform)
}
export const shortcutPlatform = isMacPlatform(
  typeof navigator === 'undefined' ? '' : navigator.platform,
)
  ? 'mac'
  : 'other'
export function shortcutKeys(
  keys: Array<string>,
  platform = shortcutPlatform,
): Array<string> {
  return keys.map(function label(key) {
    if (key === 'Mod') return platform === 'mac' ? '⌘' : 'Ctrl'
    if (key === 'Alt') return platform === 'mac' ? '⌥' : 'Alt'
    if (key === 'Backspace') return platform === 'mac' ? '⌫' : 'Backspace'
    if (key === 'Shift') return platform === 'mac' ? '⇧' : 'Shift'
    return key
  })
}
export function shortcutTooltip(text: string, id: ShortcutId): string {
  return `${text}  ${shortcutKeys(shortcuts[id].bindings[0].keys).join(' ')}`
}
