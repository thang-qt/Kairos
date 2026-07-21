import { ChatSettingsPreferencesPanel } from './chat-settings-preferences-panel'
import { useChatSettingsPreferencesQuery, useModelsQuery } from '@/lib/app-api'

export function ChatSettingsPanel() {
  const modelsQuery = useModelsQuery()
  const chatSettingsQuery = useChatSettingsPreferencesQuery()
  const models = modelsQuery.data?.models ?? []
  const defaultModelId = modelsQuery.data?.preferences.defaultModelId

  if (chatSettingsQuery.isLoading) {
    return (
      <div className="rounded-xl border border-primary-200 bg-surface p-6 text-pretty text-sm text-primary-500">
        Loading chat settings…
      </div>
    )
  }

  if (!chatSettingsQuery.data) {
    return (
      <div className="rounded-xl border border-primary-200 bg-surface p-6 text-pretty text-sm text-primary-500">
        Chat settings could not be loaded.
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-balance text-lg font-medium text-primary-950">
          Default chat settings
        </h2>
        <p className="text-pretty text-sm text-primary-600">
          These settings apply to new conversations. Model-specific overrides
          are configured from the selected model in Models & Providers.
        </p>
      </div>
      <ChatSettingsPreferencesPanel
        models={models}
        defaultModelId={defaultModelId}
        defaults={chatSettingsQuery.data.defaultSettings}
      />
    </div>
  )
}
