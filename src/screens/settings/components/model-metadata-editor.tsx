import { useState } from 'react'
import type { ProviderModel } from '@/lib/app-api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

type ModelMetadataEditorProps = {
  model: ProviderModel
  onSave: (payload: {
    modelId: string
    name: string
    description: string
    contextWindow: number
  }) => Promise<void>
  onReset: (modelId: string) => Promise<void>
  savePending: boolean
  resetPending: boolean
}

export function ModelMetadataEditor({
  model,
  onSave,
  onReset,
  savePending,
  resetPending,
}: ModelMetadataEditorProps) {
  const [name, setName] = useState(model.name ?? '')
  const [description, setDescription] = useState(model.description ?? '')
  const [contextWindow, setContextWindow] = useState(
    model.contextWindow ? String(model.contextWindow) : '',
  )

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const normalizedContextWindow = Number.parseInt(contextWindow, 10)
    await onSave({
      modelId: model.id,
      name: name.trim(),
      description: description.trim(),
      contextWindow:
        Number.isFinite(normalizedContextWindow) && normalizedContextWindow > 0
          ? normalizedContextWindow
          : 0,
    })
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <label
            className="text-xs text-primary-650 font-medium"
            htmlFor="model-name"
          >
            Display name
          </label>
          <Input
            id="model-name"
            value={name}
            onChange={function handleChange(event) {
              setName(event.target.value)
            }}
            placeholder="e.g. GPT-4o Mini Override"
          />
        </div>

        <div className="space-y-1.5">
          <label
            className="text-xs text-primary-650 font-medium"
            htmlFor="model-context-window"
          >
            Context window size
          </label>
          <Input
            id="model-context-window"
            type="number"
            min={0}
            step={1}
            inputMode="numeric"
            value={contextWindow}
            onChange={function handleChange(event) {
              setContextWindow(event.target.value)
            }}
            placeholder="e.g. 128000"
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <label
          className="text-xs text-primary-650 font-medium"
          htmlFor="model-description"
        >
          Description
        </label>
        <textarea
          id="model-description"
          value={description}
          onChange={function handleChange(event) {
            setDescription(event.target.value)
          }}
          rows={3}
          placeholder="Detailed model purpose or custom notes..."
          className="w-full rounded-lg border border-primary-200 bg-surface px-3 py-2 text-sm text-primary-900 outline-none transition-colors hover:border-primary-300 focus:border-primary-400 focus:ring-2 focus:ring-primary-400/20"
        />
      </div>

      <div className="flex items-center gap-2 pt-2 border-t border-primary-100">
        <Button size="sm" type="submit" disabled={savePending} className="h-8">
          {savePending ? 'Saving...' : 'Save Overrides'}
        </Button>
        <Button
          size="sm"
          type="button"
          variant="ghost"
          disabled={resetPending}
          onClick={function handleReset() {
            void onReset(model.id)
          }}
          className="h-8 text-primary-600 hover:text-primary-850 hover:bg-primary-50"
        >
          Reset to Default
        </Button>
      </div>
    </form>
  )
}
