import { Message } from '@/components/prompt-kit/message'
import { cn } from '@/lib/utils'

type MessageItemEditorProps = {
  editDraft: string
  onChangeDraft: (val: string) => void
  onCancel: () => void
  onSave: () => void
  savingEdit: boolean
}

export function MessageItemEditor({
  editDraft,
  onChangeDraft,
  onCancel,
  onSave,
  savingEdit,
}: MessageItemEditorProps) {
  return (
    <Message className="flex-row-reverse">
      <div
        className={cn(
          'max-w-[85%] rounded-lg bg-primary-100 px-3 py-2.5',
          'flex min-w-[min(520px,85vw)] flex-col gap-2',
        )}
      >
        <textarea
          value={editDraft}
          onChange={function handleChange(event) {
            onChangeDraft(event.currentTarget.value)
          }}
          rows={Math.min(8, Math.max(3, editDraft.split('\n').length))}
          autoFocus
          className="max-h-80 min-h-24 w-full resize-y bg-transparent text-sm text-primary-900 outline-none"
        />
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={savingEdit}
            className="rounded-md px-2.5 py-1 text-sm text-primary-700 hover:bg-primary-200 disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onSave}
            disabled={savingEdit || editDraft.trim().length === 0}
            className="rounded-md bg-primary-900 px-2.5 py-1 text-sm text-primary-50 hover:bg-primary-800 disabled:opacity-60"
          >
            {savingEdit ? 'Saving' : 'Save'}
          </button>
        </div>
      </div>
    </Message>
  )
}
