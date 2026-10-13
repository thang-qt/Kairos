import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { HugeiconsIcon } from '@hugeicons/react'
import { Cancel01Icon } from '@hugeicons/core-free-icons'
import {
  appQueryKeys,
  deleteCustomModel,
  updateChatSettingsPreferences,
  updateModelMetadata,
  useChatSettingsPreferencesQuery,
} from '@/lib/app-api'
import type { ProviderModel } from '@/lib/app-api'
import type { ConversationSettings } from '@/features/chat/conversation-settings'
import { ModelSettingsPanel } from '@/features/chat/components/model-settings-panel'
import { ModelDetails } from '@/components/model-details'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import {
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogRoot,
  DialogTitle,
} from '@/components/ui/dialog'
import { Tabs, TabsList, TabsPanel, TabsTab } from '@/components/ui/tabs'
import { mutationErrorMessage } from '@/lib/error-utils'
import { formatContextWindow, providerModelKey } from '@/lib/model-utils'
import { useUpdatePreferences } from '../hooks/use-update-preferences'
import {
  ConfirmButton,
  SettingsBadge,
  SettingsField,
  SettingsNotice,
  SettingsRow,
  TEXTAREA_CLASS,
} from './settings-layout'

type ModelDialogProps = {
  model: ProviderModel | null
  models: Array<ProviderModel>
  defaultModelId?: string
  canSetDefault: boolean
  onClose: () => void
}

// Everything about one model: its name and limits, and the chat settings new
// conversations get when they start with it.
export function ModelDialog({
  model,
  models,
  defaultModelId,
  canSetDefault,
  onClose,
}: ModelDialogProps) {
  return (
    <DialogRoot
      open={model !== null}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent className="flex max-h-[85vh] w-[min(560px,94vw)] flex-col overflow-hidden bg-surface">
        {model ? (
          <ModelDialogBody
            key={providerModelKey(model)}
            model={model}
            models={models}
            defaultModelId={defaultModelId}
            canSetDefault={canSetDefault}
            onClose={onClose}
          />
        ) : null}
      </DialogContent>
    </DialogRoot>
  )
}

function ModelDialogBody({
  model,
  models,
  defaultModelId,
  canSetDefault,
  onClose,
}: Omit<ModelDialogProps, 'model'> & { model: ProviderModel }) {
  const modelKey = providerModelKey(model)
  const isDefault = defaultModelId === modelKey
  const preferencesMutation = useUpdatePreferences()

  return (
    <>
      <div className="flex items-start justify-between gap-3 border-b border-primary-200 p-5 pb-4">
        <div className="min-w-0">
          <DialogTitle className="flex flex-wrap items-center gap-2 text-balance text-base tracking-tight">
            {model.name || model.id}
            {isDefault ? <SettingsBadge>Default</SettingsBadge> : null}
            {model.isCustom ? (
              <SettingsBadge>Added by you</SettingsBadge>
            ) : null}
          </DialogTitle>
          <DialogDescription className="mt-0.5 truncate text-xs">
            {model.providerLabel || model.owned_by} ·{' '}
            <span className="font-mono">{model.id}</span>
          </DialogDescription>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {canSetDefault && !isDefault ? (
            <Button
              size="sm"
              variant="outline"
              disabled={preferencesMutation.isPending}
              onClick={() =>
                preferencesMutation.mutate({ defaultModelId: modelKey })
              }
            >
              Make default
            </Button>
          ) : null}
          <DialogClose
            render={
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label="Close"
                className="text-primary-500"
              />
            }
          >
            <HugeiconsIcon icon={Cancel01Icon} size={20} strokeWidth={1.5} />
          </DialogClose>
        </div>
      </div>

      <Tabs defaultValue="details" className="min-h-0 flex-1 gap-0">
        <TabsList className="mx-5 mt-3 w-auto self-start bg-primary-100/70 *:data-[slot=tab-indicator]:bg-surface *:data-[slot=tab-indicator]:shadow-xs/5">
          <TabsTab value="details" className="h-7 px-3 text-xs">
            Details
          </TabsTab>
          <TabsTab value="chat" className="h-7 px-3 text-xs">
            Chat settings
          </TabsTab>
        </TabsList>
        <TabsPanel value="details" className="min-h-0 overflow-y-auto">
          {model.catalogMetadata ? (
            <ModelDetails
              model={model}
              showHeader={false}
              className="border-b border-primary-200 p-5"
            />
          ) : null}
          <ModelDetailsForm model={model} onDeleted={onClose} />
        </TabsPanel>
        <TabsPanel value="chat" className="min-h-0 overflow-y-auto">
          <ModelChatSettings model={model} models={models} />
        </TabsPanel>
      </Tabs>
    </>
  )
}

function ModelDetailsForm({
  model,
  onDeleted,
}: {
  model: ProviderModel
  onDeleted: () => void
}) {
  const queryClient = useQueryClient()
  const [name, setName] = useState(model.name ?? '')
  const [description, setDescription] = useState(model.description ?? '')
  const [contextWindow, setContextWindow] = useState(
    model.contextWindow ? String(model.contextWindow) : '',
  )
  const [saved, setSaved] = useState(false)
  async function refresh() {
    await queryClient.invalidateQueries({ queryKey: appQueryKeys.models })
  }
  const saveMutation = useMutation({
    mutationFn: updateModelMetadata,
    onSuccess: async function handleSaved() {
      setSaved(true)
      await refresh()
    },
  })
  const deleteMutation = useMutation({
    mutationFn: () => deleteCustomModel(model.providerRef ?? '', model.id),
    onSuccess: async function handleDeleted() {
      onDeleted()
      await refresh()
    },
  })
  const error = saveMutation.error ?? deleteMutation.error
  const contextNumber = Number.parseInt(contextWindow, 10)

  return (
    <form
      className="flex flex-col gap-4 p-5"
      onSubmit={(event) => {
        event.preventDefault()
        setSaved(false)
        saveMutation.mutate({
          modelId: model.id,
          name: name.trim(),
          description: description.trim(),
          contextWindow:
            Number.isFinite(contextNumber) && contextNumber > 0
              ? contextNumber
              : 0,
        })
      }}
    >
      <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_10rem]">
        <SettingsField label="Display name" htmlFor="model-name">
          <Input
            id="model-name"
            nativeInput
            value={name}
            placeholder={model.id}
            onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
              setSaved(false)
              setName(event.target.value)
            }}
          />
        </SettingsField>
        <SettingsField
          label="Context window"
          htmlFor="model-context-window"
          hint={
            Number.isFinite(contextNumber) && contextNumber > 0
              ? `${formatContextWindow(contextNumber)} tokens`
              : undefined
          }
        >
          <Input
            id="model-context-window"
            nativeInput
            type="number"
            min={0}
            step={1}
            inputMode="numeric"
            className="tabular-nums"
            value={contextWindow}
            placeholder="128000"
            onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
              setSaved(false)
              setContextWindow(event.target.value)
            }}
          />
        </SettingsField>
      </div>
      <SettingsField label="Description" htmlFor="model-description">
        <textarea
          id="model-description"
          rows={3}
          value={description}
          placeholder="What this model is good at"
          className={TEXTAREA_CLASS}
          onChange={(event) => {
            setSaved(false)
            setDescription(event.target.value)
          }}
        />
      </SettingsField>
      {error ? (
        <SettingsNotice tone="error">
          {mutationErrorMessage(error, 'Failed to save the model.')}
        </SettingsNotice>
      ) : saved ? (
        <SettingsNotice tone="success">Saved.</SettingsNotice>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          {model.isCustom ? (
            <ConfirmButton
              label="Remove model"
              confirmLabel="Remove"
              pending={deleteMutation.isPending}
              onConfirm={() => deleteMutation.mutate()}
            />
          ) : (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={saveMutation.isPending}
              onClick={() => {
                setName('')
                setDescription('')
                setContextWindow('')
                saveMutation.mutate({
                  modelId: model.id,
                  name: '',
                  description: '',
                  contextWindow: 0,
                })
              }}
            >
              Restore provider values
            </Button>
          )}
        </div>
        <Button type="submit" size="sm" disabled={saveMutation.isPending}>
          {saveMutation.isPending ? 'Saving…' : 'Save'}
        </Button>
      </div>
    </form>
  )
}

function ModelChatSettings({
  model,
  models,
}: {
  model: ProviderModel
  models: Array<ProviderModel>
}) {
  const queryClient = useQueryClient()
  const chatSettingsQuery = useChatSettingsPreferencesQuery()
  const mutation = useMutation({
    mutationFn: updateChatSettingsPreferences,
    onSuccess: (settings) =>
      queryClient.setQueryData(appQueryKeys.chatSettings, settings),
  })
  const modelId = providerModelKey(model)
  const defaults = chatSettingsQuery.data?.defaultSettings
  const override = chatSettingsQuery.data?.modelOverrides[modelId]

  if (!defaults) {
    return (
      <p className="p-5 text-sm text-primary-500">
        {chatSettingsQuery.isLoading
          ? 'Loading chat settings…'
          : 'Chat settings could not be loaded.'}
      </p>
    )
  }

  function save(updates: Partial<ConversationSettings>) {
    const base = override ?? defaults!
    mutation.mutate({
      modelId,
      modelSettings: {
        ...base,
        ...updates,
        advanced: { ...base.advanced, ...updates.advanced },
      },
    })
  }

  return (
    <div className="pb-2">
      <SettingsRow
        label="Use custom chat settings"
        description={
          override
            ? 'New chats with this model start from the settings below.'
            : 'New chats with this model use your chat defaults.'
        }
      >
        <Switch
          aria-label="Use custom chat settings"
          checked={Boolean(override)}
          disabled={mutation.isPending}
          onCheckedChange={(enabled) =>
            mutation.mutate(
              enabled
                ? { modelId, modelSettings: defaults }
                : { modelId, clearModelOverride: true },
            )
          }
        />
      </SettingsRow>
      {mutation.error ? (
        <div className="px-4">
          <SettingsNotice tone="error">
            {mutationErrorMessage(mutation.error, 'Failed to save.')}
          </SettingsNotice>
        </div>
      ) : null}
      {override ? (
        <div className="border-t border-primary-200">
          <ModelSettingsPanel
            models={models}
            selectedModelId={modelId}
            showModelInfo={false}
            value={override}
            onChange={save}
          />
        </div>
      ) : null}
    </div>
  )
}
