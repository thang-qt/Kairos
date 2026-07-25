'use client'

import { Dialog } from '@base-ui/react/dialog'

type ShortcutItem = {
  keys: Array<string>
  description: string
}

type ShortcutGroup = {
  title: string
  items: Array<ShortcutItem>
}

const SHORTCUT_GROUPS: Array<ShortcutGroup> = [
  {
    title: 'Navigation',
    items: [
      { keys: ['['], description: 'Jump to previous message' },
      { keys: [']'], description: 'Jump to next message' },
      { keys: ['Alt', '↑'], description: 'Jump to previous message (global)' },
      { keys: ['Alt', '↓'], description: 'Jump to next message (global)' },
    ],
  },
  {
    title: 'Scrolling',
    items: [
      { keys: ['k'], description: 'Scroll page up' },
      { keys: ['j'], description: 'Scroll page down' },
    ],
  },
  {
    title: 'Sessions',
    items: [
      { keys: ['⌘/Ctrl', 'Shift', 'O'], description: 'New Session' },
      { keys: ['⌘/Ctrl', 'Shift', 'P'], description: 'Throwaway mode' },
      { keys: ['⌘/Ctrl', 'K'], description: 'Search sessions' },
      { keys: ['Alt', '['], description: 'Previous session' },
      { keys: ['Alt', ']'], description: 'Next session' },
    ],
  },
  {
    title: 'General',
    items: [{ keys: ['?'], description: 'Toggle shortcuts help' }],
  },
]

type ShortcutsHelpDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function ShortcutsHelpDialog({
  open,
  onOpenChange,
}: ShortcutsHelpDialogProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange} modal={false}>
      <Dialog.Portal>
        <Dialog.Popup className="fixed left-auto top-auto right-6 bottom-6 translate-x-0 translate-y-0 w-80 rounded-[20px] border border-primary-200 bg-primary-50 p-0 shadow-2xl transition-all duration-150 data-[state=open]:opacity-100 data-[state=closed]:opacity-0 data-[state=open]:scale-100 data-[state=closed]:scale-95 z-50">
          <div className="p-4">
            <div className="flex items-center justify-between mb-3">
              <Dialog.Title className="text-sm font-medium text-primary-900 tracking-tight">
                Keyboard Shortcuts
              </Dialog.Title>
              <Dialog.Close
                className="text-xs text-primary-500 hover:text-primary-800 hover:underline cursor-pointer"
                render={<button type="button">Close</button>}
              />
            </div>
            <div className="space-y-4">
              {SHORTCUT_GROUPS.map(function renderGroup(group) {
                return (
                  <div key={group.title}>
                    <h3 className="text-[10px] font-medium text-primary-400 uppercase tracking-wider mb-1">
                      {group.title}
                    </h3>
                    <div className="space-y-1.5">
                      {group.items.map(function renderItem(item, idx) {
                        return (
                          <div
                            key={idx}
                            className="flex items-center justify-between text-xs"
                          >
                            <span className="text-primary-700">
                              {item.description}
                            </span>
                            <div className="flex items-center gap-1">
                              {item.keys.map(function renderKey(key, keyIdx) {
                                return (
                                  <kbd
                                    key={keyIdx}
                                    className="bg-primary-200/50 border border-primary-200/80 rounded px-1.5 py-0.5 text-[10px] font-mono font-medium text-primary-800 tabular-nums shadow-[0_1px_0_rgba(0,0,0,0.05)]"
                                  >
                                    {key}
                                  </kbd>
                                )
                              })}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
