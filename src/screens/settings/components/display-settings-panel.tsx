import { Switch } from '@/components/ui/switch'
import { Tabs, TabsList, TabsTab } from '@/components/ui/tabs'
import { useChatSettings } from '@/hooks/use-chat-settings'
import type { ReasoningCollapseMode } from '@/hooks/use-chat-settings'

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

      {settings.showReasoningBlocks && (
        <div className="space-y-3 rounded-lg border border-primary-200 bg-surface px-4 py-3">
          <div>
            <div className="text-sm text-primary-900">
              Reasoning collapse behavior
            </div>
            <div className="text-pretty text-xs text-primary-500">
              Configure how reasoning blocks are shown in the chat window.
            </div>
          </div>
          <Tabs
            value={settings.reasoningCollapseMode}
            onValueChange={function handleReasoningCollapseModeChange(value) {
              updateSettings({
                reasoningCollapseMode: value as ReasoningCollapseMode,
              })
            }}
            className="w-full"
          >
            <TabsList
              variant="default"
              className="flex w-full gap-1 rounded-lg border border-primary-200/50 bg-primary-100/50 p-1"
            >
              <TabsTab
                value="collapsed"
                className="flex-1 justify-center py-1.5 text-center"
              >
                Collapsed
              </TabsTab>
              <TabsTab
                value="expanded-while-thinking"
                className="flex-1 justify-center py-1.5 text-center"
              >
                Expanded while thinking
              </TabsTab>
              <TabsTab
                value="expanded"
                className="flex-1 justify-center py-1.5 text-center"
              >
                Expanded
              </TabsTab>
            </TabsList>
          </Tabs>
        </div>
      )}

      <SettingsRow
        label="Conversation navigator"
        description="Show quick navigation controls in the message list."
      >
        <Switch
          checked={settings.showConversationNavigator}
          onCheckedChange={function handleCheckedChange(checked) {
            updateSettings({ showConversationNavigator: checked })
          }}
        />
      </SettingsRow>

      <SettingsRow
        label="Sidebar section counts"
        description="Show the number of conversations in each sidebar group."
      >
        <Switch
          checked={settings.showSidebarSectionCounts}
          onCheckedChange={function handleCheckedChange(checked) {
            updateSettings({ showSidebarSectionCounts: checked })
          }}
        />
      </SettingsRow>
    </div>
  )
}
