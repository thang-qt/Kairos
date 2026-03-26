import { ChatModelSelector } from './chat-model-selector'
import type { ProviderModel } from '@/lib/app-api'
import type { ThinkingLevel } from '@/hooks/use-chat-settings'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

type ModelSettingsValue = {
  model: string
  systemPrompt: string
  temperature: string
  topP: string
  maxOutputTokens: string
  thinkingLevel: ThinkingLevel
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

const THINKING_LEVEL_OPTIONS = [
  { label: 'Low', value: 'low' },
  { label: 'Medium', value: 'medium' },
  { label: 'High', value: 'high' },
] satisfies Array<{ label: string; value: ThinkingLevel }>

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

export function ModelSettingsPanel({
  models,
  selectedModelId,
  defaultModelId,
  loading = false,
  canSelectModel = true,
  defaultModelLocked = false,
  value,
  onChange,
}: ModelSettingsPanelProps) {
  return (
    <div className="pb-4">
      <PanelSection title="Model">
        <FieldBlock
          label="Active model"
          description="Choose the model used for the next turn in this conversation."
        >
          <ChatModelSelector
            models={models}
            selectedModelId={selectedModelId}
            defaultModelId={defaultModelId}
            loading={loading}
            canSelectModel={canSelectModel}
            defaultModelLocked={defaultModelLocked}
            onSelectModel={function handleSelectModel(modelId) {
              onChange({ model: modelId })
            }}
            className="w-full justify-between rounded-lg border border-primary-200 px-3 py-2 hover:bg-primary-50"
          />
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

      <PanelSection title="Sampling">
        <FieldBlock
          label="Reasoning effort"
          description="Sent as `reasoning_effort` for OpenAI-compatible chat completions."
        >
          <div className="grid grid-cols-3 gap-2">
            {THINKING_LEVEL_OPTIONS.map(function renderOption(option) {
              const isActive = value.thinkingLevel === option.value
              return (
                <Button
                  key={option.value}
                  size="sm"
                  variant={isActive ? 'secondary' : 'outline'}
                  onClick={function handleClick() {
                    onChange({ thinkingLevel: option.value })
                  }}
                  className={cn(
                    'w-full',
                    isActive &&
                      'border-primary-300 bg-primary-200 text-primary-950 shadow-xs outline outline-primary-900/10',
                  )}
                >
                  {option.label}
                </Button>
              )
            })}
          </div>
        </FieldBlock>

        <FieldBlock
          label="Temperature"
          description="Optional. Use a value between 0 and 2."
        >
          <Input
            nativeInput
            type="number"
            min="0"
            max="2"
            step="0.1"
            value={value.temperature}
            onChange={function handleChange(
              event: React.ChangeEvent<HTMLInputElement>,
            ) {
              onChange({ temperature: event.target.value })
            }}
            placeholder="Default"
          />
        </FieldBlock>

        <FieldBlock
          label="Top P"
          description="Optional. Use a value between 0 and 1."
        >
          <Input
            nativeInput
            type="number"
            min="0"
            max="1"
            step="0.05"
            value={value.topP}
            onChange={function handleChange(
              event: React.ChangeEvent<HTMLInputElement>,
            ) {
              onChange({ topP: event.target.value })
            }}
            placeholder="Default"
          />
        </FieldBlock>

        <FieldBlock
          label="Max output tokens"
          description="Optional. Caps completion length for this conversation."
        >
          <Input
            nativeInput
            type="number"
            min="1"
            step="1"
            value={value.maxOutputTokens}
            onChange={function handleChange(
              event: React.ChangeEvent<HTMLInputElement>,
            ) {
              onChange({ maxOutputTokens: event.target.value })
            }}
            placeholder="Default"
          />
        </FieldBlock>
      </PanelSection>
    </div>
  )
}
