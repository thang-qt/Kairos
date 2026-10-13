import { HugeiconsIcon } from '@hugeicons/react'
import {
  Add01Icon,
  Loading03Icon,
  RefreshIcon,
} from '@hugeicons/core-free-icons'
import { useMutation } from '@tanstack/react-query'
import {
  syncModels,
  useCapabilitiesQuery,
  useModelsQuery,
  useProvidersQuery,
} from '@/lib/app-api'
import type { ProviderModel, ProviderRecord } from '@/lib/app-api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { mutationErrorMessage } from '@/lib/error-utils'
import { cn } from '@/lib/utils'
import { useProviderEditor } from '../providers/use-provider-editor'
import type { ProviderDraftState } from '../providers/use-provider-editor'
import {
  ConfirmButton,
  SegmentedControl,
  SettingsBadge,
  SettingsEmpty,
  SettingsField,
  SettingsNotice,
  SettingsPage,
  SettingsRow,
  SettingsSection,
  StatusDot,
} from './settings-layout'

const API_FORMATS = [
  { value: 'chat', label: 'Chat Completions' },
  { value: 'responses', label: 'Responses' },
] as const

export function ProvidersSettingsPanel({
  onOpenModels,
}: {
  onOpenModels: () => void
}) {
  const capabilitiesQuery = useCapabilitiesQuery()
  const providersQuery = useProvidersQuery()
  const modelsQuery = useModelsQuery()
  const capabilities = capabilitiesQuery.data?.providers
  const providers = providersQuery.data?.providers ?? []
  const preferences = providersQuery.data?.preferences
  const models = modelsQuery.data?.models ?? []
  const editor = useProviderEditor({
    canSyncModels: capabilities?.canSyncModels ?? true,
  })
  const syncMutation = useMutation({
    mutationFn: syncModels,
    onSuccess: editor.refreshProviderQueries,
  })
  const editingId =
    editor.editorState?.mode === 'edit' ? editor.editorState.providerId : null
  const adding = editor.editorState?.mode === 'add'
  const canAdd = capabilities?.userProvidersEnabled ?? false
  const noActiveConnection =
    !preferences?.useSystemProviders &&
    !providers.some((provider) => provider.enabled)

  return (
    <SettingsPage
      title="Providers"
      description="Connections to OpenAI-compatible APIs. Kairos lists the models each enabled connection offers."
      actions={
        canAdd && !adding ? (
          <Button size="sm" onClick={editor.openAddEditor}>
            <HugeiconsIcon icon={Add01Icon} size={16} strokeWidth={1.5} />
            Add provider
          </Button>
        ) : null
      }
    >
      {editor.errorMessage ? (
        <SettingsNotice
          tone="error"
          onDismiss={() => editor.setErrorMessage('')}
        >
          {editor.errorMessage}
        </SettingsNotice>
      ) : null}
      {noActiveConnection && !providersQuery.isLoading ? (
        <SettingsNotice>
          No connection is active, so no models are available. Add a provider or
          turn one on.
        </SettingsNotice>
      ) : null}

      {adding ? (
        <SettingsSection title="New provider">
          <ProviderForm
            mode="add"
            draft={editor.draft}
            canEditBaseUrl={capabilities?.canAddCustomBaseUrl ?? true}
            pending={editor.createProviderMutation.isPending}
            onChange={editor.updateDraft}
            onCancel={editor.resetEditorState}
            onSubmit={editor.handleCreateProvider}
          />
        </SettingsSection>
      ) : null}

      {capabilities?.systemProvidersEnabled ? (
        <SettingsSection title="Kairos">
          <SettingsRow
            label="Use Kairos models"
            description="Models hosted by this Kairos server."
          >
            <Switch
              aria-label="Use Kairos models"
              checked={preferences?.useSystemProviders ?? true}
              disabled={
                !capabilities.canDisableSystemProvider ||
                editor.updatePreferencesMutation.isPending
              }
              onCheckedChange={(checked) =>
                editor.updatePreferencesMutation.mutate({
                  useSystemProviders: checked,
                })
              }
            />
          </SettingsRow>
        </SettingsSection>
      ) : null}

      <SettingsSection title="Connections">
        {providersQuery.isLoading ? (
          <SettingsEmpty>Loading providers…</SettingsEmpty>
        ) : providers.length === 0 ? (
          <SettingsEmpty>
            {canAdd
              ? 'No providers yet. Add one with an API key to get started.'
              : 'No providers are configured.'}
          </SettingsEmpty>
        ) : (
          providers.map((provider) =>
            provider.id === editingId ? (
              <div key={provider.ref}>
                <ProviderSummary provider={provider} models={models} />
                <ProviderForm
                  mode="edit"
                  draft={editor.draft}
                  canEditBaseUrl={capabilities?.canAddCustomBaseUrl ?? true}
                  pending={editor.saveProviderMutation.isPending}
                  onChange={editor.updateDraft}
                  onCancel={editor.resetEditorState}
                  onSubmit={editor.handleSaveProvider}
                  onDelete={() =>
                    editor.deleteProviderMutation.mutate(provider.id, {
                      onSuccess: editor.resetEditorState,
                    })
                  }
                  deletePending={editor.deleteProviderMutation.isPending}
                />
              </div>
            ) : (
              <ProviderSummary
                key={provider.ref}
                provider={provider}
                models={models}
              >
                {provider.systemManaged ? (
                  <span className="text-xs text-primary-500">
                    {provider.enabled ? 'Managed' : 'Off'}
                  </span>
                ) : (
                  <>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => editor.openEditEditor(provider)}
                    >
                      Edit
                    </Button>
                    <Switch
                      aria-label={`Enable ${provider.label}`}
                      checked={provider.enabled}
                      disabled={editor.toggleProviderMutation.isPending}
                      onCheckedChange={(enabled) =>
                        editor.toggleProviderMutation.mutate({
                          providerId: provider.id,
                          enabled,
                        })
                      }
                    />
                  </>
                )}
              </ProviderSummary>
            ),
          )
        )}
      </SettingsSection>

      <SettingsSection title="Model list">
        {capabilities?.canSyncModels !== false ? (
          <SettingsRow
            label="Refresh models"
            description={
              syncMutation.error
                ? mutationErrorMessage(
                    syncMutation.error,
                    'Failed to refresh models.',
                  )
                : 'Fetch the latest models from every enabled provider.'
            }
          >
            <Button
              size="sm"
              variant="outline"
              disabled={syncMutation.isPending}
              onClick={() => syncMutation.mutate()}
            >
              <HugeiconsIcon
                icon={syncMutation.isPending ? Loading03Icon : RefreshIcon}
                size={16}
                strokeWidth={1.5}
                className={cn(syncMutation.isPending && 'animate-spin')}
              />
              {syncMutation.isPending ? 'Refreshing…' : 'Refresh'}
            </Button>
          </SettingsRow>
        ) : null}
        <SettingsRow
          label="Models"
          description={`${models.length} available. Rename them, add your own, or set per-model chat settings.`}
        >
          <Button size="sm" variant="outline" onClick={onOpenModels}>
            Manage models
          </Button>
        </SettingsRow>
      </SettingsSection>
    </SettingsPage>
  )
}

function ProviderSummary({
  provider,
  models,
  children,
}: {
  provider: ProviderRecord
  models: Array<ProviderModel>
  children?: React.ReactNode
}) {
  const count = models.filter(
    (model) =>
      model.providerRef === provider.ref ||
      (!model.providerRef && model.providerLabel === provider.label),
  ).length
  return (
    <SettingsRow
      label={
        <span className="flex min-w-0 items-center gap-2">
          <StatusDot active={provider.enabled} />
          <span className="truncate">{provider.label}</span>
          {provider.systemManaged ? (
            <SettingsBadge>System</SettingsBadge>
          ) : null}
        </span>
      }
      description={
        <span className="flex min-w-0 flex-wrap items-center gap-x-2 pl-3.5">
          <span className="truncate font-mono">
            {provider.baseUrl || 'Built in'}
          </span>
          <span className="tabular-nums">
            {count} {count === 1 ? 'model' : 'models'}
          </span>
        </span>
      }
    >
      {children}
    </SettingsRow>
  )
}

function ProviderForm({
  mode,
  draft,
  canEditBaseUrl,
  pending,
  onChange,
  onCancel,
  onSubmit,
  onDelete,
  deletePending = false,
}: {
  mode: 'add' | 'edit'
  draft: ProviderDraftState
  canEditBaseUrl: boolean
  pending: boolean
  onChange: <TKey extends keyof ProviderDraftState>(
    key: TKey,
    value: ProviderDraftState[TKey],
  ) => void
  onCancel: () => void
  onSubmit: () => void
  onDelete?: () => void
  deletePending?: boolean
}) {
  const isEdit = mode === 'edit'
  return (
    <form
      className="flex flex-col gap-4 bg-primary-50/60 p-4"
      onSubmit={(event) => {
        event.preventDefault()
        onSubmit()
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <SettingsField label="Name" htmlFor={`provider-${mode}-label`}>
          <Input
            id={`provider-${mode}-label`}
            nativeInput
            value={draft.label}
            placeholder="OpenAI"
            onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
              onChange('label', event.target.value)
            }
          />
        </SettingsField>
        <SettingsField label="Base URL" htmlFor={`provider-${mode}-url`}>
          <Input
            id={`provider-${mode}-url`}
            nativeInput
            value={draft.baseURL}
            disabled={!canEditBaseUrl}
            placeholder="https://api.openai.com/v1"
            onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
              onChange('baseURL', event.target.value)
            }
          />
        </SettingsField>
      </div>
      <SettingsField
        label="API key"
        htmlFor={`provider-${mode}-key`}
        hint={isEdit ? 'Leave blank to keep the saved key.' : undefined}
      >
        <Input
          id={`provider-${mode}-key`}
          nativeInput
          type="password"
          autoComplete="off"
          value={draft.apiKey}
          placeholder={isEdit ? '••••••••' : 'sk-…'}
          onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
            onChange('apiKey', event.target.value)
          }
        />
      </SettingsField>
      <SettingsField
        label="API format"
        hint="Most providers use Chat Completions. Choose Responses only if the provider supports it."
      >
        <div>
          <SegmentedControl
            label="API format"
            value={draft.useResponsesApi ? 'responses' : 'chat'}
            options={API_FORMATS}
            onChange={(value) =>
              onChange('useResponsesApi', value === 'responses')
            }
          />
        </div>
      </SettingsField>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          {onDelete ? (
            <ConfirmButton
              label="Delete provider"
              confirmLabel="Delete"
              pending={deletePending}
              onConfirm={onDelete}
            />
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" size="sm" disabled={pending}>
            {pending ? 'Saving…' : isEdit ? 'Save' : 'Add provider'}
          </Button>
        </div>
      </div>
    </form>
  )
}
