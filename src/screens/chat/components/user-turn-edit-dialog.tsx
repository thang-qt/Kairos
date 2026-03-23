'use client'

import type { FormEvent } from 'react'
import {
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogRoot,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'

type UserTurnEditDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  initialMessage: string
  onSave: (nextMessage: string) => void
  onCancel: () => void
}

export function UserTurnEditDialog({
  open,
  onOpenChange,
  initialMessage,
  onSave,
  onCancel,
}: UserTurnEditDialogProps) {
  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const formData = new FormData(event.currentTarget)
    const nextMessage = String(formData.get('message') ?? '')
    onSave(nextMessage)
  }

  return (
    <DialogRoot open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(560px,92vw)]">
        <form className="p-4" onSubmit={handleSubmit}>
          <DialogTitle className="mb-1">Edit message</DialogTitle>
          <DialogDescription className="mb-4">
            This creates a new branch from this point and regenerates the reply.
            Your current branch stays unchanged.
          </DialogDescription>
          <textarea
            key={initialMessage}
            name="message"
            defaultValue={initialMessage}
            rows={6}
            autoFocus
            className="min-h-36 w-full resize-y rounded-lg border border-primary-200 bg-primary-50 px-3 py-2 text-sm text-primary-900 outline-none focus:border-primary-400"
            placeholder="Edit your message"
          />
          <div className="mt-4 flex justify-end gap-2">
            <DialogClose onClick={onCancel}>Cancel</DialogClose>
            <Button type="submit">Save and regenerate</Button>
          </div>
        </form>
      </DialogContent>
    </DialogRoot>
  )
}
