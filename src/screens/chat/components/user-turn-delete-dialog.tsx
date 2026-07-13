'use client'

import {
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogRoot,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'

const maxDeletePreviewLength = 160

function formatDeletePreview(value: string): string {
  const normalized = value.trim().replace(/\s+/g, ' ')
  if (normalized.length === 0) return 'this message'
  if (normalized.length <= maxDeletePreviewLength) return normalized
  return normalized.slice(0, maxDeletePreviewLength - 1).trimEnd() + '…'
}

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
  const preview = formatDeletePreview(messagePreview)

  return (
    <AlertDialogRoot open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <div className="p-4">
          <AlertDialogTitle className="mb-1">Delete message</AlertDialogTitle>
          <AlertDialogDescription className="mb-4">
            This removes "{preview}" and everything after it from this
            conversation.
          </AlertDialogDescription>
          <div className="flex justify-end gap-2">
            <AlertDialogCancel onClick={onCancel}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={onConfirm}>Delete</AlertDialogAction>
          </div>
        </div>
      </AlertDialogContent>
    </AlertDialogRoot>
  )
}
