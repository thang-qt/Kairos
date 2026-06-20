import { useState } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  Add01Icon,
  Cancel01Icon,
  Delete02Icon,
  PencilEdit02Icon,
  Settings01Icon,
} from '@hugeicons/core-free-icons'
import { AnimatePresence, motion } from 'motion/react'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import {
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogRoot,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { ProviderEditorForm } from './provider-editor-form'

type ProviderEditorState =
  | {
      mode: 'add'
    }
  | {
      mode: 'edit'
      providerId: string
    }

type ProviderDraftState = {
  label: string
  baseURL: string
  apiKey: string
}

type ProvidersDialogProps = {
  providers: Array<any>
  capabilities: any
  preferences: any
  editorState: ProviderEditorState | null
  draft: ProviderDraftState
  testingConnection: boolean
  testResult: { success: boolean; message: string } | null
  errorMessage: string
  updatePreferencesMutation: any
  toggleProviderMutation: any
  deleteProviderMutation: any
  saveProviderMutation: any
  createProviderMutation: any
  openEditEditor: (provider: any) => void
  openAddEditor: () => void
  resetEditorState: () => void
  updateDraft: (key: keyof ProviderDraftState, value: string) => void
  handleTestConnection: () => Promise<void>
  handleSaveProvider: () => void
  handleCreateProvider: () => void
}

export function ProvidersDialog({
  providers,
  capabilities,
  preferences,
  editorState,
  draft,
  testingConnection,
  testResult,
  errorMessage,
  updatePreferencesMutation,
  toggleProviderMutation,
  deleteProviderMutation,
  saveProviderMutation,
  createProviderMutation,
  openEditEditor,
  openAddEditor,
  resetEditorState,
  updateDraft,
  handleTestConnection,
  handleSaveProvider,
  handleCreateProvider,
}: ProvidersDialogProps) {
  const [open, setOpen] = useState(false)

  return (
    <DialogRoot open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button
            size="sm"
            variant="outline"
            className="h-9 gap-2 bg-surface hover:bg-primary-50 border-primary-200"
          >
            <HugeiconsIcon
              icon={Settings01Icon}
              size={20}
              strokeWidth={1.5}
              className="text-primary-600"
            />
            <span className="hidden sm:inline">Connection Settings</span>
            <span className="sm:hidden">Connections</span>
          </Button>
        }
      />

      <DialogContent className="w-[min(540px,95vw)] max-h-[85vh] flex flex-col p-6 overflow-hidden bg-primary-50">
        <div className="flex items-start justify-between">
          <div>
            <DialogTitle className="tracking-tight font-medium">
              API Connections & Keys
            </DialogTitle>
            <DialogDescription className="mt-1 text-pretty">
              Add OpenAI-compatible connections or toggle default server models.
            </DialogDescription>
          </div>
          <DialogClose
            render={
              <Button
                size="icon-sm"
                variant="ghost"
                className="text-primary-500 hover:bg-primary-100 hover:text-primary-700 h-8 w-8"
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

        <div className="flex-1 overflow-y-auto mt-6 pr-1 space-y-5">
          {capabilities?.systemProvidersEnabled ? (
            <div className="flex items-center justify-between gap-3 rounded-xl border border-primary-200 bg-primary-50/20 px-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-primary-955">
                  Use Kairos system models
                </div>
                <div className="text-xs text-primary-500 mt-0.5 text-pretty">
                  Allows selecting our cloud server providers when chatting.
                </div>
              </div>
              <Switch
                checked={preferences?.useSystemProviders ?? true}
                disabled={
                  !capabilities.canDisableSystemProvider ||
                  updatePreferencesMutation.isPending
                }
                onCheckedChange={function handleCheckedChange(checked) {
                  updatePreferencesMutation.mutate({
                    useSystemProviders: checked,
                  })
                }}
              />
            </div>
          ) : null}

          <div className="space-y-3">
            {providers.map(function renderProvider(provider) {
              const isEditingProvider =
                editorState?.mode === 'edit' &&
                editorState.providerId === provider.id

              return (
                <div
                  key={provider.ref}
                  className={cn(
                    'rounded-xl border border-primary-200 bg-surface overflow-hidden transition-all duration-200',
                    isEditingProvider &&
                      'ring-1 ring-primary-400 border-primary-400',
                  )}
                >
                  <div className="flex items-center gap-3 p-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium text-primary-955">
                          {provider.label}
                        </span>
                        <span
                          className={cn(
                            'rounded-full px-2 py-0.5 text-[9px] font-medium tracking-tight uppercase',
                            provider.systemManaged
                              ? 'bg-primary-200 text-primary-900'
                              : 'bg-primary-100 text-primary-700',
                          )}
                        >
                          {provider.systemManaged ? 'System' : 'Custom'}
                        </span>
                      </div>
                      <div className="truncate text-xs text-primary-500 mt-1 font-mono">
                        {provider.baseUrl || 'Internal'}
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      {!provider.systemManaged ? (
                        <Switch
                          checked={provider.enabled}
                          disabled={toggleProviderMutation.isPending}
                          onCheckedChange={function handleCheckedChange(
                            checked,
                          ) {
                            toggleProviderMutation.mutate({
                              providerId: provider.id,
                              enabled: checked,
                            })
                          }}
                        />
                      ) : (
                        <span className="text-[10px] font-medium text-primary-500 uppercase bg-primary-100 px-2 py-0.5 rounded">
                          {provider.enabled ? 'Active' : 'Disabled'}
                        </span>
                      )}

                      {!provider.systemManaged ? (
                        <>
                          <Button
                            size="icon-sm"
                            variant="ghost"
                            onClick={function handleEdit() {
                              openEditEditor(provider)
                            }}
                            className="text-primary-500 hover:bg-primary-50 h-8 w-8"
                          >
                            <HugeiconsIcon
                              icon={PencilEdit02Icon}
                              size={20}
                              strokeWidth={1.5}
                            />
                          </Button>
                          <Button
                            size="icon-sm"
                            variant="ghost"
                            onClick={function handleDelete() {
                              deleteProviderMutation.mutate(provider.id)
                            }}
                            className="text-primary-500 hover:text-red-700 hover:bg-red-50 h-8 w-8"
                          >
                            <HugeiconsIcon
                              icon={Delete02Icon}
                              size={20}
                              strokeWidth={1.5}
                            />
                          </Button>
                        </>
                      ) : null}
                    </div>
                  </div>

                  <AnimatePresence>
                    {isEditingProvider && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.15 }}
                        className="overflow-hidden"
                      >
                        <ProviderEditorForm
                          mode="edit"
                          draft={draft}
                          canAddCustomBaseUrl={
                            capabilities?.canAddCustomBaseUrl ?? true
                          }
                          updateDraft={updateDraft}
                          onCancel={resetEditorState}
                          onTestConnection={handleTestConnection}
                          testingConnection={testingConnection}
                          testResult={testResult}
                          onSubmit={handleSaveProvider}
                          submitPending={saveProviderMutation.isPending}
                        />
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              )
            })}
          </div>

          {capabilities?.userProvidersEnabled ? (
            <div className="space-y-3">
              {editorState?.mode !== 'add' ? (
                <button
                  type="button"
                  onClick={openAddEditor}
                  className="flex w-full flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed border-primary-300 bg-surface/50 p-4 text-center transition-all hover:border-primary-400 hover:bg-primary-50/30"
                >
                  <HugeiconsIcon
                    icon={Add01Icon}
                    size={20}
                    className="text-primary-600"
                    strokeWidth={1.5}
                  />
                  <span className="text-xs font-medium text-primary-850">
                    Add Custom Provider
                  </span>
                </button>
              ) : (
                <ProviderEditorForm
                  mode="add"
                  draft={draft}
                  canAddCustomBaseUrl={
                    capabilities?.canAddCustomBaseUrl ?? true
                  }
                  updateDraft={updateDraft}
                  onCancel={resetEditorState}
                  onTestConnection={handleTestConnection}
                  testingConnection={testingConnection}
                  testResult={testResult}
                  onSubmit={handleCreateProvider}
                  submitPending={createProviderMutation.isPending}
                />
              )}
            </div>
          ) : null}

          {errorMessage ? (
            <div className="rounded-lg bg-red-50 border border-red-100 px-3 py-2 text-xs text-red-700">
              {errorMessage}
            </div>
          ) : null}
        </div>

        <div className="mt-6 flex justify-end border-t border-primary-200 pt-4">
          <DialogClose
            onClick={function handleClose() {
              setOpen(false)
            }}
          >
            Close
          </DialogClose>
        </div>
      </DialogContent>
    </DialogRoot>
  )
}
