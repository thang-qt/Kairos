import { HugeiconsIcon } from '@hugeicons/react'
import {
  ComputerIcon,
  Moon01Icon,
  Sun01Icon,
} from '@hugeicons/core-free-icons'
import type { ComponentType } from 'react'
import type {ThemeMode, ThemePalette} from '@/hooks/use-chat-settings';
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsList, TabsTab } from '@/components/ui/tabs'
import {
  THEME_PALETTE_OPTIONS,
  
  
  themePaletteClassName,
  useChatSettings,
  useResolvedTheme
} from '@/hooks/use-chat-settings'
import { cn } from '@/lib/utils'

type SettingCardProps = {
  label: string
  description?: string
  children: React.ReactNode
}

type ThemePalettePreviewProps = {
  palette: ThemePalette
  resolvedTheme: 'light' | 'dark'
}

const THEME_MODE_OPTIONS = [
  { value: 'system', label: 'System', icon: ComputerIcon },
  { value: 'light', label: 'Light', icon: Sun01Icon },
  { value: 'dark', label: 'Dark', icon: Moon01Icon },
] as const satisfies Array<{
  value: ThemeMode
  label: string
  icon: ComponentType<any>
}>

function SettingCard({ label, description, children }: SettingCardProps) {
  return (
    <div className="rounded-lg border border-primary-200 bg-surface px-4 py-3">
      <div className="mb-3">
        <div className="text-sm text-primary-900">{label}</div>
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

function ThemePalettePreview({
  palette,
  resolvedTheme,
}: ThemePalettePreviewProps) {
  return (
    <div
      className={cn(
        'rounded-md border border-primary-200 bg-primary-50/70 px-2.5 py-2',
        themePaletteClassName(palette),
        resolvedTheme,
      )}
    >
      <div className="flex items-center gap-1.5">
        <span className="size-3 rounded-full border border-primary-300 bg-primary-50" />
        <span className="size-3 rounded-full border border-primary-400 bg-primary-300" />
        <span className="size-3 rounded-full border border-primary-600 bg-primary-700" />
        <span className="ml-auto h-2 w-10 rounded-full bg-primary-900" />
      </div>
    </div>
  )
}

export function AppearanceSettingsControls() {
  const { settings, updateSettings } = useChatSettings()
  const resolvedTheme = useResolvedTheme()

  return (
    <div className="space-y-3">
      <SettingCard
        label="Mode"
        description="Choose whether the interface follows light, dark, or your system preference."
      >
        <Tabs
          value={settings.themeMode}
          onValueChange={function handleThemeModeChange(value) {
            updateSettings({ themeMode: value as ThemeMode })
          }}
        >
          <TabsList
            variant="default"
            className="gap-2 *:data-[slot=tab-indicator]:duration-0"
          >
            {THEME_MODE_OPTIONS.map((option) => (
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
      </SettingCard>

      <SettingCard
        label="Palette"
        description="Swap the app's color system without changing layout or behavior."
      >
        <div className="grid gap-2 sm:grid-cols-2">
          {THEME_PALETTE_OPTIONS.map((option) => {
            const active = option.value === settings.themePalette
            return (
              <button
                key={option.value}
                type="button"
                onClick={function handlePaletteClick() {
                  updateSettings({ themePalette: option.value })
                }}
                className={cn(
                  'rounded-lg border px-3 py-3 text-left transition-colors',
                  active
                    ? 'border-primary-400 bg-primary-50'
                    : 'border-primary-200 bg-surface hover:border-primary-300 hover:bg-primary-50/60',
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm text-primary-900">
                      {option.label}
                    </div>
                    <div className="mt-1 text-pretty text-xs text-primary-500">
                      {option.description}
                    </div>
                  </div>
                  <div
                    className={cn(
                      'shrink-0 rounded-full px-2 py-0.5 text-[11px] tabular-nums',
                      active
                        ? 'bg-primary-200 text-primary-900'
                        : 'bg-primary-100 text-primary-700',
                    )}
                  >
                    {active ? 'Active' : 'Set'}
                  </div>
                </div>
                <div className="mt-3">
                  <ThemePalettePreview
                    palette={option.value}
                    resolvedTheme={resolvedTheme}
                  />
                </div>
              </button>
            )
          })}
        </div>
      </SettingCard>

      <SettingCard
        label="Wide mode"
        description="Use a wider layout for message content."
      >
        <div className="flex items-center justify-end">
          <Switch
            checked={settings.wideMode}
            onCheckedChange={function handleWideModeChange(checked) {
              updateSettings({ wideMode: checked })
            }}
          />
        </div>
      </SettingCard>
    </div>
  )
}
