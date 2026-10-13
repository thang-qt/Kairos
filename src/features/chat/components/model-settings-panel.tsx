import type { ProviderModel } from '@/lib/app-api'
import type { ConversationAdvancedSettings } from '../conversation-settings'
import type { ReasoningEffort } from '../types'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { ModelDetails } from '@/components/model-details'
import { providerModelDisplayName, providerModelKey } from '@/lib/model-utils'
import { cn } from '@/lib/utils'
import {
  modelReasoningEfforts,
  resolveReasoningEffort,
} from '../reasoning-options'

type ModelSettingsValue = {
  model: string
  systemPrompt: string
  webSearch: boolean
  mathTools: boolean
  advanced: ConversationAdvancedSettings
}

type ModelSettingsPanelProps = {
  models: Array<ProviderModel>
  selectedModelId: string
  defaultModelId?: string
  loading?: boolean
  canSelectModel?: boolean
  defaultModelLocked?: boolean
  showModelInfo?: boolean
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

function SettingCard({
  label,
  description,
  checked,
  onCheckedChange,
  disabled = false,
  children,
}: {
  label: string
  description?: string
  checked: boolean
  disabled?: boolean
  onCheckedChange: (checked: boolean) => void
  children?: React.ReactNode
}) {
  return (
    <div className="space-y-3 rounded-lg border border-primary-200 px-3 py-2.5">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium text-primary-800">
            {label}
          </div>
          {description ? (
            <div className="text-pretty text-xs text-primary-500">
              {description}
            </div>
          ) : null}
        </div>
        <Switch
          checked={checked}
          disabled={disabled}
          onCheckedChange={onCheckedChange}
        />
      </div>
      {checked && children ? (
        <div className="space-y-3 border-t border-primary-200 pt-3">
          {children}
        </div>
      ) : null}
    </div>
  )
}

function NumberField({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  onChange: (value: number) => void
}) {
  return (
    <label className="grid grid-cols-[minmax(0,1fr)_5.5rem] items-center gap-3 text-sm text-primary-800">
      <span className="truncate">{label}</span>
      <Input
        nativeInput
        type="number"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={function handleChange(event) {
          onChange(Number(event.target.value))
        }}
        className="tabular-nums"
        aria-label={label}
      />
    </label>
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
  showModelInfo = true,
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
  const advanced = value.advanced
  const effortOptions = modelReasoningEfforts(selectedModel)
  const effort = resolveReasoningEffort(advanced.reasoningEffort, selectedModel)

  return (
    <div className="pb-4">
      {showModelInfo ? (
        <PanelSection title="Model">
          {selectedModel ? (
            <ModelDetails model={selectedModel} />
          ) : (
            <div className="text-sm text-primary-500">{modelName}</div>
          )}
        </PanelSection>
      ) : null}

      <PanelSection title="Prompting">
        <FieldBlock
          label="System prompt"
          description="Custom instructions for assistant persona and behavior."
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

      <PanelSection title="Tools">
        <SettingCard
          label="Web search & fetch"
          description="Search the web and read page contents during chat."
          checked={value.webSearch}
          onCheckedChange={function handleCheckedChange(checked) {
            onChange({ webSearch: checked })
          }}
        />

        <SettingCard
          label="Math tools"
          description="Solve equations and unit conversions automatically."
          checked={value.mathTools}
          onCheckedChange={function handleCheckedChange(checked) {
            onChange({ mathTools: checked })
          }}
        />
      </PanelSection>

      <PanelSection title="Advanced">
        <div className="space-y-3">
          <SettingCard
            label="Override reasoning effort"
            disabled={effortOptions.length === 0}
            description={
              effortOptions.length === 0
                ? 'This model does not advertise effort control.'
                : selectedModel?.catalogMetadata
                  ? 'Off uses the provider default. Choose a supported effort to override it.'
                  : 'Off uses the provider default. Supported levels are unknown for this model.'
            }
            checked={advanced.reasoning && effortOptions.length > 0}
            onCheckedChange={function handleReasoningChange(checked) {
              onChange({
                advanced: {
                  ...advanced,
                  reasoning: checked,
                  reasoningEffort: effort ?? advanced.reasoningEffort,
                },
              })
            }}
          >
            <div className="grid grid-cols-[minmax(0,1fr)_10rem] items-center gap-3 text-sm text-primary-800">
              <span className="truncate">Effort</span>
              <Select<ReasoningEffort>
                label="Reasoning effort"
                className="h-8"
                value={effort ?? effortOptions[0]}
                options={effortOptions.map((option) => ({
                  value: option,
                  label:
                    option === 'none'
                      ? 'None (disable thinking)'
                      : option === 'xhigh'
                        ? 'Extra high'
                        : option[0].toUpperCase() + option.slice(1),
                }))}
                onValueChange={(reasoningEffort) =>
                  onChange({ advanced: { ...advanced, reasoningEffort } })
                }
              />
            </div>
          </SettingCard>

          <SettingCard
            label="Sampling"
            description="Adjust response creativity and diversity."
            checked={advanced.sampling}
            onCheckedChange={function handleSamplingChange(checked) {
              onChange({ advanced: { ...advanced, sampling: checked } })
            }}
          >
            <NumberField
              label="Temperature"
              value={advanced.temperature}
              min={0}
              max={2}
              step={0.1}
              onChange={function handleTemperatureChange(nextValue) {
                onChange({
                  advanced: { ...advanced, temperature: nextValue },
                })
              }}
            />
            <NumberField
              label="Top P"
              value={advanced.topP}
              min={0}
              max={1}
              step={0.05}
              onChange={function handleTopPChange(nextValue) {
                onChange({ advanced: { ...advanced, topP: nextValue } })
              }}
            />
            <NumberField
              label="Top K"
              value={advanced.topK}
              min={0}
              max={1000}
              step={1}
              onChange={function handleTopKChange(nextValue) {
                onChange({ advanced: { ...advanced, topK: nextValue } })
              }}
            />
          </SettingCard>

          <SettingCard
            label="Penalties"
            description="Reduce repetitive text generation."
            checked={advanced.penalties}
            onCheckedChange={function handlePenaltiesChange(checked) {
              onChange({ advanced: { ...advanced, penalties: checked } })
            }}
          >
            <NumberField
              label="Frequency"
              value={advanced.frequencyPenalty}
              min={-2}
              max={2}
              step={0.1}
              onChange={function handleFrequencyPenaltyChange(nextValue) {
                onChange({
                  advanced: {
                    ...advanced,
                    frequencyPenalty: nextValue,
                  },
                })
              }}
            />
            <NumberField
              label="Presence"
              value={advanced.presencePenalty}
              min={-2}
              max={2}
              step={0.1}
              onChange={function handlePresencePenaltyChange(nextValue) {
                onChange({
                  advanced: {
                    ...advanced,
                    presencePenalty: nextValue,
                  },
                })
              }}
            />
          </SettingCard>

          <SettingCard
            label="Max output"
            description="Limit response length in tokens."
            checked={advanced.maxTokens}
            onCheckedChange={function handleMaxTokensChange(checked) {
              onChange({ advanced: { ...advanced, maxTokens: checked } })
            }}
          >
            <NumberField
              label="Tokens"
              value={advanced.maxTokensValue}
              min={1}
              max={200000}
              step={1}
              onChange={function handleMaxTokensValueChange(nextValue) {
                onChange({
                  advanced: { ...advanced, maxTokensValue: nextValue },
                })
              }}
            />
          </SettingCard>
        </div>
      </PanelSection>
    </div>
  )
}
