import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  appQueryKeys,
  updateChatSettingsPreferences,
  useChatSettingsPreferencesQuery,
  useModelsQuery,
} from '@/lib/app-api'
import { ModelSettingsPanel } from '@/features/chat/components/model-settings-panel'
import type { ConversationSettings } from '@/features/chat/conversation-settings'
import { ModelPicker } from '@/components/model-picker'
import { Switch } from '@/components/ui/switch'
import { mutationErrorMessage } from '@/lib/error-utils'
import { providerModelKey } from '@/lib/model-utils'
import { useUpdatePreferences } from '../hooks/use-update-preferences'
import {
  SettingsEmpty,
  SettingsNotice,
  SettingsPage,
  SettingsRow,
  SettingsSection,
} from './settings-layout'

export function ChatSettingsPanel() {
  const modelsQuery = useModelsQuery()
  const chatSettingsQuery = useChatSettingsPreferencesQuery()
  const preferencesMutation = useUpdatePreferences()
  const queryClient = useQueryClient()
  const defaultsMutation = useMutation({
    mutationFn: updateChatSettingsPreferences,
    onSuccess: (settings) =>
      queryClient.setQueryData(appQueryKeys.chatSettings, settings),
  })
  const models = modelsQuery.data?.models ?? []
  const preferences = modelsQuery.data?.preferences
  const capabilities = modelsQuery.data?.capabilities
  const defaultModelId = preferences?.defaultModelId
  const defaults = chatSettingsQuery.data?.defaultSettings
  const error = preferencesMutation.error ?? defaultsMutation.error
  const autoTitle = preferences?.autoGenerateTitle ?? false
  const separateTitleModel = preferences?.useSeparateTitleModel ?? false

  function saveDefaults(updates: Partial<ConversationSettings>) {
    if (!defaults) return
    defaultsMutation.mutate({
      defaultSettings: {
        ...defaults,
        ...updates,
        advanced: { ...defaults.advanced, ...updates.advanced },
      },
    })
  }

  function firstTitleModelId() {
    return (
      preferences?.titleGenerationModelId?.trim() ||
      defaultModelId?.trim() ||
      (models[0] ? providerModelKey(models[0]) : '')
    )
  }

  return (
    <SettingsPage
      title="Chat defaults"
      description="What every new conversation starts with. Each chat can still change these from its right sidebar."
    >
      {error ? (
        <SettingsNotice tone="error">
          {mutationErrorMessage(error, 'Failed to save chat settings.')}
        </SettingsNotice>
      ) : null}

      <SettingsSection title="Model">
        <SettingsRow
          label="Default model"
          description={
            capabilities?.defaultModelLocked
              ? 'Your administrator sets the default model.'
              : 'Used for new chats. Models can be added on the Providers page.'
          }
        >
          <ModelPicker
            align="end"
            label="Default model"
            models={models}
            selectedModelId={defaultModelId}
            loading={modelsQuery.isLoading}
            disabled={
              preferencesMutation.isPending ||
              capabilities?.defaultModelLocked === true
            }
            onSelectModel={(modelId) =>
              preferencesMutation.mutate({ defaultModelId: modelId })
            }
          />
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title="Titles">
        <SettingsRow
          label="Name chats automatically"
          description="Write a short title after the first reply."
        >
          <Switch
            aria-label="Name chats automatically"
            checked={autoTitle}
            disabled={preferencesMutation.isPending}
            onCheckedChange={(checked) =>
              preferencesMutation.mutate({ autoGenerateTitle: checked })
            }
          />
        </SettingsRow>
        {autoTitle ? (
          <SettingsRow
            label="Use a separate model for titles"
            description="A small, fast model keeps titles cheap."
          >
            <Switch
              aria-label="Use a separate model for titles"
              checked={separateTitleModel}
              disabled={preferencesMutation.isPending || models.length === 0}
              onCheckedChange={(checked) =>
                preferencesMutation.mutate({
                  useSeparateTitleModel: checked,
                  titleGenerationModelId: checked
                    ? firstTitleModelId()
                    : preferences?.titleGenerationModelId,
                })
              }
            />
          </SettingsRow>
        ) : null}
        {autoTitle && separateTitleModel ? (
          <SettingsRow label="Title model">
            <ModelPicker
              align="end"
              label="Title model"
              models={models}
              selectedModelId={preferences?.titleGenerationModelId}
              loading={modelsQuery.isLoading}
              disabled={preferencesMutation.isPending}
              onSelectModel={(modelId) =>
                preferencesMutation.mutate({ titleGenerationModelId: modelId })
              }
            />
          </SettingsRow>
        ) : null}
      </SettingsSection>

      <SettingsSection
        title="New chat settings"
        description="Models can override these from the Models page."
      >
        {defaults ? (
          <ModelSettingsPanel
            models={models}
            selectedModelId={defaultModelId || ''}
            defaultModelId={defaultModelId}
            showModelInfo={false}
            value={defaults}
            onChange={saveDefaults}
          />
        ) : (
          <SettingsEmpty>
            {chatSettingsQuery.isLoading
              ? 'Loading chat settings…'
              : 'Chat settings could not be loaded.'}
          </SettingsEmpty>
        )}
      </SettingsSection>
    </SettingsPage>
  )
}
