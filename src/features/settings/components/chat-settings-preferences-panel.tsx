import { useMutation, useQueryClient } from '@tanstack/react-query'

import { ModelSettingsPanel } from '@/features/chat/components/model-settings-panel'
import { appQueryKeys, updateChatSettingsPreferences } from '@/lib/app-api'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'

import type { ConversationSettings } from '@/features/chat/conversation-settings'
import type { ProviderModel } from '@/lib/app-api'

type ChatSettingsPreferencesPanelProps = {
  models: Array<ProviderModel>
  defaultModelId?: string
  defaults: ConversationSettings
  modelId?: string
  modelOverride?: ConversationSettings
}

export function ChatSettingsPreferencesPanel({
  models,
  defaultModelId,
  defaults,
  modelId,
  modelOverride,
}: ChatSettingsPreferencesPanelProps) {
  const queryClient = useQueryClient()
  const updateMutation = useMutation({
    mutationFn: updateChatSettingsPreferences,
    onSuccess: function storeSettings(settings) {
      queryClient.setQueryData(appQueryKeys.chatSettings, settings)
    },
  })
  const isModelOverride = Boolean(modelId)
  const value = modelOverride ?? defaults

  function save(updates: Partial<ConversationSettings>) {
    const next = {
      ...value,
      ...updates,
      advanced: { ...value.advanced, ...updates.advanced },
    }
    if (modelId) {
      void updateMutation.mutateAsync({ modelId, modelSettings: next })
      return
    }
    void updateMutation.mutateAsync({ defaultSettings: next })
  }

  function setModelOverride(enabled: boolean) {
    if (!modelId) return
    if (enabled) {
      void updateMutation.mutateAsync({ modelId, modelSettings: defaults })
      return
    }
    void updateMutation.mutateAsync({ modelId, clearModelOverride: true })
  }

  return (
    <section className="overflow-hidden rounded-xl border border-primary-200 bg-surface">
      <div className="border-b border-primary-200 px-4 py-3">
        <div className="text-balance text-sm font-medium text-primary-900">
          {isModelOverride ? 'Model chat settings' : 'Default chat settings'}
        </div>
        <p className="text-pretty text-xs text-primary-500">
          {isModelOverride
            ? 'Override the defaults whenever this model starts a new conversation.'
            : 'Used for every new conversation unless its model has an override.'}
        </p>
      </div>

      {isModelOverride ? (
        <div className="flex items-center justify-between gap-3 border-b border-primary-200 px-4 py-3">
          <div className="text-sm text-primary-800">
            Use model-specific settings
          </div>
          <Switch
            checked={Boolean(modelOverride)}
            onCheckedChange={setModelOverride}
            disabled={updateMutation.isPending}
          />
        </div>
      ) : null}

      {!isModelOverride || modelOverride ? (
        <ModelSettingsPanel
          models={models}
          selectedModelId={modelId || defaultModelId || ''}
          defaultModelId={defaultModelId}
          showModelInfo={false}
          value={value}
          onChange={save}
        />
      ) : null}

      {isModelOverride && modelOverride ? (
        <div className="border-t border-primary-200 px-4 py-3">
          <Button
            variant="outline"
            size="sm"
            disabled={updateMutation.isPending}
            onClick={function clearOverride() {
              setModelOverride(false)
            }}
          >
            Reset to defaults
          </Button>
        </div>
      ) : null}
    </section>
  )
}
