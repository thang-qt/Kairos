import { useState } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import { Add01Icon, Cancel01Icon } from '@hugeicons/core-free-icons'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogRoot,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import type { ProviderRecord } from '@/lib/app-api'

type CustomModelDialogProps = {
  providers: Array<ProviderRecord>
  onAdd: (payload: {
    providerRef: string
    modelId: string
    name: string
    description: string
    contextWindow: number
  }) => Promise<void>
  addPending: boolean
}

export function CustomModelDialog({
  providers,
  onAdd,
  addPending,
}: CustomModelDialogProps) {
  const [open, setOpen] = useState(false)
  const [providerRef, setProviderRef] = useState('')
  const [modelId, setModelId] = useState('')
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [contextWindow, setContextWindow] = useState('')

  const enabledProviders = providers.filter(function isEnabled(p) {
    return p.enabled
  })

  function handleOpenChange(isOpen: boolean) {
    setOpen(isOpen)
    if (isOpen) {
      setProviderRef(enabledProviders[0]?.ref ?? '')
      setModelId('')
      setName('')
      setDescription('')
      setContextWindow('')
    }
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!providerRef || !modelId || !name) return

    const normalizedContextWindow = Number.parseInt(contextWindow, 10)
    await onAdd({
      providerRef,
      modelId: modelId.trim(),
      name: name.trim(),
      description: description.trim(),
      contextWindow:
        Number.isFinite(normalizedContextWindow) && normalizedContextWindow > 0
          ? normalizedContextWindow
          : 0,
    })
    setOpen(false)
  }

  return (
    <DialogRoot open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger
        render={
          <Button
            size="sm"
            variant="outline"
            className="h-9 gap-2 bg-surface hover:bg-primary-50 hover:text-primary-955 border-primary-200"
          >
            <HugeiconsIcon icon={Add01Icon} size={20} strokeWidth={1.5} />
            <span>Add Custom Model</span>
          </Button>
        }
      />
      <DialogContent className="w-[min(500px,95vw)] p-6 overflow-hidden bg-primary-50">
        <div className="flex items-center justify-between">
          <div>
            <DialogTitle className="tracking-tight font-medium text-primary-950 text-lg">
              Add Custom Model
            </DialogTitle>
            <DialogDescription className="mt-1 text-xs text-primary-500">
              Register a model that isn't automatically synced from the
              connection endpoint.
            </DialogDescription>
          </div>
          <DialogClose
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                className="h-8 w-8 text-primary-500 hover:bg-primary-100"
              >
                <HugeiconsIcon
                  icon={Cancel01Icon}
                  size={20}
                  strokeWidth={1.5}
                />
              </Button>
            }
          />
        </div>

        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          <div className="space-y-1.5">
            <label
              className="text-xs text-primary-650 font-medium"
              htmlFor="custom-model-provider"
            >
              Provider Connection
            </label>
            <select
              id="custom-model-provider"
              value={providerRef}
              onChange={function handleChange(event) {
                setProviderRef(event.target.value)
              }}
              className="w-full rounded-lg border border-primary-200 bg-surface px-3 py-2 text-sm text-primary-900 outline-none transition-colors hover:border-primary-300 focus:border-primary-400 focus:ring-2 focus:ring-primary-400/20"
              required
            >
              {enabledProviders.map(function renderOption(p) {
                return (
                  <option key={p.ref} value={p.ref}>
                    {p.label} ({p.owner === 'system' ? 'System' : 'Custom'})
                  </option>
                )
              })}
            </select>
          </div>

          <div className="space-y-1.5">
            <label
              className="text-xs text-primary-650 font-medium"
              htmlFor="custom-model-id"
            >
              Model ID
            </label>
            <Input
              id="custom-model-id"
              value={modelId}
              onChange={function handleChange(event) {
                setModelId(event.target.value)
              }}
              placeholder="e.g. meta-llama/llama-3-8b-instruct or phi3"
              required
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label
                className="text-xs text-primary-650 font-medium"
                htmlFor="custom-model-name"
              >
                Display Name
              </label>
              <Input
                id="custom-model-name"
                value={name}
                onChange={function handleChange(event) {
                  setName(event.target.value)
                }}
                placeholder="e.g. Llama 3 Instruct"
                required
              />
            </div>

            <div className="space-y-1.5">
              <label
                className="text-xs text-primary-650 font-medium"
                htmlFor="custom-model-context"
              >
                Context Window Size
              </label>
              <Input
                id="custom-model-context"
                type="number"
                min={0}
                step={1}
                inputMode="numeric"
                value={contextWindow}
                onChange={function handleChange(event) {
                  setContextWindow(event.target.value)
                }}
                placeholder="e.g. 8192"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label
              className="text-xs text-primary-650 font-medium"
              htmlFor="custom-model-description"
            >
              Description (Optional)
            </label>
            <textarea
              id="custom-model-description"
              value={description}
              onChange={function handleChange(event) {
                setDescription(event.target.value)
              }}
              rows={3}
              placeholder="Detailed model notes, parameters or purpose..."
              className="w-full rounded-lg border border-primary-200 bg-surface px-3 py-2 text-sm text-primary-900 outline-none transition-colors hover:border-primary-300 focus:border-primary-400 focus:ring-2 focus:ring-primary-400/20"
            />
          </div>

          <div className="flex items-center justify-end gap-2 pt-4 border-t border-primary-100">
            <DialogClose
              render={
                <Button
                  variant="ghost"
                  type="button"
                  className="h-8 text-primary-655 hover:text-primary-850 hover:bg-primary-50"
                >
                  Cancel
                </Button>
              }
            />
            <Button
              type="submit"
              disabled={addPending || !providerRef || !modelId || !name}
              className="h-8"
            >
              {addPending ? 'Adding...' : 'Add Model'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </DialogRoot>
  )
}
