import { useState } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  Cancel01Icon,
} from '@hugeicons/core-free-icons'
import { ProviderSettingsPanel } from './provider-settings-panel'
import { ModelSettingsPanel } from './model-settings-panel'
import {
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogRoot,
  DialogTitle,
} from '@/components/ui/dialog'
import { Switch } from '@/components/ui/switch'
import { AppearanceSettingsControls } from '@/components/appearance-settings-controls'
import { useChatSettings } from '@/hooks/use-chat-settings'
import { Button } from '@/components/ui/button'

type SettingsRowProps = {
  label: string
  description?: string
  children: React.ReactNode
}

function SettingsRow({ label, description, children }: SettingsRowProps) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex-1 select-none">
        <div className="text-sm text-primary-800">{label}</div>
        {description && (
          <div className="text-xs text-primary-500">{description}</div>
        )}
      </div>
      <div className="flex items-center gap-2">{children}</div>
    </div>
  )
}

type SettingsDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  onClose: () => void
  onLogout?: () => void
  logoutPending?: boolean
}

export function SettingsDialog({
  open,
  onOpenChange,
  onClose,
  onLogout,
  logoutPending = false,
}: SettingsDialogProps) {
  const { settings, updateSettings } = useChatSettings()
  const [activeTab, setActiveTab] = useState<
    'connection' | 'appearance' | 'display'
  >('connection')

  return (
    <DialogRoot open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[min(640px,85vh)] w-[min(720px,92vw)] flex-col overflow-hidden">
        <div className="flex flex-1 flex-col overflow-hidden p-4">
          <div className="flex items-start justify-between">
            <div>
              <DialogTitle className="mb-1">Settings</DialogTitle>
              <DialogDescription className="hidden">
                Configure Kairos
              </DialogDescription>
            </div>
            <DialogClose
              render={
                <Button
                  size="icon-sm"
                  variant="ghost"
                  className="text-primary-500 hover:bg-primary-100 hover:text-primary-700"
                  aria-label="Close"
                >
                  <HugeiconsIcon
                    icon={Cancel01Icon}
                    size={20}
                    strokeWidth={1.5}
                  />
                </Button>
              }
            />
          </div>

          <div className="mt-4 flex min-h-0 flex-1 gap-4">
            <nav className="flex w-40 shrink-0 flex-col gap-1">
              <button
                type="button"
                onClick={function handleClick() {
                  setActiveTab('connection')
                }}
                className={
                  activeTab === 'connection'
                    ? 'rounded-md bg-primary-100 px-3 py-2 text-left text-sm text-primary-900'
                    : 'rounded-md px-3 py-2 text-left text-sm text-primary-700 hover:bg-primary-50'
                }
              >
                Connection
              </button>
              <button
                type="button"
                onClick={function handleClick() {
                  setActiveTab('appearance')
                }}
                className={
                  activeTab === 'appearance'
                    ? 'rounded-md bg-primary-100 px-3 py-2 text-left text-sm text-primary-900'
                    : 'rounded-md px-3 py-2 text-left text-sm text-primary-700 hover:bg-primary-50'
                }
              >
                Appearance
              </button>
              <button
                type="button"
                onClick={function handleClick() {
                  setActiveTab('display')
                }}
                className={
                  activeTab === 'display'
                    ? 'rounded-md bg-primary-100 px-3 py-2 text-left text-sm text-primary-900'
                    : 'rounded-md px-3 py-2 text-left text-sm text-primary-700 hover:bg-primary-50'
                }
              >
                Display
              </button>
            </nav>

            <div className="min-w-0 flex-1 overflow-y-auto">
              {activeTab === 'connection' ? (
                <div className="space-y-6">
                  <div>
                    <h3 className="mb-3 text-sm font-medium text-primary-900">
                      Providers
                    </h3>
                    <ProviderSettingsPanel />
                  </div>
                  <div>
                    <h3 className="mb-3 text-sm font-medium text-primary-900">
                      Default Model
                    </h3>
                    <ModelSettingsPanel />
                  </div>
                </div>
              ) : null}

              {activeTab === 'appearance' ? (
                <div className="space-y-4">
                  <h3 className="text-sm font-medium text-primary-900">
                    Appearance
                  </h3>
                  <AppearanceSettingsControls />
                </div>
              ) : null}

              {activeTab === 'display' ? (
                <div className="space-y-4">
                  <h3 className="text-sm font-medium text-primary-900">
                    Display Options
                  </h3>
                  <SettingsRow label="Show tool messages">
                    <Switch
                      checked={settings.showToolMessages}
                      onCheckedChange={function handleChange(checked) {
                        updateSettings({ showToolMessages: checked })
                      }}
                    />
                  </SettingsRow>
                  <SettingsRow label="Show reasoning blocks">
                    <Switch
                      checked={settings.showReasoningBlocks}
                      onCheckedChange={function handleChange(checked) {
                        updateSettings({ showReasoningBlocks: checked })
                      }}
                    />
                  </SettingsRow>
                  <SettingsRow
                    label="Conversation navigator"
                    description="Show the right-edge turn rail for jumping between user messages"
                  >
                    <Switch
                      checked={settings.showConversationNavigator}
                      onCheckedChange={function handleChange(checked) {
                        updateSettings({ showConversationNavigator: checked })
                      }}
                    />
                  </SettingsRow>
                </div>
              ) : null}
            </div>
          </div>

          <div className="mt-4 flex justify-end border-t border-primary-200 pt-4">
            {onLogout ? (
              <Button
                variant="outline"
                onClick={onLogout}
                disabled={logoutPending}
                className="mr-auto"
              >
                {logoutPending ? 'Signing out...' : 'Sign out'}
              </Button>
            ) : null}
            <DialogClose onClick={onClose}>Close</DialogClose>
          </div>
        </div>
      </DialogContent>
    </DialogRoot>
  )
}
