import { Dialog } from '@base-ui/react/dialog'
import { ShortcutHint } from '@/components/shortcut-hint'
import { shortcutGroups, shortcutRegistry } from '@/lib/shortcuts'
import type { ShortcutId } from '@/lib/shortcuts'

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
        <Dialog.Popup className="fixed right-4 bottom-4 z-50 flex max-h-[calc(100dvh-2rem)] w-[min(26rem,calc(100vw-2rem))] flex-col rounded-2xl border border-primary-200 bg-primary-50 p-4 shadow-2xl">
          <div className="mb-3 flex items-center justify-between shrink-0">
            <Dialog.Title className="text-balance text-sm font-medium text-primary-900">
              Keyboard Shortcuts
            </Dialog.Title>
            <Dialog.Close
              className="cursor-pointer text-xs text-primary-500 hover:text-primary-800 hover:underline"
              render={<button type="button">Close</button>}
            />
          </div>
          <div className="min-h-0 overflow-y-auto space-y-3">
            {shortcutGroups.map(function group(group) {
              return (
                <div key={group}>
                  <h3 className="mb-1 text-balance text-[10px] font-medium uppercase text-primary-400">
                    {group}
                  </h3>
                  <div className="space-y-1.5">
                    {shortcutRegistry
                      .filter(function inGroup(item) {
                        return item.group === group
                      })
                      .map(function item(item) {
                        return (
                          <div
                            key={item.id}
                            data-shortcut-id={item.id}
                            className="flex items-center justify-between gap-2 text-xs"
                          >
                            <span className="text-pretty text-primary-700">
                              {item.description}
                            </span>
                            <ShortcutHint id={item.id as ShortcutId} />
                          </div>
                        )
                      })}
                  </div>
                </div>
              )
            })}
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
