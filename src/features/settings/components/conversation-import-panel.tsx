import { useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/select'
import {
  importConversationWithProgress,
  isLocalChatImportHost,
} from '@/lib/chat-backend/http-chat-backend'
import type {
  ConversationImportReport,
  ConversationImportProgress,
} from '@/lib/chat-backend/http-chat-backend'
import { invalidateChatSessionQueries } from '@/features/chat/chat-queries'
import { conversationImportFormats } from '@/lib/chat-backend/import-formats'
import {
  SettingsNotice,
  SettingsPage,
  SettingsSection,
} from './settings-layout'

const formatOptions = conversationImportFormats.map(
  function formatOption(format) {
    return { value: format.id, label: format.label }
  },
)

export function ConversationImportPanel() {
  const [source, setSource] = useState(conversationImportFormats[0].id)
  const format =
    conversationImportFormats.find(function findFormat(item) {
      return item.id === source
    }) ?? conversationImportFormats[0]
  const [file, setFile] = useState<File | null>(null)
  const [report, setReport] = useState<ConversationImportReport | null>(null)
  const [phase, setPhase] = useState<'idle' | 'import'>('idle')
  const [progress, setProgress] = useState<ConversationImportProgress | null>(
    null,
  )
  const [finished, setFinished] = useState(false)
  const [error, setError] = useState('')
  const controller = useRef<AbortController | null>(null)
  const queryClient = useQueryClient()
  const local = isLocalChatImportHost(window.location.hostname)
  async function run() {
    if (!file || phase !== 'idle') return
    const active = new AbortController()
    controller.current = active
    setPhase('import')
    setReport(null)
    setFinished(false)
    setError('')
    try {
      const result = await importConversationWithProgress(
        source,
        file,
        active.signal,
        setProgress,
      )
      setReport(result)
      setFinished(!result.failed)
      if (result.failed) {
        setError(
          'Import stopped. Completed conversations were saved; retrying skips them.',
        )
      }
    } catch (failure) {
      if (active.signal.aborted) {
        setError(
          'Cancelled. If import had started, completed conversations may have been saved. Retrying skips completed conversations.',
        )
      } else {
        setError(
          failure instanceof Error
            ? failure.message
            : 'Import failed. Retrying skips completed conversations.',
        )
      }
      setReport(null)
    } finally {
      controller.current = null
      setPhase('idle')
      await invalidateChatSessionQueries(queryClient)
    }
  }

  return (
    <SettingsPage
      title="Import conversations"
      description="Bring your conversation history into Kairos from an exported archive."
    >
      <SettingsSection title="Export" description={format.description}>
        <div className="flex flex-col gap-4 p-4">
          <p className="text-pretty text-sm text-primary-600">
            Choose the original {format.label} {format.fileLabel} (up to 512
            MiB). The archive is uploaded only to your local Kairos server.
            Import makes no model calls. Images stay in the local database.
            Continuing a chat later sends its history to your selected provider.
          </p>
          {!local ? (
            <SettingsNotice tone="error">
              Open Kairos on localhost to import. Remote uploads are disabled.
            </SettingsNotice>
          ) : null}
          <div className="flex flex-col gap-1 text-sm text-primary-700">
            <label htmlFor="conversation-import-format">Export format</label>
            <Select
              id="conversation-import-format"
              value={source}
              options={formatOptions}
              disabled={phase !== 'idle'}
              onValueChange={function selectFormat(value) {
                setSource(value)
                setFile(null)
                setReport(null)
                setFinished(false)
                setError('')
              }}
            />
          </div>
          <input
            key={source}
            type="file"
            accept={format.accept}
            aria-label={`${format.label} ${format.fileLabel}`}
            disabled={!local || phase !== 'idle'}
            className="min-w-0 text-sm text-primary-700 file:mr-3 file:rounded-md file:border file:border-primary-200 file:bg-primary-100 file:px-3 file:py-2 file:text-primary-900"
            onChange={function selectArchive(event) {
              setFile(event.target.files?.[0] ?? null)
              setReport(null)
              setFinished(false)
              setError('')
            }}
          />
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={!local || !file || phase !== 'idle' || finished}
              onClick={function startImport() {
                void run()
              }}
            >
              Import
            </Button>
            {phase !== 'idle' ? (
              <Button
                variant="outline"
                onClick={function cancel() {
                  controller.current?.abort()
                }}
              >
                Cancel
              </Button>
            ) : null}
          </div>
          {phase !== 'idle' && progress ? (
            <ImportProgress progress={progress} />
          ) : null}
          {error ? <SettingsNotice tone="error">{error}</SettingsNotice> : null}
          {report ? (
            <div
              role="status"
              className="text-pretty text-sm tabular-nums text-primary-700"
            >
              <p>
                {finished
                  ? `Imported ${report.imported} conversations.`
                  : `Saved ${report.imported} conversations before stopping. Retry to import the rest.`}
              </p>
              <p>
                {report.duplicates} duplicates · {report.skippedImages} missing
                or unsupported images · {report.skippedAttachments} skipped
                attachment references · {report.skippedMessages} skipped
                messages · {report.alternateNodes} alternate nodes excluded.
              </p>
              <p>
                Limits: {format.limits} External Markdown images are blocked in
                imported messages.
              </p>
            </div>
          ) : null}
        </div>
      </SettingsSection>
    </SettingsPage>
  )
}

function ImportProgress({
  progress,
}: {
  progress: ConversationImportProgress
}) {
  const uploading = progress.stage === 'uploading'
  const value =
    progress.stage === 'uploading'
      ? progress.total > 0
        ? Math.round((progress.loaded / progress.total) * 100)
        : 0
      : progress.stage === 'importing'
        ? progress.total > 0
          ? Math.round((progress.imported / progress.total) * 100)
          : 100
        : undefined
  const label = uploading ? 'Upload progress' : 'Import progress'
  return (
    <div className="flex flex-col gap-2">
      <p
        role="status"
        className="text-pretty text-sm tabular-nums text-primary-700"
      >
        {progress.stage === 'uploading'
          ? `Uploading archive… ${value}%`
          : progress.stage === 'validating'
            ? 'Preparing import… Checking conversations.'
            : `Importing conversations… ${progress.imported} of ${progress.total} (${value}%)`}
      </p>
      <progress
        aria-label={label}
        max={100}
        value={value}
        className="h-2 w-full accent-primary-900"
      />
    </div>
  )
}
