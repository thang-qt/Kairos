import { HugeiconsIcon } from '@hugeicons/react'
import {
  Add01Icon,
  Cancel01Icon,
  Delete02Icon,
  Loading03Icon,
  PencilEdit02Icon,
  Tick02Icon,
} from '@hugeicons/core-free-icons'
import { useCapabilitiesQuery, useProvidersQuery } from '@/lib/app-api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { useProviderEditor } from '@/hooks/use-provider-editor'
import { cn } from '@/lib/utils'

export function ProviderSettingsPanel() {
  const capabilitiesQuery = useCapabilitiesQuery()
  const providersQuery = useProvidersQuery()
  const providers = providersQuery.data?.providers ?? []
  const preferences = providersQuery.data?.preferences
  const capabilities = capabilitiesQuery.data?.providers
  const {
    createProviderMutation,
    deleteProviderMutation,
    draft,
    editorState,
    errorMessage,
    handleCreateProvider,
    handleSaveProvider,
    handleTestConnection,
    openAddEditor,
    openEditEditor,
    resetEditorState,
    saveProviderMutation,
    testResult,
    testingConnection,
    toggleProviderMutation,
    updateDraft,
    updatePreferencesMutation,
  } = useProviderEditor({ canSyncModels: capabilities?.canSyncModels ?? true })

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-sm text-primary-800">Provider access</div>
          <div className="text-xs text-primary-500">
            Models are loaded from enabled providers. Server providers stay
            read-only.
          </div>
        </div>
        <span className="text-xs text-primary-500">
          {providersQuery.isLoading
            ? 'Loading...'
            : `${providers.length} total`}
        </span>
      </div>

      {capabilities?.systemProvidersEnabled ? (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-primary-200 px-3 py-2">
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm text-primary-900">
              Use server provider
            </div>
            <div className="text-xs text-primary-500">
              Turn it off only if you want Kairos to use your BYOK providers
              exclusively.
            </div>
          </div>
          <Switch
            checked={preferences?.useSystemProviders ?? true}
            disabled={
              !capabilities.canDisableSystemProvider ||
              updatePreferencesMutation.isPending
            }
            onCheckedChange={function handleCheckedChange(checked) {
              updatePreferencesMutation.mutate({
                useSystemProviders: checked,
              })
            }}
          />
        </div>
      ) : null}

      <div className="space-y-2">
        {providers.map(function renderProvider(provider) {
          const isEditingProvider =
            editorState?.mode === 'edit' &&
            editorState.providerId === provider.id

          return (
            <div key={provider.ref} className="space-y-2">
              <div className="flex items-center gap-3 rounded-lg border border-primary-200 px-3 py-2">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm text-primary-900">
                    {provider.label}
                  </div>
                  <div className="truncate text-xs text-primary-500">
                    {provider.systemManaged ? 'System' : 'User'} ·{' '}
                    {provider.kind}
                    {provider.baseUrl ? ` · ${provider.baseUrl}` : ''}
                  </div>
                </div>
                {!provider.systemManaged ? (
                  <Switch
                    checked={provider.enabled}
                    disabled={toggleProviderMutation.isPending}
                    onCheckedChange={function handleCheckedChange(checked) {
                      toggleProviderMutation.mutate({
                        providerId: provider.id,
                        enabled: checked,
                      })
                    }}
                  />
                ) : (
                  <span className="text-xs text-primary-500">
                    {provider.enabled ? 'enabled' : 'disabled'}
                  </span>
                )}
                {!provider.systemManaged ? (
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    onClick={function handleEdit() {
                      openEditEditor(provider)
                    }}
                    aria-label={`Edit ${provider.label}`}
                    className="text-primary-500 hover:bg-primary-100"
                  >
                    <HugeiconsIcon
                      icon={PencilEdit02Icon}
                      size={20}
                      strokeWidth={1.5}
                    />
                  </Button>
                ) : null}
                {!provider.systemManaged ? (
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    onClick={function handleDelete() {
                      deleteProviderMutation.mutate(provider.id)
                    }}
                    aria-label={`Delete ${provider.label}`}
                    className="text-primary-500 hover:bg-primary-100"
                  >
                    <HugeiconsIcon
                      icon={Delete02Icon}
                      size={20}
                      strokeWidth={1.5}
                    />
                  </Button>
                ) : null}
              </div>
              {isEditingProvider ? (
                <div className="space-y-2 rounded-lg border border-primary-200 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0 flex-1 text-sm text-primary-900">
                      Edit provider
                    </div>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      onClick={resetEditorState}
                      aria-label="Cancel editing provider"
                      className="text-primary-500 hover:bg-primary-100"
                    >
                      <HugeiconsIcon
                        icon={Cancel01Icon}
                        size={20}
                        strokeWidth={1.5}
                      />
                    </Button>
                  </div>
                  <Input
                    placeholder="Label"
                    value={draft.label}
                    onChange={function handleChange(event) {
                      updateDraft('label', event.target.value)
                    }}
                  />
                  <Input
                    placeholder="Base URL"
                    value={draft.baseURL}
                    disabled={!capabilities?.canAddCustomBaseUrl}
                    onChange={function handleChange(event) {
                      updateDraft('baseURL', event.target.value)
                    }}
                  />
                  <Input
                    placeholder="New API key"
                    type="password"
                    value={draft.apiKey}
                    onChange={function handleChange(event) {
                      updateDraft('apiKey', event.target.value)
                    }}
                  />
                  <div className="text-xs text-primary-500">
                    Leave the API key empty to keep the current secret.
                  </div>
                  {testResult ? (
                    <div
                      className={cn(
                        'flex items-center gap-2 text-xs',
                        testResult.success ? 'text-green-600' : 'text-red-600',
                      )}
                    >
                      <HugeiconsIcon
                        icon={testResult.success ? Tick02Icon : Cancel01Icon}
                        size={16}
                        strokeWidth={1.5}
                      />
                      <span>{testResult.message}</span>
                    </div>
                  ) : null}
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-xs text-primary-500">
                      Test uses the values in this form before saving them.
                    </div>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={handleTestConnection}
                        disabled={testingConnection}
                      >
                        {testingConnection ? (
                          <HugeiconsIcon
                            icon={Loading03Icon}
                            size={20}
                            strokeWidth={1.5}
                            className="animate-spin"
                          />
                        ) : null}
                        <span>Test</span>
                      </Button>
                      <Button
                        size="sm"
                        onClick={handleSaveProvider}
                        disabled={saveProviderMutation.isPending}
                      >
                        <HugeiconsIcon
                          icon={Tick02Icon}
                          size={20}
                          strokeWidth={1.5}
                        />
                        <span>Save</span>
                      </Button>
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          )
        })}
      </div>

      {capabilities?.userProvidersEnabled ? (
        <div className="space-y-2">
          {editorState?.mode !== 'add' ? (
            <Button
              size="sm"
              variant="outline"
              onClick={openAddEditor}
              className="w-full"
            >
              <HugeiconsIcon icon={Add01Icon} size={20} strokeWidth={1.5} />
              <span>Add provider</span>
            </Button>
          ) : (
            <div className="space-y-2 rounded-lg border border-primary-200 p-3">
              <div className="flex items-center justify-between">
                <div className="text-sm font-medium text-primary-900">
                  Add provider
                </div>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  onClick={resetEditorState}
                  aria-label="Cancel"
                  className="text-primary-500 hover:bg-primary-100"
                >
                  <HugeiconsIcon
                    icon={Cancel01Icon}
                    size={20}
                    strokeWidth={1.5}
                  />
                </Button>
              </div>
              <Input
                placeholder="Label"
                value={draft.label}
                onChange={function handleChange(event) {
                  updateDraft('label', event.target.value)
                }}
              />
              <Input
                placeholder="Base URL"
                value={draft.baseURL}
                disabled={!capabilities.canAddCustomBaseUrl}
                onChange={function handleChange(event) {
                  updateDraft('baseURL', event.target.value)
                }}
              />
              <Input
                placeholder="API key"
                type="password"
                value={draft.apiKey}
                onChange={function handleChange(event) {
                  updateDraft('apiKey', event.target.value)
                }}
              />
              {testResult ? (
                <div
                  className={cn(
                    'flex items-center gap-2 text-xs',
                    testResult.success ? 'text-green-600' : 'text-red-600',
                  )}
                >
                  <HugeiconsIcon
                    icon={testResult.success ? Tick02Icon : Cancel01Icon}
                    size={16}
                    strokeWidth={1.5}
                  />
                  <span>{testResult.message}</span>
                </div>
              ) : null}
              <div className="flex items-center justify-between gap-3">
                <div className="text-xs text-primary-500">
                  OpenAI-compatible providers only in v1.
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleTestConnection}
                    disabled={testingConnection}
                  >
                    {testingConnection ? (
                      <HugeiconsIcon
                        icon={Loading03Icon}
                        size={20}
                        strokeWidth={1.5}
                        className="animate-spin"
                      />
                    ) : null}
                    <span>Test</span>
                  </Button>
                  <Button
                    size="sm"
                    onClick={handleCreateProvider}
                    disabled={createProviderMutation.isPending}
                  >
                    <HugeiconsIcon
                      icon={Add01Icon}
                      size={20}
                      strokeWidth={1.5}
                    />
                    <span>Add</span>
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>
      ) : null}

      {errorMessage ? (
        <div className="text-xs text-red-600">{errorMessage}</div>
      ) : null}
    </div>
  )
}
