export function isShortcutEditableTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    Boolean(
      target.closest(
        'input, textarea, select, [contenteditable]:not([contenteditable="false"])',
      ),
    )
  )
}

function hasOpenElement(selector: string): boolean {
  return Array.from(document.querySelectorAll(selector)).some(
    function isOpen(element) {
      return !element.closest(
        '[hidden], [inert], [aria-hidden="true"], [data-closed]',
      )
    },
  )
}

export function canHandleShortcut(event: KeyboardEvent): boolean {
  return !event.defaultPrevented && !event.isComposing && !hasShortcutOverlay()
}

export function hasShortcutOverlay(): boolean {
  return hasOpenElement(
    '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"], [data-shortcut-overlay]',
  )
}
export function hasShortcutModal(): boolean {
  return hasOpenElement(
    '[role="dialog"]:not([aria-modal="false"]), [role="alertdialog"]:not([aria-modal="false"])',
  )
}
