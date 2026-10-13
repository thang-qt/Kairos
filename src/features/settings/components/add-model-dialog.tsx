import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { appQueryKeys, createCustomModel } from '@/lib/app-api'
import type { ProviderRecord } from '@/lib/app-api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import {
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogRoot,
  DialogTitle,
} from '@/components/ui/dialog'
import { mutationErrorMessage } from '@/lib/error-utils'
import { SettingsField, SettingsNotice } from './settings-layout'

type AddModelDialogProps = {
  open: boolean
  providers: Array<ProviderRecord>
  onOpenChange: (open: boolean) => void
}

// Registers a model the provider doesn't list itself.
export function AddModelDialog({
  open,
  providers,
  onOpenChange,
}: AddModelDialogProps) {
  return (
    <DialogRoot open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(480px,94vw)] bg-surface p-5">
        {open ? (
          <AddModelForm
            providers={providers.filter((provider) => provider.enabled)}
            onDone={() => onOpenChange(false)}
          />
        ) : null}
      </DialogContent>
    </DialogRoot>
  )
}

function AddModelForm({
  providers,
  onDone,
}: {
  providers: Array<ProviderRecord>
  onDone: () => void
}) {
  const queryClient = useQueryClient()
  const [providerRef, setProviderRef] = useState(providers[0]?.ref ?? '')
  const [modelId, setModelId] = useState('')
  const [name, setName] = useState('')
  const [contextWindow, setContextWindow] = useState('')
  const mutation = useMutation({
    mutationFn: createCustomModel,
    onSuccess: async function added() {
      await queryClient.invalidateQueries({ queryKey: appQueryKeys.models })
      onDone()
    },
  })
  const contextNumber = Number.parseInt(contextWindow, 10)

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault()
        if (!providerRef || !modelId.trim()) return
        mutation.mutate({
          providerRef,
          modelId: modelId.trim(),
          name: name.trim() || modelId.trim(),
          contextWindow:
            Number.isFinite(contextNumber) && contextNumber > 0
              ? contextNumber
              : 0,
        })
      }}
    >
      <div>
        <DialogTitle className="text-base tracking-tight">
          Add model
        </DialogTitle>
        <DialogDescription className="mt-0.5 text-pretty text-xs">
          For models your provider serves but doesn’t list. Use the exact ID the
          provider expects.
        </DialogDescription>
      </div>
      <SettingsField label="Provider" htmlFor="add-model-provider">
        <Select
          id="add-model-provider"
          className="w-full"
          value={providerRef}
          options={providers.map((provider) => ({
            value: provider.ref,
            label: provider.label,
          }))}
          onValueChange={setProviderRef}
        />
      </SettingsField>
      <SettingsField label="Model ID" htmlFor="add-model-id">
        <Input
          id="add-model-id"
          nativeInput
          className="font-mono"
          value={modelId}
          placeholder="meta-llama/llama-3.1-8b-instruct"
          onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
            setModelId(event.target.value)
          }
        />
      </SettingsField>
      <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_9rem]">
        <SettingsField label="Display name" htmlFor="add-model-name">
          <Input
            id="add-model-name"
            nativeInput
            value={name}
            placeholder={modelId || 'Optional'}
            onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
              setName(event.target.value)
            }
          />
        </SettingsField>
        <SettingsField label="Context window" htmlFor="add-model-context">
          <Input
            id="add-model-context"
            nativeInput
            type="number"
            min={0}
            inputMode="numeric"
            className="tabular-nums"
            value={contextWindow}
            placeholder="Optional"
            onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
              setContextWindow(event.target.value)
            }
          />
        </SettingsField>
      </div>
      {providers.length === 0 ? (
        <SettingsNotice>Turn on a provider first.</SettingsNotice>
      ) : null}
      {mutation.error ? (
        <SettingsNotice tone="error">
          {mutationErrorMessage(mutation.error, 'Failed to add the model.')}
        </SettingsNotice>
      ) : null}
      <div className="flex justify-end gap-2">
        <DialogClose
          render={<Button type="button" size="sm" variant="ghost" />}
        >
          Cancel
        </DialogClose>
        <Button
          type="submit"
          size="sm"
          disabled={mutation.isPending || !providerRef || !modelId.trim()}
        >
          {mutation.isPending ? 'Adding…' : 'Add model'}
        </Button>
      </div>
    </form>
  )
}
