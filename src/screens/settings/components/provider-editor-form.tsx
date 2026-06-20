import { HugeiconsIcon } from '@hugeicons/react'
import {
  Cancel01Icon,
  Loading03Icon,
  Tick02Icon,
  Add01Icon,
} from '@hugeicons/core-free-icons'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

type ProviderDraftState = {
  label: string
  baseURL: string
  apiKey: string
}

type ProviderEditorFormProps = {
  mode: 'add' | 'edit'
  draft: ProviderDraftState
  canAddCustomBaseUrl: boolean
  updateDraft: (key: keyof ProviderDraftState, value: string) => void
  onCancel: () => void
  onTestConnection: () => Promise<void>
  testingConnection: boolean
  testResult: { success: boolean; message: string } | null
  onSubmit: () => void
  submitPending: boolean
}

export function ProviderEditorForm({
  mode,
  draft,
  canAddCustomBaseUrl,
  updateDraft,
  onCancel,
  onTestConnection,
  testingConnection,
  testResult,
  onSubmit,
  submitPending,
}: ProviderEditorFormProps) {
  const isEdit = mode === 'edit'

  return (
    <div
      className={cn(
        'space-y-3 transition-all duration-200',
        isEdit
          ? 'border-t border-primary-200/65 p-4 bg-primary-50/10'
          : 'rounded-xl border border-primary-300 bg-surface p-4',
      )}
    >
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-primary-955 uppercase tracking-wider">
          {isEdit ? 'Edit Provider Credentials' : 'Add Custom Provider'}
        </span>
        <Button
          size="icon-sm"
          variant="ghost"
          onClick={onCancel}
          className="text-primary-500 hover:bg-primary-100 h-6 w-6"
        >
          <HugeiconsIcon icon={Cancel01Icon} size={16} strokeWidth={1.5} />
        </Button>
      </div>

      <div className="space-y-2.5">
        <Input
          placeholder={isEdit ? 'Friendly Label' : 'Provider Label'}
          value={draft.label}
          onChange={function handleChange(event) {
            updateDraft('label', event.target.value)
          }}
        />
        <Input
          placeholder="Base URL Endpoint"
          value={draft.baseURL}
          disabled={!canAddCustomBaseUrl}
          onChange={function handleChange(event) {
            updateDraft('baseURL', event.target.value)
          }}
        />
        <Input
          placeholder={isEdit ? 'API Key (Hidden)' : 'API Key / Token Secret'}
          type="password"
          value={draft.apiKey}
          onChange={function handleChange(event) {
            updateDraft('apiKey', event.target.value)
          }}
        />
        {isEdit && (
          <p className="text-[10px] text-primary-400">
            Leave empty to keep current secret.
          </p>
        )}
      </div>

      {testResult ? (
        <div
          className={cn(
            'flex items-center gap-2 text-xs py-1.5 px-3 rounded-lg border',
            testResult.success
              ? 'bg-primary-50 border-primary-200 text-primary-800'
              : 'bg-red-50 border-red-200 text-red-700',
          )}
        >
          <HugeiconsIcon
            icon={testResult.success ? Tick02Icon : Cancel01Icon}
            size={16}
            strokeWidth={1.5}
          />
          <span className="truncate">{testResult.message}</span>
        </div>
      ) : null}

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between pt-1">
        <Button
          size="sm"
          variant="outline"
          onClick={onTestConnection}
          disabled={testingConnection}
          className="h-8 border-primary-200 w-full sm:w-auto"
        >
          {testingConnection ? (
            <HugeiconsIcon
              icon={Loading03Icon}
              size={16}
              strokeWidth={1.5}
              className="animate-spin"
            />
          ) : (
            'Test Connection'
          )}
        </Button>
        <Button
          size="sm"
          onClick={onSubmit}
          disabled={submitPending}
          className="h-8 gap-1 w-full sm:w-auto"
        >
          <HugeiconsIcon
            icon={isEdit ? Tick02Icon : Add01Icon}
            size={16}
            strokeWidth={1.5}
          />
          <span>{isEdit ? 'Save Changes' : 'Add Provider'}</span>
        </Button>
      </div>
    </div>
  )
}
