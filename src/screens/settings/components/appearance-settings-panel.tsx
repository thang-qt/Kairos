import { HugeiconsIcon } from '@hugeicons/react'
import {
  ComputerIcon,
  Moon01Icon,
  Sun01Icon,
} from '@hugeicons/core-free-icons'
import type { ThemeMode } from '@/hooks/use-chat-settings'
import { useChatSettings } from '@/hooks/use-chat-settings'
import { Tabs, TabsList, TabsTab } from '@/components/ui/tabs'
import { Switch } from '@/components/ui/switch'

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

function applyTheme(theme: ThemeMode) {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  const media = window.matchMedia('(prefers-color-scheme: dark)')
  root.classList.remove('light', 'dark', 'system')
  root.classList.add(theme)
  if (theme === 'system' && media.matches) {
    root.classList.add('dark')
  }
}

export function AppearanceSettingsPanel() {
  const { settings, updateSettings } = useChatSettings()

  const themeOptions = [
    { value: 'system', label: 'System', icon: ComputerIcon },
    { value: 'light', label: 'Light', icon: Sun01Icon },
    { value: 'dark', label: 'Dark', icon: Moon01Icon },
  ] as const

  return (
    <div className="space-y-3">
      <SettingsRow label="Theme" description="Apply the app theme globally.">
        <Tabs
          value={settings.theme}
          onValueChange={function handleThemeChange(value) {
            const nextTheme = value as ThemeMode
            applyTheme(nextTheme)
            updateSettings({ theme: nextTheme })
          }}
        >
          <TabsList
            variant="default"
            className="gap-2 *:data-[slot=tab-indicator]:duration-0"
          >
            {themeOptions.map((option) => (
              <TabsTab key={option.value} value={option.value}>
                <HugeiconsIcon
                  icon={option.icon}
                  size={20}
                  strokeWidth={1.5}
                />
                <span>{option.label}</span>
              </TabsTab>
            ))}
          </TabsList>
        </Tabs>
      </SettingsRow>

      <SettingsRow
        label="Wide mode"
        description="Use a wider layout for message content."
      >
        <Switch
          checked={settings.wideMode}
          onCheckedChange={function handleCheckedChange(checked) {
            updateSettings({ wideMode: checked })
          }}
        />
      </SettingsRow>
    </div>
  )
}
