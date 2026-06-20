import type { ProviderModel } from '@/lib/app-api'
import { Switch } from '@/components/ui/switch'
import {
  formatContextWindow,
  providerModelDisplayName,
  providerModelKey,
} from '@/lib/model-utils'
import { cn } from '@/lib/utils'

type ModelSettingsValue = {
  model: string
  systemPrompt: string
  webSearch: boolean
}

type ModelSettingsPanelProps = {
  models: Array<ProviderModel>
  selectedModelId: string
  defaultModelId?: string
  loading?: boolean
  canSelectModel?: boolean
  defaultModelLocked?: boolean
  value: ModelSettingsValue
  onChange: (updates: Partial<ModelSettingsValue>) => void
}

function PanelSection({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <section className="border-b border-primary-200 px-4 py-4 last:border-b-0">
      <h3 className="mb-3 text-xs text-primary-500">{title}</h3>
      <div className="space-y-3">{children}</div>
    </section>
  )
}

function FieldBlock({
  label,
  description,
  children,
}: {
  label: string
  description?: string
  children: React.ReactNode
}) {
  return (
    <div className="space-y-2">
      <div className="space-y-1">
        <div className="text-sm text-primary-800">{label}</div>
        {description ? (
          <div className="text-pretty text-xs text-primary-500">
            {description}
          </div>
        ) : null}
      </div>
      {children}
    </div>
  )
}

function ModelInfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-3 text-xs">
      <div className="text-primary-500">{label}</div>
      <div className="min-w-0 break-words text-primary-800">{value}</div>
    </div>
  )
}

function findSelectedModel(
  models: Array<ProviderModel>,
  selectedModelId: string,
): ProviderModel | null {
  return (
    models.find(function matchModel(model) {
      return (
        providerModelKey(model) === selectedModelId ||
        model.id === selectedModelId
      )
    }) ?? null
  )
}

export function ModelSettingsPanel({
  models,
  selectedModelId,
  loading = false,
  value,
  onChange,
}: ModelSettingsPanelProps) {
  const selectedModel = findSelectedModel(models, selectedModelId)
  const modelName = loading
    ? 'Loading model…'
    : providerModelDisplayName(
        selectedModel,
        selectedModelId || 'No model selected',
      )
  const modelDescription = selectedModel?.description?.trim()

  return (
    <div className="pb-4">
      <PanelSection title="Model">
        <FieldBlock label="Current model">
          <div className="rounded-xl border border-primary-200 bg-primary-50/60 p-3">
            <div className="text-pretty text-sm font-medium text-primary-950">
              {modelName}
            </div>

            {modelDescription ? (
              <details className="group mt-3">
                <summary className="cursor-pointer list-none text-sm leading-relaxed text-primary-700 outline-none">
                  <span className="line-clamp-3 group-open:line-clamp-none">
                    {modelDescription}
                  </span>
                  <span className="mt-1 inline-block text-xs font-medium text-primary-500 group-open:hidden">
                    Read full description
                  </span>
                  <span className="mt-1 hidden text-xs font-medium text-primary-500 group-open:inline-block">
                    Show less
                  </span>
                </summary>
              </details>
            ) : null}

            <div className="mt-4 space-y-2 rounded-lg border border-primary-200 bg-surface/70 p-3">
              <ModelInfoRow
                label="Context"
                value={formatContextWindow(selectedModel?.contextWindow)}
              />
              {selectedModel?.created ? (
                <ModelInfoRow
                  label="Created"
                  value={new Date(
                    selectedModel.created * 1000,
                  ).toLocaleDateString()}
                />
              ) : null}
            </div>
          </div>
        </FieldBlock>
      </PanelSection>

      <PanelSection title="Prompting">
        <FieldBlock
          label="System prompt"
          description="Prepended as a system message before the conversation history."
        >
          <textarea
            value={value.systemPrompt}
            onChange={function handleChange(
              event: React.ChangeEvent<HTMLTextAreaElement>,
            ) {
              onChange({ systemPrompt: event.target.value })
            }}
            placeholder="You are a concise assistant..."
            className={cn(
              'min-h-28 w-full resize-y rounded-lg border border-primary-200 bg-surface px-3 py-2 text-sm text-primary-900 outline-none transition-colors placeholder:text-primary-600/70 focus:border-primary-500',
              'text-pretty',
            )}
          />
        </FieldBlock>
      </PanelSection>

      <PanelSection title="Web tools">
        <FieldBlock
          label="Search and fetch"
          description="Allows OpenRouter to search the web and fetch URLs for the next turn."
        >
          <div className="flex items-center justify-between gap-3 rounded-lg border border-primary-200 px-3 py-2">
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm text-primary-800">
                Use web tools
              </div>
              <div className="text-pretty text-xs text-primary-500">
                Adds OpenRouter web search and web fetch server tools.
              </div>
            </div>
            <Switch
              checked={value.webSearch}
              onCheckedChange={function handleCheckedChange(checked) {
                onChange({ webSearch: checked })
              }}
            />
          </div>
        </FieldBlock>
      </PanelSection>
    </div>
  )
}
