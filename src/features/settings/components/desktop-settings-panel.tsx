import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  SegmentedControl,
  SettingsPage,
  SettingsRow,
  SettingsSection,
} from './settings-layout'
import type { DesktopSettings, HotkeyAction } from '@/lib/shell'
import { getDesktopBridge } from '@/lib/shell'

const desktopSettingsKey = ['desktop', 'settings'] as const

const HOTKEY_ACTIONS = [
  { value: 'show', label: 'Where I left off' },
  { value: 'new-chat', label: 'New chat' },
] as const satisfies ReadonlyArray<{ value: HotkeyAction; label: string }>

function desktopSettingsApi() {
  const settings = getDesktopBridge()?.settings
  if (!settings) throw new Error('Desktop settings are unavailable')
  return settings
}

function formatHotkey(hotkey: string) {
  return hotkey.replaceAll('Control', 'Ctrl').replaceAll('+', ' + ')
}

export function DesktopSettingsPanel() {
  const queryClient = useQueryClient()
  const settingsQuery = useQuery({
    queryKey: desktopSettingsKey,
    queryFn: function readDesktopSettings() {
      return desktopSettingsApi().get()
    },
    staleTime: Infinity,
  })

  const actionMutation = useMutation({
    mutationFn: function saveAction(action: HotkeyAction) {
      return desktopSettingsApi().setHotkeyAction(action)
    },
    onMutate: function applyAction(action) {
      const previous =
        queryClient.getQueryData<DesktopSettings>(desktopSettingsKey)
      if (previous)
        queryClient.setQueryData(desktopSettingsKey, {
          ...previous,
          hotkeyAction: action,
        })
      return { previous }
    },
    onError: function rollBack(_error, _action, context) {
      if (context?.previous)
        queryClient.setQueryData(desktopSettingsKey, context.previous)
    },
    onSuccess: function handleSaved(settings) {
      queryClient.setQueryData(desktopSettingsKey, settings)
    },
  })

  const settings = settingsQuery.data

  return (
    <SettingsPage
      title="Desktop app"
      description="How the Kairos window opens from anywhere on your computer."
    >
      <SettingsSection>
        <SettingsRow
          label="Shortcut opens to"
          description={
            settings
              ? `What you see when ${formatHotkey(settings.hotkey)} brings Kairos up.`
              : 'What you see when the global shortcut brings Kairos up.'
          }
        >
          {settings ? (
            <SegmentedControl
              label="Shortcut opens to"
              value={settings.hotkeyAction}
              options={HOTKEY_ACTIONS}
              disabled={actionMutation.isPending}
              onChange={function changeAction(action) {
                actionMutation.mutate(action)
              }}
            />
          ) : null}
        </SettingsRow>
      </SettingsSection>
    </SettingsPage>
  )
}
