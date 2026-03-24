'use client'

import {
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogRoot,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'

type UserTurnDeleteDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  messagePreview: string
  onConfirm: () => void
  onCancel: () => void
}

export function UserTurnDeleteDialog({
  open,
  onOpenChange,
  messagePreview,
  onConfirm,
  onCancel,
}: UserTurnDeleteDialogProps) {
  const preview =
    messagePreview.trim().length > 0 ? messagePreview.trim() : 'this message'

  return (
    <AlertDialogRoot open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <div className="p-4">
          <AlertDialogTitle className="mb-1">Delete message</AlertDialogTitle>
          <AlertDialogDescription className="mb-4">
            This creates a new branch without "{preview}" and removes everything
            after it in that new branch. Your current branch stays unchanged.
          </AlertDialogDescription>
          <div className="flex justify-end gap-2">
            <AlertDialogCancel onClick={onCancel}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={onConfirm}>
              Delete and branch
            </AlertDialogAction>
          </div>
        </div>
      </AlertDialogContent>
    </AlertDialogRoot>
  )
}
