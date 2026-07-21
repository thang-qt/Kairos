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
    <ChatSettingsPreferencesPanel
      models={models}
      defaultModelId={defaultModelId}
      defaults={chatSettingsQuery.data.defaultSettings}
    />
  )
}
