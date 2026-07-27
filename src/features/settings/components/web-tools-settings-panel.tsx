import { useEffect, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { ChangeEvent, FormEvent } from 'react'
import {
  ApiError,
  appQueryKeys,
  updateWebToolSettings,
  useWebToolSettingsQuery,
  type WebToolProvider,
} from '@/lib/app-api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

type MessageTone = 'success' | 'error'
type ProviderDraft = { apiKey: string; clearApiKey: boolean; enabled: boolean }
const providerNames: WebToolProvider[] = ['exa', 'tinyfish']

function getErrorMessage(error: unknown, fallback: string) {
  if (error instanceof ApiError || error instanceof Error) return error.message
  return fallback
}
function readValue(event: ChangeEvent<HTMLInputElement>) {
  return event.currentTarget.value
}
function FieldLabel({ htmlFor, label }: { htmlFor: string; label: string }) {
  return (
    <label htmlFor={htmlFor} className="text-sm text-primary-900">
      {label}
    </label>
  )
}
function InlineMessage({
  tone,
  message,
}: {
  tone: MessageTone
  message: string
}) {
  return (
    <div
      className={cn(
        'rounded-lg px-3 py-2 text-sm',
        tone === 'success'
          ? 'border border-primary-200 bg-primary-50 text-primary-800'
          : 'border border-red-200 bg-red-50 text-red-700',
      )}
    >
      {message}
    </div>
  )
}
function emptyDraft(enabled = false): ProviderDraft {
  return { apiKey: '', clearApiKey: false, enabled }
}

export function WebToolsSettingsPanel() {
  const queryClient = useQueryClient()
  const settingsQuery = useWebToolSettingsQuery()
  const [drafts, setDrafts] = useState<Record<WebToolProvider, ProviderDraft>>({
    exa: emptyDraft(true),
    tinyfish: emptyDraft(),
  })
  const [defaultProvider, setDefaultProvider] = useState<WebToolProvider>('exa')
  const [searchMaxResults, setSearchMaxResults] = useState('5')
  const [fetchMaxCharacters, setFetchMaxCharacters] = useState('10000')
  const [toolCallLimit, setToolCallLimit] = useState('24')
  const [message, setMessage] = useState<{
    tone: MessageTone
    text: string
  } | null>(null)

  useEffect(
    function syncSettings() {
      if (!settingsQuery.data) return
      setDefaultProvider(settingsQuery.data.provider)
      setSearchMaxResults(String(settingsQuery.data.searchMaxResults))
      setFetchMaxCharacters(String(settingsQuery.data.fetchMaxCharacters))
      setToolCallLimit(String(settingsQuery.data.toolCallLimit))
      setDrafts(function makeDrafts() {
        return Object.fromEntries(
          providerNames.map(function makeDraft(provider) {
            const settings = settingsQuery.data.providers.find(
              function findProvider(item) {
                return item.provider === provider
              },
            )
            return [provider, emptyDraft(settings?.enabled)]
          }),
        ) as Record<WebToolProvider, ProviderDraft>
      })
    },
    [settingsQuery.data],
  )

  const saveMutation = useMutation({
    mutationFn: updateWebToolSettings,
    onSuccess: async function handleSuccess() {
      setMessage({ tone: 'success', text: 'Web tool settings saved.' })
      await queryClient.invalidateQueries({ queryKey: appQueryKeys.webTools })
    },
    onError: function handleError(error) {
      setMessage({
        tone: 'error',
        text: getErrorMessage(error, 'Failed to save web tool settings.'),
      })
    },
  })
  function updateDraft(
    provider: WebToolProvider,
    update: Partial<ProviderDraft>,
  ) {
    setDrafts(function applyDraft(current) {
      return { ...current, [provider]: { ...current[provider], ...update } }
    })
  }
  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setMessage(null)
    saveMutation.mutate({
      provider: defaultProvider,
      providers: providerNames.map(function toPayload(provider) {
        const draft = drafts[provider]
        return {
          provider,
          apiKey: draft.apiKey.trim() || undefined,
          clearApiKey: draft.clearApiKey,
          enabled: draft.enabled,
        }
      }),
      searchMaxResults: Number.parseInt(searchMaxResults, 10),
      fetchMaxCharacters: Number.parseInt(fetchMaxCharacters, 10),
      toolCallLimit: Number.parseInt(toolCallLimit, 10),
    })
  }
  const configuredProviders =
    settingsQuery.data?.providers.filter(function configured(provider) {
      return provider.enabled && provider.apiKeyConfigured
    }) ?? []
  return (
    <main className="min-h-0 flex-1 overflow-y-auto px-4 pb-10 pt-2">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
        <section className="rounded-xl border border-primary-200 bg-surface p-5">
          <div className="mb-4 max-w-2xl">
            <h2 className="text-balance text-base font-medium text-primary-950">
              Web tools
            </h2>
            <p className="mt-1 text-pretty text-sm text-primary-500">
              Configure web search and URL fetching for assistant turns.
            </p>
          </div>
          <form
            onSubmit={handleSubmit}
            className="flex max-w-2xl flex-col gap-4"
          >
            <div className="flex flex-col gap-1.5">
              <FieldLabel
                htmlFor="web-default-provider"
                label="Default provider"
              />
              <select
                id="web-default-provider"
                value={defaultProvider}
                onChange={function changeDefault(event) {
                  setDefaultProvider(
                    event.currentTarget.value as WebToolProvider,
                  )
                }}
                className="h-10 rounded-md border border-primary-200 bg-surface px-3 text-sm text-primary-900"
              >
                <option value="exa">Exa</option>
                <option value="tinyfish">TinyFish</option>
              </select>
              <p className="text-pretty text-xs text-primary-500">
                Choose an enabled provider with an API key. Tool calls use this
                unless they explicitly select another enabled provider.
              </p>
              {configuredProviders.length > 1 ? null : (
                <p className="text-xs text-primary-500">
                  Enable and configure another provider to choose between
                  defaults.
                </p>
              )}
            </div>
            {providerNames.map(function renderProvider(provider) {
              const settings = settingsQuery.data?.providers.find(
                function find(item) {
                  return item.provider === provider
                },
              )
              const draft = drafts[provider]
              const label = provider === 'exa' ? 'Exa' : 'TinyFish'
              const envName =
                provider === 'exa' ? 'EXA_API_KEY' : 'TINYFISH_API_KEY'
              return (
                <section
                  key={provider}
                  className="rounded-lg border border-primary-200 bg-primary-50/60 p-4"
                >
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <div>
                      <h3 className="text-sm font-medium text-primary-950">
                        {label}
                      </h3>
                      <p className="text-xs text-primary-600">
                        {settings?.apiKeyConfigured
                          ? 'API key configured'
                          : 'API key missing'}
                      </p>
                    </div>
                    <label className="flex items-center gap-2 text-sm text-primary-700">
                      <input
                        type="checkbox"
                        checked={draft.enabled}
                        onChange={function changeEnabled(event) {
                          updateDraft(provider, {
                            enabled: event.currentTarget.checked,
                          })
                        }}
                      />
                      Enabled
                    </label>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <FieldLabel
                      htmlFor={`${provider}-api-key`}
                      label={`${label} API key`}
                    />
                    <Input
                      id={`${provider}-api-key`}
                      type="password"
                      nativeInput
                      autoComplete="off"
                      value={draft.apiKey}
                      placeholder={
                        settings?.apiKeyConfigured
                          ? 'Leave blank to keep current key'
                          : `Paste ${envName}`
                      }
                      onChange={function changeKey(event) {
                        const apiKey = readValue(event)
                        updateDraft(provider, {
                          apiKey,
                          clearApiKey: apiKey.trim()
                            ? false
                            : draft.clearApiKey,
                        })
                      }}
                    />
                  </div>
                  {settings?.apiKeyConfigured ? (
                    <label className="mt-3 flex items-center gap-2 text-sm text-primary-700">
                      <input
                        type="checkbox"
                        checked={draft.clearApiKey}
                        onChange={function clearKey(event) {
                          updateDraft(provider, {
                            clearApiKey: event.currentTarget.checked,
                            apiKey: event.currentTarget.checked
                              ? ''
                              : draft.apiKey,
                          })
                        }}
                      />
                      Clear saved API key
                    </label>
                  ) : null}
                </section>
              )
            })}
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="flex flex-col gap-1.5">
                <FieldLabel
                  htmlFor="web-search-max-results"
                  label="Max search results"
                />
                <Input
                  id="web-search-max-results"
                  type="number"
                  nativeInput
                  min={1}
                  max={10}
                  value={searchMaxResults}
                  onChange={function change(event) {
                    setSearchMaxResults(readValue(event))
                  }}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <FieldLabel
                  htmlFor="web-fetch-max-characters"
                  label="Max fetch characters"
                />
                <Input
                  id="web-fetch-max-characters"
                  type="number"
                  nativeInput
                  min={1000}
                  max={50000}
                  step={1000}
                  value={fetchMaxCharacters}
                  onChange={function change(event) {
                    setFetchMaxCharacters(readValue(event))
                  }}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <FieldLabel htmlFor="tool-call-limit" label="Tool-call limit" />
                <Input
                  id="tool-call-limit"
                  type="number"
                  nativeInput
                  min={1}
                  max={100}
                  value={toolCallLimit}
                  onChange={function change(event) {
                    setToolCallLimit(readValue(event))
                  }}
                />
              </div>
            </div>
            {message ? (
              <InlineMessage tone={message.tone} message={message.text} />
            ) : null}
            <div className="flex justify-end">
              <Button type="submit" disabled={saveMutation.isPending}>
                {saveMutation.isPending ? 'Saving…' : 'Save web tools'}
              </Button>
            </div>
          </form>
        </section>
      </div>
    </main>
  )
}
