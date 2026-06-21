import { useEffect, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { ChangeEvent, FormEvent } from 'react'
import {
  ApiError,
  appQueryKeys,
  updateWebToolSettings,
  useWebToolSettingsQuery,
} from '@/lib/app-api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

type MessageTone = 'success' | 'error'

function getErrorMessage(error: unknown, fallback: string) {
  if (error instanceof ApiError) {
    return error.message
  }
  if (error instanceof Error) {
    return error.message
  }
  return fallback
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

function FieldLabel({ htmlFor, label }: { htmlFor: string; label: string }) {
  return (
    <label htmlFor={htmlFor} className="text-sm text-primary-900">
      {label}
    </label>
  )
}

function readValue(event: ChangeEvent<HTMLInputElement>) {
  return event.currentTarget.value
}

export function WebToolsSettingsPanel() {
  const queryClient = useQueryClient()
  const settingsQuery = useWebToolSettingsQuery()
  const [apiKey, setApiKey] = useState('')
  const [clearApiKey, setClearApiKey] = useState(false)
  const [searchMaxResults, setSearchMaxResults] = useState('5')
  const [fetchMaxCharacters, setFetchMaxCharacters] = useState('10000')
  const [message, setMessage] = useState<{
    tone: MessageTone
    text: string
  } | null>(null)

  useEffect(
    function syncSettings() {
      if (!settingsQuery.data) {
        return
      }
      setSearchMaxResults(String(settingsQuery.data.searchMaxResults))
      setFetchMaxCharacters(String(settingsQuery.data.fetchMaxCharacters))
    },
    [settingsQuery.data],
  )

  const saveMutation = useMutation({
    mutationFn: updateWebToolSettings,
    onSuccess: async function handleSuccess() {
      setApiKey('')
      setClearApiKey(false)
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

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setMessage(null)
    saveMutation.mutate({
      provider: 'exa',
      apiKey: apiKey.trim() || undefined,
      clearApiKey,
      searchMaxResults: Number.parseInt(searchMaxResults, 10),
      fetchMaxCharacters: Number.parseInt(fetchMaxCharacters, 10),
    })
  }

  const configured = settingsQuery.data?.apiKeyConfigured ?? false

  return (
    <main className="min-h-0 flex-1 overflow-y-auto px-4 pb-10 pt-2">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
        <section className="rounded-xl border border-primary-200 bg-surface p-5">
          <div className="mb-4 max-w-2xl">
            <h2 className="text-balance text-base text-primary-950">
              Web tools
            </h2>
            <p className="mt-1 text-pretty text-sm text-primary-500">
              Configure provider-neutral web search and fetch. For now Kairos
              uses Exa, then exposes it to models as normal function tools.
            </p>
          </div>

          <form
            onSubmit={handleSubmit}
            className="flex max-w-2xl flex-col gap-4"
          >
            <div className="rounded-lg border border-primary-200 bg-primary-50/60 px-3 py-2 text-sm text-primary-700">
              Provider:{' '}
              <span className="font-medium text-primary-950">Exa</span>
              {configured ? (
                <span className="ml-2 text-primary-600">
                  API key configured
                </span>
              ) : (
                <span className="ml-2 text-red-700">API key missing</span>
              )}
            </div>

            <div className="flex flex-col gap-1.5">
              <FieldLabel htmlFor="exa-api-key" label="Exa API key" />
              <Input
                id="exa-api-key"
                type="password"
                nativeInput
                autoComplete="off"
                value={apiKey}
                placeholder={
                  configured
                    ? 'Leave blank to keep current key'
                    : 'Paste EXA_API_KEY'
                }
                onChange={function handleAPIKeyChange(event) {
                  setApiKey(readValue(event))
                  if (readValue(event).trim()) {
                    setClearApiKey(false)
                  }
                }}
              />
              <p className="text-xs text-primary-500">
                Stored encrypted in the local database. Environment EXA_API_KEY
                is still used only when no per-user setting exists.
              </p>
            </div>

            {configured ? (
              <label className="flex items-center gap-2 text-sm text-primary-700">
                <input
                  type="checkbox"
                  checked={clearApiKey}
                  onChange={function handleClearChange(event) {
                    setClearApiKey(event.currentTarget.checked)
                    if (event.currentTarget.checked) {
                      setApiKey('')
                    }
                  }}
                />
                Clear saved API key
              </label>
            ) : null}

            <div className="grid gap-4 sm:grid-cols-2">
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
                  onChange={function handleChange(event) {
                    setSearchMaxResults(readValue(event))
                  }}
                />
                <p className="text-xs text-primary-500">Allowed range: 1–10.</p>
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
                  onChange={function handleChange(event) {
                    setFetchMaxCharacters(readValue(event))
                  }}
                />
                <p className="text-xs text-primary-500">
                  Allowed range: 1,000–50,000.
                </p>
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
