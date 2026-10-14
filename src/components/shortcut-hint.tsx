import { shortcuts, shortcutKeys } from '@/lib/shortcuts'
import type { ShortcutId } from '@/lib/shortcuts'
import { cn } from '@/lib/utils'

export function ShortcutHint({
  id,
  className,
}: {
  id: ShortcutId
  className?: string
}) {
  const shortcut = shortcuts[id]
  const bindings =
    'displayKeys' in shortcut
      ? [{ keys: shortcut.displayKeys }]
      : shortcut.bindings
  return (
    <span className={cn('inline-flex items-center gap-1 shrink-0', className)}>
      {bindings.map(function binding(binding, index) {
        return (
          <span key={index} className="inline-flex items-center gap-0.5">
            {index > 0 ? (
              <span className="px-1 text-primary-500">/</span>
            ) : null}
            {shortcutKeys(binding.keys).map(function key(label, keyIndex) {
              return (
                <kbd
                  key={keyIndex}
                  className="rounded border border-primary-200/80 bg-primary-200/50 px-1 py-0.5 font-mono text-[10px] font-medium text-primary-800 tabular-nums shadow-xs"
                >
                  {label}
                </kbd>
              )
            })}
          </span>
        )
      })}
    </span>
  )
}
