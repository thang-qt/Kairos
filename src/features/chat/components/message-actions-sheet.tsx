import { createContext, useContext, useState } from 'react'
import { Dialog } from '@base-ui/react/dialog'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  Copy01Icon,
  CopyLinkIcon,
  Delete01Icon,
  MoreHorizontalIcon,
  PencilEdit02Icon,
} from '@hugeicons/core-free-icons'

type MessageActions = {
  onCopy: () => void
  onEdit?: () => void
  onClone?: () => void
  onDelete?: () => void
}

const SheetHandleContext = createContext<Dialog.Handle<MessageActions> | null>(
  null,
)

// Detached triggers share one dialog store. Opening it never updates the list.
export function MessageActionsSheet({
  children,
}: {
  children: React.ReactNode
}) {
  const [handle] = useState(function createHandle() {
    return Dialog.createHandle<MessageActions>()
  })

  return (
    <SheetHandleContext value={handle}>
      {children}
      <Dialog.Root handle={handle}>
        {function renderSheet({ payload }) {
          return (
            <Dialog.Portal>
              <Dialog.Backdrop className="fixed inset-0 z-50 bg-primary-950/20" />
              <Dialog.Popup className="fixed inset-x-0 bottom-0 z-50 rounded-t-2xl border border-primary-200 bg-primary-50 pb-[env(safe-area-inset-bottom)] shadow-lg">
                <div className="px-4 pt-3 pb-4">
                  <div
                    aria-hidden
                    className="mx-auto mb-3 h-1 w-10 rounded-full bg-primary-300"
                  />
                  <Dialog.Title className="sr-only text-balance">
                    Message actions
                  </Dialog.Title>
                  {payload ? (
                    <>
                      <SheetAction
                        icon={Copy01Icon}
                        label="Copy"
                        onClick={payload.onCopy}
                      />
                      {payload.onEdit ? (
                        <SheetAction
                          icon={PencilEdit02Icon}
                          label="Edit"
                          onClick={payload.onEdit}
                        />
                      ) : null}
                      {payload.onClone ? (
                        <SheetAction
                          icon={CopyLinkIcon}
                          label="Fork"
                          onClick={payload.onClone}
                        />
                      ) : null}
                      {payload.onDelete ? (
                        <SheetAction
                          icon={Delete01Icon}
                          label="Delete"
                          onClick={payload.onDelete}
                        />
                      ) : null}
                    </>
                  ) : null}
                  <Dialog.Close className="sr-only">Close</Dialog.Close>
                </div>
              </Dialog.Popup>
            </Dialog.Portal>
          )
        }}
      </Dialog.Root>
    </SheetHandleContext>
  )
}

function SheetAction({
  icon,
  label,
  onClick,
}: {
  icon: typeof Copy01Icon
  label: string
  onClick: () => void
}) {
  return (
    <Dialog.Close
      onClick={onClick}
      className="flex h-12 w-full items-center gap-3 rounded-lg px-3 text-pretty text-sm text-primary-900 hover:bg-primary-100 focus-visible:bg-primary-100"
    >
      <HugeiconsIcon icon={icon} size={20} strokeWidth={1.5} />
      {label}
    </Dialog.Close>
  )
}

export function MessageActionsSheetTrigger(actions: MessageActions) {
  const handle = useContext(SheetHandleContext)
  if (!handle) return null

  return (
    <Dialog.Trigger
      handle={handle}
      payload={actions}
      aria-label="More message actions"
      className="inline-flex size-10 items-center justify-center rounded text-primary-700 hover:bg-primary-100 hover:text-primary-900"
    >
      <HugeiconsIcon icon={MoreHorizontalIcon} size={20} strokeWidth={1.5} />
    </Dialog.Trigger>
  )
}
