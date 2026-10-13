import { useMemo, useState } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  Add01Icon,
  ArrowRight01Icon,
  Search01Icon,
} from '@hugeicons/core-free-icons'
import {
  useCapabilitiesQuery,
  useChatSettingsPreferencesQuery,
  useModelsQuery,
  useProvidersQuery,
} from '@/lib/app-api'
import type { ProviderModel } from '@/lib/app-api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { formatContextWindow, providerModelKey } from '@/lib/model-utils'
import { AddModelDialog } from './add-model-dialog'
import { ModelDialog } from './model-dialog'
import {
  SettingsBadge,
  SettingsEmpty,
  SettingsPage,
  SettingsSection,
} from './settings-layout'

type ModelGroup = { key: string; label: string; models: Array<ProviderModel> }

export function ModelsSettingsPanel({
  onOpenProviders,
}: {
  onOpenProviders: () => void
}) {
  const modelsQuery = useModelsQuery()
  const providersQuery = useProvidersQuery()
  const capabilitiesQuery = useCapabilitiesQuery()
  const chatSettingsQuery = useChatSettingsPreferencesQuery()
  const models = modelsQuery.data?.models ?? []
  const providers = providersQuery.data?.providers ?? []
  const defaultModelId = modelsQuery.data?.preferences.defaultModelId
  const overrides = chatSettingsQuery.data?.modelOverrides ?? {}
  const canAddModels =
    capabilitiesQuery.data?.providers.userProvidersEnabled ?? false
  const [query, setQuery] = useState('')
  const [providerFilter, setProviderFilter] = useState('all')
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)

  const groups = useMemo(
    () => groupModels(models, query, providerFilter),
    [models, query, providerFilter],
  )
  const providerOptions = useMemo(
    () => groupModels(models, '', 'all'),
    [models],
  )
  const selectedModel =
    models.find((model) => providerModelKey(model) === selectedKey) ?? null
  const matchCount = groups.reduce(
    (total, group) => total + group.models.length,
    0,
  )

  return (
    <SettingsPage
      title="Models"
      description="Every model your providers offer. Open one to rename it, correct its context window, or give it its own chat settings."
      actions={
        canAddModels ? (
          <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
            <HugeiconsIcon icon={Add01Icon} size={16} strokeWidth={1.5} />
            Add model
          </Button>
        ) : null
      }
    >
      {models.length > 0 ? (
        <div className="flex flex-col gap-2 sm:flex-row">
          <div className="relative flex-1">
            <HugeiconsIcon
              icon={Search01Icon}
              size={16}
              strokeWidth={1.5}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-primary-400"
            />
            <Input
              nativeInput
              aria-label="Search models"
              placeholder={`Search ${models.length} models`}
              className="pl-9"
              value={query}
              onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
                setQuery(event.target.value)
              }
            />
          </div>
          {providerOptions.length > 1 ? (
            <Select
              label="Filter by provider"
              className="sm:w-48"
              value={providerFilter}
              options={[
                { value: 'all', label: 'All providers' },
                ...providerOptions.map((group) => ({
                  value: group.key,
                  label: group.label,
                })),
              ]}
              onValueChange={setProviderFilter}
            />
          ) : null}
        </div>
      ) : null}

      {modelsQuery.isLoading ? (
        <SettingsSection>
          <SettingsEmpty>Loading models…</SettingsEmpty>
        </SettingsSection>
      ) : models.length === 0 ? (
        <SettingsSection>
          <div className="flex flex-col items-center gap-3 px-4 py-10 text-center">
            <p className="text-pretty text-sm text-primary-600">
              No models yet. Connect a provider and its models appear here.
            </p>
            <Button size="sm" onClick={onOpenProviders}>
              Set up a provider
            </Button>
          </div>
        </SettingsSection>
      ) : matchCount === 0 ? (
        <SettingsSection>
          <SettingsEmpty>No models match “{query}”.</SettingsEmpty>
        </SettingsSection>
      ) : (
        groups.map((group) => (
          <SettingsSection
            key={group.key}
            title={group.label}
            description={`${group.models.length} ${group.models.length === 1 ? 'model' : 'models'}`}
          >
            {group.models.map((model) => {
              const modelKey = providerModelKey(model)
              return (
                <ModelRow
                  key={modelKey}
                  model={model}
                  isDefault={modelKey === defaultModelId}
                  hasOverride={Boolean(overrides[modelKey])}
                  onOpen={() => setSelectedKey(modelKey)}
                />
              )
            })}
          </SettingsSection>
        ))
      )}

      <ModelDialog
        model={selectedModel}
        models={models}
        defaultModelId={defaultModelId}
        canSetDefault={!modelsQuery.data?.capabilities.defaultModelLocked}
        onClose={() => setSelectedKey(null)}
      />
      <AddModelDialog
        open={adding}
        providers={providers}
        onOpenChange={setAdding}
      />
    </SettingsPage>
  )
}

function ModelRow({
  model,
  isDefault,
  hasOverride,
  onOpen,
}: {
  model: ProviderModel
  isDefault: boolean
  hasOverride: boolean
  onOpen: () => void
}) {
  const showId = Boolean(model.name && model.name !== model.id)
  return (
    <button
      type="button"
      onClick={onOpen}
      className="group flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-primary-50"
    >
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 flex-wrap items-center gap-1.5">
          <span className="truncate text-sm text-primary-900">
            {model.name || model.id}
          </span>
          {isDefault ? <SettingsBadge>Default</SettingsBadge> : null}
          {model.isCustom ? <SettingsBadge>Added by you</SettingsBadge> : null}
          {hasOverride ? <SettingsBadge>Custom settings</SettingsBadge> : null}
        </span>
        {showId ? (
          <span className="block truncate font-mono text-xs text-primary-500">
            {model.id}
          </span>
        ) : null}
      </span>
      {model.contextWindow ? (
        <span className="shrink-0 text-xs tabular-nums text-primary-500">
          {formatContextWindow(model.contextWindow)}
        </span>
      ) : null}
      <HugeiconsIcon
        icon={ArrowRight01Icon}
        size={16}
        strokeWidth={1.5}
        className="shrink-0 text-primary-400 transition-transform group-hover:translate-x-0.5"
      />
    </button>
  )
}

function groupModels(
  models: Array<ProviderModel>,
  query: string,
  providerFilter: string,
): Array<ModelGroup> {
  const needle = query.trim().toLowerCase()
  const groups = new Map<string, ModelGroup>()
  for (const model of models) {
    const label = model.providerLabel || model.owned_by || 'Other'
    const key = model.providerRef || label
    if (providerFilter !== 'all' && providerFilter !== key) continue
    if (
      needle &&
      ![model.id, model.name, model.description, label]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(needle)
    ) {
      continue
    }
    const group = groups.get(key) ?? { key, label, models: [] }
    group.models.push(model)
    groups.set(key, group)
  }
  return [...groups.values()]
}
