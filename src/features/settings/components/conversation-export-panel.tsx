import { useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { getChatBackend } from '@/lib/chat-backend'
import { buildBulkExport } from '@/features/chat/export/bulk-export'
import type { ExportSelection } from '@/features/chat/export/bulk-export'
import { downloadFile } from '@/features/chat/export/use-conversation-export'
import type { ConversationExportFormat } from '@/features/chat/export/use-conversation-export'
import {
  SettingsNotice,
  SettingsPage,
  SettingsSection,
} from './settings-layout'

export function ConversationExportPanel() {
  const [scope, setScope] = useState<ExportSelection['scope']>('all')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [limit, setLimit] = useState('100')
  const [format, setFormat] = useState<ConversationExportFormat>('json')
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const controller = useRef<AbortController | null>(null)
  const invalid =
    scope === 'range'
      ? !from || !to || from > to
      : scope === 'recent' &&
        (!Number.isSafeInteger(Number(limit)) || Number(limit) < 1)

  async function run() {
    if (busy || invalid) return
    const active = new AbortController()
    controller.current = active
    setBusy(true)
    setError('')
    setStatus('Preparing export…')
    try {
      const result = await buildBulkExport(
        getChatBackend(),
        { scope, from, to, limit: Number(limit) },
        format,
        active.signal,
        setStatus,
      )
      active.signal.throwIfAborted()
      downloadFile(
        result.content,
        `kairos-conversations-${new Date().toISOString().slice(0, 10)}.zip`,
        'application/zip',
      )
      setStatus(`Exported ${result.count} conversations.`)
    } catch (failure) {
      setStatus('')
      if (active.signal.aborted) setStatus('Export cancelled.')
      else
        setError(
          failure instanceof Error
            ? failure.message
            : 'Export failed. Please retry.',
        )
    } finally {
      controller.current = null
      setBusy(false)
    }
  }

  return (
    <SettingsPage
      title="Export conversations"
      description="Download a ZIP archive with one file per conversation."
    >
      <SettingsSection>
        <form
          className="flex flex-col gap-4 p-4"
          onSubmit={function submit(event) {
            event.preventDefault()
            void run()
          }}
        >
          <fieldset disabled={busy} className="flex min-w-0 flex-col gap-4">
            <div className="flex flex-col gap-1 text-sm text-primary-700">
              <label htmlFor="export-scope">Conversations</label>
              <Select
                id="export-scope"
                value={scope}
                options={[
                  { value: 'all', label: 'All conversations' },
                  { value: 'range', label: 'Date range' },
                  { value: 'recent', label: 'Most recent conversations' },
                ]}
                onValueChange={function change(value) {
                  setScope(value as ExportSelection['scope'])
                }}
              />
            </div>
            {scope === 'range' ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="flex flex-col gap-1 text-sm text-primary-700">
                  From
                  <Input
                    nativeInput
                    type="date"
                    required
                    value={from}
                    max={to || undefined}
                    onChange={function change(event) {
                      setFrom(event.target.value)
                    }}
                    className="tabular-nums"
                  />
                </label>
                <label className="flex flex-col gap-1 text-sm text-primary-700">
                  Through
                  <Input
                    nativeInput
                    type="date"
                    required
                    value={to}
                    min={from || undefined}
                    onChange={function change(event) {
                      setTo(event.target.value)
                    }}
                    className="tabular-nums"
                  />
                </label>
              </div>
            ) : null}
            {scope === 'recent' ? (
              <label className="flex flex-col gap-1 text-sm text-primary-700">
                Maximum conversations
                <Input
                  nativeInput
                  type="number"
                  min={1}
                  step={1}
                  required
                  value={limit}
                  onChange={function change(event) {
                    setLimit(event.target.value)
                  }}
                  className="tabular-nums"
                />
              </label>
            ) : null}
            {scope !== 'all' ? (
              <p className="text-pretty text-xs text-primary-500">
                Based on when conversations were last updated. Dates use your
                local time.
              </p>
            ) : null}
            <div className="flex flex-col gap-1 text-sm text-primary-700">
              <label htmlFor="export-format">Conversation file format</label>
              <Select
                id="export-format"
                value={format}
                options={[
                  { value: 'json', label: 'JSON' },
                  { value: 'markdown', label: 'Markdown' },
                  { value: 'text', label: 'Plain text' },
                ]}
                onValueChange={function change(value) {
                  setFormat(value as ConversationExportFormat)
                }}
              />
            </div>
            <p className="text-pretty text-xs text-primary-500">
              Attachments are not bundled. Markdown and text include message
              text only.
            </p>
          </fieldset>
          <div className="flex gap-2">
            <Button type="submit" disabled={busy || invalid}>
              {busy ? 'Exporting…' : 'Export'}
            </Button>
            {busy ? (
              <Button
                type="button"
                variant="outline"
                onClick={function cancel() {
                  controller.current?.abort()
                }}
              >
                Cancel
              </Button>
            ) : null}
          </div>
          {status ? (
            <p
              role="status"
              className="text-pretty text-sm tabular-nums text-primary-700"
            >
              {status}
            </p>
          ) : null}
          {error ? <SettingsNotice tone="error">{error}</SettingsNotice> : null}
        </form>
      </SettingsSection>
    </SettingsPage>
  )
}
