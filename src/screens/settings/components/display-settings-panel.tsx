import { Switch } from '@/components/ui/switch'
import { useChatSettings } from '@/hooks/use-chat-settings'

type SettingsRowProps = {
  label: string
  description?: string
  children: React.ReactNode
}

function SettingsRow({ label, description, children }: SettingsRowProps) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-primary-200 bg-surface px-4 py-3">
      <div className="min-w-0 flex-1">
        <div className="text-sm text-primary-900">{label}</div>
        {description ? (
          <div className="text-pretty text-xs text-primary-500">
            {description}
          </div>
        ) : null}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}

export function DisplaySettingsPanel() {
  const { settings, updateSettings } = useChatSettings()

  return (
    <div className="space-y-3">
      <SettingsRow
        label="Tool messages"
        description="Show tool calls and tool outputs inline in chat."
      >
        <Switch
          checked={settings.showToolMessages}
          onCheckedChange={function handleCheckedChange(checked) {
            updateSettings({ showToolMessages: checked })
          }}
        />
      </SettingsRow>

      <SettingsRow
        label="Reasoning blocks"
        description="Show reasoning sections when a model returns them."
      >
        <Switch
          checked={settings.showReasoningBlocks}
          onCheckedChange={function handleCheckedChange(checked) {
            updateSettings({ showReasoningBlocks: checked })
          }}
        />
      </SettingsRow>

      <SettingsRow
        label="Conversation navigator"
        description="Show branch navigation controls in the message list."
      >
        <Switch
          checked={settings.showConversationNavigator}
          onCheckedChange={function handleCheckedChange(checked) {
            updateSettings({ showConversationNavigator: checked })
          }}
        />
      </SettingsRow>
    </div>
  )
}
