import { useRef } from 'react'
import { Input } from '@/components/ui/input'
import {
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogRoot,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'

type SessionRenameDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  sessionTitle: string
  onSave: (newTitle: string) => void
  onCancel: () => void
}

export function SessionRenameDialog({
  open,
  onOpenChange,
  sessionTitle,
  onSave,
  onCancel,
}: SessionRenameDialogProps) {
  const inputRef = useRef<HTMLInputElement>(null)

  return (
    <DialogRoot open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <div className="p-5">
          <DialogTitle className="mb-1.5">Rename</DialogTitle>
          <DialogDescription className="mb-5">
            Enter a new name for this session.
          </DialogDescription>
          <Input
            nativeInput
            ref={inputRef}
            aria-label="Session name"
            type="text"
            defaultValue={sessionTitle}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                onSave(e.currentTarget.value)
              }
            }}
            placeholder="Session name"
            autoFocus
          />
          <div className="mt-5 flex flex-wrap justify-end gap-2">
            <DialogClose onClick={onCancel}>Cancel</DialogClose>
            <Button
              size="sm"
              onClick={function saveTitle() {
                if (inputRef.current) onSave(inputRef.current.value)
              }}
            >
              Save
            </Button>
          </div>
        </div>
      </DialogContent>
    </DialogRoot>
  )
}
