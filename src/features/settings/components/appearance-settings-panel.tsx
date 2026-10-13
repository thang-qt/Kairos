import { HugeiconsIcon } from '@hugeicons/react'
import { ComputerIcon, Moon01Icon, Sun01Icon } from '@hugeicons/core-free-icons'
import type { IconSvgElement } from '@hugeicons/react'
import type {
  ReasoningCollapseMode,
  ThemeMode,
  ThemePalette,
} from '@/app/preferences/app-preferences'
import {
  THEME_PALETTE_OPTIONS,
  themePaletteClassName,
  useChatSettings,
  useResolvedTheme,
} from '@/app/preferences/app-preferences'
import { Select } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'
import { SettingsPage, SettingsRow, SettingsSection } from './settings-layout'

const THEME_MODE_OPTIONS = [
  { value: 'system', label: 'System', icon: ComputerIcon },
  { value: 'light', label: 'Light', icon: Sun01Icon },
  { value: 'dark', label: 'Dark', icon: Moon01Icon },
] as const satisfies Array<{
  value: ThemeMode
  label: string
  icon: IconSvgElement
}>

export function AppearanceSettingsPanel() {
  const { settings, updateSettings } = useChatSettings()
  const resolvedTheme = useResolvedTheme()

  return (
    <SettingsPage
      title="Appearance"
      description="How Kairos looks and what each conversation shows. Changes apply right away."
    >
      <SettingsSection title="Theme">
        <div className="grid grid-cols-3 gap-2 p-3">
          {THEME_MODE_OPTIONS.map((option) => {
            const active = settings.themeMode === option.value
            return (
              <button
                key={option.value}
                type="button"
                aria-pressed={active}
                onClick={() => updateSettings({ themeMode: option.value })}
                className={cn(
                  'flex h-16 flex-col items-center justify-center gap-1 rounded-lg text-sm text-primary-700 ring-1 ring-primary-200 transition-colors hover:bg-primary-50 hover:text-primary-900',
                  active && 'bg-primary-100 text-primary-950 ring-primary-400',
                )}
              >
                <HugeiconsIcon icon={option.icon} size={20} strokeWidth={1.5} />
                {option.label}
              </button>
            )
          })}
        </div>
      </SettingsSection>

      <SettingsSection title="Color palette">
        <div className="grid gap-2 p-3 sm:grid-cols-2">
          {THEME_PALETTE_OPTIONS.map((option) => {
            const active = option.value === settings.themePalette
            return (
              <button
                key={option.value}
                type="button"
                aria-pressed={active}
                onClick={() => updateSettings({ themePalette: option.value })}
                className={cn(
                  'flex items-center gap-3 rounded-lg p-2.5 text-left ring-1 ring-primary-200 transition-colors hover:bg-primary-50',
                  active && 'bg-primary-100 ring-primary-400',
                )}
              >
                <PaletteSwatch
                  palette={option.value}
                  resolvedTheme={resolvedTheme}
                />
                <span className="min-w-0">
                  <span className="block text-sm text-primary-900">
                    {option.label}
                  </span>
                  <span className="line-clamp-1 text-xs text-primary-500">
                    {option.description}
                  </span>
                </span>
              </button>
            )
          })}
        </div>
      </SettingsSection>

      <SettingsSection title="Layout">
        <SettingsRow
          label="Wide mode"
          description="Let conversations use more of the window."
        >
          <Switch
            aria-label="Wide mode"
            checked={settings.wideMode}
            onCheckedChange={(checked) => updateSettings({ wideMode: checked })}
          />
        </SettingsRow>
        <SettingsRow
          label="Conversation navigator"
          description="A strip for jumping between messages in long chats."
        >
          <Switch
            aria-label="Conversation navigator"
            checked={settings.showConversationNavigator}
            onCheckedChange={(checked) =>
              updateSettings({ showConversationNavigator: checked })
            }
          />
        </SettingsRow>
        <SettingsRow
          label="Sidebar section counts"
          description="Show how many chats each sidebar group holds."
        >
          <Switch
            aria-label="Sidebar section counts"
            checked={settings.showSidebarSectionCounts}
            onCheckedChange={(checked) =>
              updateSettings({ showSidebarSectionCounts: checked })
            }
          />
        </SettingsRow>
      </SettingsSection>

      <SettingsSection
        title="Assistant activity"
        description="Thinking and tool steps appear in the activity panel next to each response."
      >
        <SettingsRow
          label="Tool steps"
          description="Include tool calls and web searches."
        >
          <Switch
            aria-label="Tool steps"
            checked={settings.showToolMessages}
            onCheckedChange={(checked) =>
              updateSettings({ showToolMessages: checked })
            }
          />
        </SettingsRow>
        <SettingsRow
          label="Reasoning"
          description="Include the model’s thinking."
        >
          <Switch
            aria-label="Reasoning"
            checked={settings.showReasoningBlocks}
            onCheckedChange={(checked) =>
              updateSettings({ showReasoningBlocks: checked })
            }
          />
        </SettingsRow>
        {settings.showReasoningBlocks ? (
          <SettingsRow
            label="Show reasoning"
            htmlFor="reasoning-collapse-mode"
            description="Whether thinking starts expanded or collapsed."
          >
            <Select<ReasoningCollapseMode>
              id="reasoning-collapse-mode"
              className="w-48"
              value={settings.reasoningCollapseMode}
              options={[
                { value: 'expanded-while-thinking', label: 'While thinking' },
                { value: 'expanded', label: 'Always expanded' },
                { value: 'collapsed', label: 'Always collapsed' },
              ]}
              onValueChange={(reasoningCollapseMode) =>
                updateSettings({ reasoningCollapseMode })
              }
            />
          </SettingsRow>
        ) : null}
      </SettingsSection>
    </SettingsPage>
  )
}

function PaletteSwatch({
  palette,
  resolvedTheme,
}: {
  palette: ThemePalette
  resolvedTheme: 'light' | 'dark'
}) {
  return (
    <span
      aria-hidden
      className={cn(
        'theme-preview flex shrink-0 -space-x-1.5 rounded-md bg-primary-50 p-1.5 ring-1 ring-primary-200',
        themePaletteClassName(palette),
        resolvedTheme,
      )}
    >
      <span className="size-4 rounded-full bg-primary-200 ring-2 ring-primary-50" />
      <span className="size-4 rounded-full bg-primary-500 ring-2 ring-primary-50" />
      <span className="size-4 rounded-full bg-primary-900 ring-2 ring-primary-50" />
    </span>
  )
}
