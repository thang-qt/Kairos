import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  appQueryKeys,
  updateWebToolSettings,
  useWebToolSettingsQuery,
} from '@/lib/app-api'
import type {
  UpdateWebToolSettingsPayload,
  WebToolProvider,
  WebToolProviderSettings,
} from '@/lib/app-api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { mutationErrorMessage } from '@/lib/error-utils'
import {
  ConfirmButton,
  SettingsEmpty,
  SettingsNotice,
  SettingsPage,
  SettingsRow,
  SettingsSection,
  StatusDot,
} from './settings-layout'

const PROVIDERS: Array<{
  id: WebToolProvider
  label: string
  description: string
}> = [
  { id: 'exa', label: 'Exa', description: 'Search and page contents.' },
  {
    id: 'tinyfish',
    label: 'TinyFish',
    description: 'Search and page fetching.',
  },
]

const LIMITS = [
  {
    key: 'searchMaxResults',
    label: 'Results per search',
    description: 'How many results each search returns (1–10).',
    min: 1,
    max: 10,
    step: 1,
  },
  {
    key: 'fetchMaxCharacters',
    label: 'Characters per page',
    description: 'How much of a fetched page the model reads (1,000–50,000).',
    min: 1000,
    max: 50000,
    step: 1000,
  },
  {
    key: 'toolCallLimit',
    label: 'Tool calls per response',
    description: 'Stops runaway tool use within one reply (1–100).',
    min: 1,
    max: 100,
    step: 1,
  },
] as const

// Every control saves as soon as it changes; only API keys need a button.
export function WebToolsSettingsPanel() {
  const queryClient = useQueryClient()
  const settingsQuery = useWebToolSettingsQuery()
  const settings = settingsQuery.data
  const mutation = useMutation({
    mutationFn: updateWebToolSettings,
    onSuccess: (next) => queryClient.setQueryData(appQueryKeys.webTools, next),
  })
  function save(payload: UpdateWebToolSettingsPayload) {
    mutation.mutate(payload)
  }
  const usable = PROVIDERS.filter((provider) => {
    const state = settings?.providers.find(
      (item) => item.provider === provider.id,
    )
    return state?.enabled && state.apiKeyConfigured
  })

  return (
    <SettingsPage
      title="Web search"
      description="Lets the assistant search the web and read pages. Turn it on per chat from the chat’s right sidebar."
    >
      {mutation.error ? (
        <SettingsNotice tone="error" onDismiss={() => mutation.reset()}>
          {mutationErrorMessage(mutation.error, 'Failed to save web search.')}
        </SettingsNotice>
      ) : null}

      <SettingsSection
        title="Providers"
        description="Each provider needs its own API key."
      >
        {settings ? (
          PROVIDERS.map((provider) => (
            <ProviderRow
              key={provider.id}
              label={provider.label}
              description={provider.description}
              state={settings.providers.find(
                (item) => item.provider === provider.id,
              )}
              pending={mutation.isPending}
              onSave={(update) =>
                save({ providers: [{ provider: provider.id, ...update }] })
              }
            />
          ))
        ) : (
          <SettingsEmpty>
            {settingsQuery.isLoading
              ? 'Loading web search…'
              : 'Web search settings could not be loaded.'}
          </SettingsEmpty>
        )}
      </SettingsSection>

      {settings ? (
        <>
          <SettingsSection title="Behavior">
            <SettingsRow
              label="Search with"
              htmlFor="web-default-provider"
              description={
                usable.length > 1
                  ? 'Used unless the assistant picks another enabled provider.'
                  : 'Turn on another provider with a key to choose between them.'
              }
            >
              <Select<WebToolProvider>
                id="web-default-provider"
                className="w-40"
                value={settings.provider}
                disabled={mutation.isPending}
                options={PROVIDERS.map((provider) => ({
                  value: provider.id,
                  label: provider.label,
                  disabled:
                    !usable.some((item) => item.id === provider.id) &&
                    provider.id !== settings.provider,
                }))}
                onValueChange={(provider) => save({ provider })}
              />
            </SettingsRow>
            {LIMITS.map((limit) => (
              <SettingsRow
                key={limit.key}
                label={limit.label}
                htmlFor={`web-${limit.key}`}
                description={limit.description}
              >
                <Input
                  // Remount when the saved value changes so the field shows it.
                  key={settings[limit.key]}
                  id={`web-${limit.key}`}
                  nativeInput
                  type="number"
                  min={limit.min}
                  max={limit.max}
                  step={limit.step}
                  defaultValue={settings[limit.key]}
                  className="w-28 tabular-nums"
                  onBlur={(event: React.FocusEvent<HTMLInputElement>) => {
                    const value = Number.parseInt(event.target.value, 10)
                    if (
                      Number.isFinite(value) &&
                      value !== settings[limit.key]
                    ) {
                      save({ [limit.key]: value })
                    }
                  }}
                  onKeyDown={(event: React.KeyboardEvent<HTMLInputElement>) => {
                    if (event.key === 'Enter') event.currentTarget.blur()
                  }}
                />
              </SettingsRow>
            ))}
          </SettingsSection>
        </>
      ) : null}
    </SettingsPage>
  )
}

function ProviderRow({
  label,
  description,
  state,
  pending,
  onSave,
}: {
  label: string
  description: string
  state?: WebToolProviderSettings
  pending: boolean
  onSave: (update: {
    enabled?: boolean
    apiKey?: string
    clearApiKey?: boolean
  }) => void
}) {
  const [editingKey, setEditingKey] = useState(false)
  const [apiKey, setApiKey] = useState('')
  const hasKey = state?.apiKeyConfigured ?? false
  const enabled = state?.enabled ?? false

  return (
    <div>
      <SettingsRow
        label={
          <span className="flex items-center gap-2">
            <StatusDot active={enabled && hasKey} />
            {label}
          </span>
        }
        description={
          <span className="pl-3.5">
            {hasKey ? 'Key saved. ' : 'No API key. '}
            {description}
          </span>
        }
      >
        <Button
          size="sm"
          variant="ghost"
          aria-expanded={editingKey}
          onClick={() => setEditingKey((current) => !current)}
        >
          {hasKey ? 'Change key' : 'Add key'}
        </Button>
        <Switch
          aria-label={`Enable ${label}`}
          checked={enabled}
          disabled={pending}
          onCheckedChange={(checked) => onSave({ enabled: checked })}
        />
      </SettingsRow>
      {editingKey ? (
        <form
          className="flex flex-col gap-2 bg-primary-50/60 px-4 pb-4 pt-1 sm:flex-row sm:items-center"
          onSubmit={(event) => {
            event.preventDefault()
            if (!apiKey.trim()) return
            onSave({ apiKey: apiKey.trim() })
            setApiKey('')
            setEditingKey(false)
          }}
        >
          <Input
            nativeInput
            type="password"
            autoComplete="off"
            aria-label={`${label} API key`}
            placeholder={`${label} API key`}
            value={apiKey}
            onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
              setApiKey(event.target.value)
            }
            className="flex-1"
          />
          <div className="flex items-center gap-1">
            {hasKey ? (
              <ConfirmButton
                label="Remove key"
                confirmLabel="Remove"
                pending={pending}
                onConfirm={() => {
                  onSave({ clearApiKey: true })
                  setEditingKey(false)
                }}
              />
            ) : null}
            <Button
              type="submit"
              size="sm"
              disabled={pending || !apiKey.trim()}
            >
              Save key
            </Button>
          </div>
        </form>
      ) : null}
    </div>
  )
}
