import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { HugeiconsIcon } from '@hugeicons/react'
import { Add01Icon, ArrowDown01Icon } from '@hugeicons/core-free-icons'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { mcpRequest } from '@/lib/mcp-api'
import type { MCPServer, MCPTool } from '@/lib/mcp-api'
import { cn } from '@/lib/utils'
import {
  ConfirmButton,
  SegmentedControl,
  SettingsEmpty,
  SettingsField,
  SettingsNotice,
  SettingsPage,
  SettingsSection,
  StatusDot,
} from './settings-layout'

type ServerDraft = {
  id?: string
  name: string
  endpoint: string
  authMode: 'none' | 'bearer'
  token: string
  enabled: boolean
}

type Change = (path: string, method: string, body?: unknown) => void

const emptyDraft: ServerDraft = {
  name: '',
  endpoint: '',
  authMode: 'none',
  token: '',
  enabled: true,
}

const GITHUB_READONLY = 'https://api.githubcopilot.com/mcp/readonly'
const GITHUB_FULL = 'https://api.githubcopilot.com/mcp/'

const PRESET_OPTIONS = [
  { value: 'custom', label: 'Custom server' },
  { value: 'github-readonly', label: 'GitHub — read-only' },
  { value: 'github', label: 'GitHub — all tools' },
] as const

const AUTH_OPTIONS = [
  { value: 'none', label: 'Anonymous' },
  { value: 'bearer', label: 'Bearer token' },
] as const

const APPROVAL_OPTIONS = [
  { value: 'always', label: 'Ask first' },
  { value: 'allow', label: 'Always allow' },
] as const

export function MCPServersPanel() {
  const client = useQueryClient()
  const servers = useQuery({
    queryKey: ['mcp', 'servers'],
    queryFn: async function load() {
      return (await mcpRequest<{ servers: Array<MCPServer> }>('servers'))
        .servers
    },
  })
  const [draft, setDraft] = useState<ServerDraft>(emptyDraft)
  const [adding, setAdding] = useState(false)
  const [feedback, setFeedback] = useState('')
  const mutation = useMutation({
    meta: { persist: false },
    gcTime: 60000,
    networkMode: 'always',
    mutationFn: async function change(input: {
      path: string
      method: string
      body?: unknown
    }) {
      return mcpRequest<{ discoveryError?: string }>(
        input.path,
        input.method,
        input.body,
      )
    },
    onSuccess: async function refresh(result) {
      setFeedback(
        result.discoveryError ? `Server saved. ${result.discoveryError}` : '',
      )
      await client.invalidateQueries({ queryKey: ['mcp'] })
    },
    onError: function failed(error) {
      setFeedback(error.message)
    },
  })
  const noServers = servers.data?.length === 0
  const showAddForm = !draft.id && (adding || noServers)

  function save() {
    mutation.mutate(
      {
        path: draft.id ? `servers/${draft.id}` : 'servers',
        method: draft.id ? 'PATCH' : 'POST',
        body: {
          name: draft.name,
          endpoint: draft.endpoint,
          authMode: draft.authMode,
          token: draft.token,
          enabled: draft.enabled,
        },
      },
      {
        onSuccess: function saved() {
          setDraft(emptyDraft)
          setAdding(false)
        },
        onSettled: function clearSecretMutation() {
          mutation.reset()
        },
      },
    )
    // Never keep a typed secret around after it is sent.
    setDraft((previous) => ({ ...previous, token: '' }))
  }
  function cancel() {
    setDraft(emptyDraft)
    setAdding(false)
  }
  function edit(server: MCPServer) {
    setAdding(false)
    setDraft({
      id: server.id,
      name: server.name,
      endpoint: server.endpoint,
      authMode: server.authMode,
      token: '',
      enabled: server.enabled,
    })
    setFeedback('')
  }
  function change(path: string, method: string, body?: unknown) {
    mutation.mutate({ path, method, body })
  }

  const form = (
    <ServerForm
      draft={draft}
      pending={mutation.isPending}
      canCancel={!noServers || Boolean(draft.id)}
      onChange={setDraft}
      onSubmit={save}
      onCancel={cancel}
    />
  )

  return (
    <SettingsPage
      title="MCP servers"
      description="Connect remote tools over MCP. New servers are tested and their tools turned on. Each call asks for your approval unless you allow the tool."
      actions={
        !showAddForm && !draft.id ? (
          <Button size="sm" onClick={() => setAdding(true)}>
            <HugeiconsIcon icon={Add01Icon} size={16} strokeWidth={1.5} />
            Add server
          </Button>
        ) : null
      }
    >
      {feedback ? (
        <SettingsNotice tone="error">{feedback}</SettingsNotice>
      ) : null}
      {servers.error ? (
        <SettingsNotice tone="error">{servers.error.message}</SettingsNotice>
      ) : null}

      {showAddForm ? (
        <SettingsSection title="New server">{form}</SettingsSection>
      ) : null}

      {noServers ? null : (
        <SettingsSection title="Servers">
          {servers.isLoading ? (
            <SettingsEmpty>Loading MCP servers…</SettingsEmpty>
          ) : (
            servers.data?.map((server) =>
              draft.id === server.id ? (
                <div key={server.id}>{form}</div>
              ) : (
                <ServerRow
                  key={server.id}
                  server={server}
                  defaultOpen={servers.data?.length === 1}
                  pending={mutation.isPending}
                  onEdit={edit}
                  onChange={change}
                />
              ),
            )
          )}
        </SettingsSection>
      )}
    </SettingsPage>
  )
}

function ServerForm({
  draft,
  pending,
  canCancel,
  onChange,
  onSubmit,
  onCancel,
}: {
  draft: ServerDraft
  pending: boolean
  canCancel: boolean
  onChange: (update: (previous: ServerDraft) => ServerDraft) => void
  onSubmit: () => void
  onCancel: () => void
}) {
  function update(field: keyof ServerDraft, value: string | boolean) {
    onChange((previous) => ({ ...previous, [field]: value }))
  }
  const presetValue =
    draft.endpoint === GITHUB_READONLY
      ? 'github-readonly'
      : draft.endpoint === GITHUB_FULL
        ? 'github'
        : 'custom'
  const isGitHub = draft.endpoint.includes('githubcopilot.com')

  return (
    <form
      className="flex flex-col gap-4 bg-primary-50/60 p-4"
      onSubmit={(event) => {
        event.preventDefault()
        onSubmit()
      }}
    >
      {!draft.id ? (
        <SettingsField label="Start from">
          <div>
            <Select
              label="MCP preset"
              className="w-full sm:w-64"
              value={presetValue}
              options={PRESET_OPTIONS}
              onValueChange={(value) =>
                onChange(() =>
                  value === 'custom'
                    ? emptyDraft
                    : {
                        ...emptyDraft,
                        name: 'GitHub',
                        authMode: 'bearer',
                        endpoint:
                          value === 'github-readonly'
                            ? GITHUB_READONLY
                            : GITHUB_FULL,
                      },
                )
              }
            />
          </div>
        </SettingsField>
      ) : null}
      <div className="grid gap-4 sm:grid-cols-[12rem_minmax(0,1fr)]">
        <SettingsField label="Name" htmlFor="mcp-name">
          <Input
            id="mcp-name"
            nativeInput
            aria-label="MCP server name"
            value={draft.name}
            onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
              update('name', event.target.value)
            }
          />
        </SettingsField>
        <SettingsField label="HTTPS endpoint" htmlFor="mcp-endpoint">
          <Input
            id="mcp-endpoint"
            nativeInput
            aria-label="MCP endpoint"
            className="font-mono"
            placeholder="https://example.com/mcp"
            value={draft.endpoint}
            onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
              update('endpoint', event.target.value)
            }
          />
        </SettingsField>
      </div>
      <SettingsField label="Authentication">
        <div>
          <SegmentedControl
            label="MCP authentication"
            value={draft.authMode}
            options={AUTH_OPTIONS}
            onChange={(authMode) =>
              onChange((previous) => ({ ...previous, authMode, token: '' }))
            }
          />
        </div>
      </SettingsField>
      {draft.authMode === 'bearer' ? (
        <SettingsField
          label="Token"
          htmlFor="mcp-token"
          hint={
            isGitHub ? (
              <>
                Create a{' '}
                <a
                  className="underline underline-offset-2 hover:text-primary-800"
                  href="https://github.com/settings/personal-access-tokens"
                  target="_blank"
                  rel="noreferrer"
                >
                  fine-grained personal access token
                </a>{' '}
                limited to the repositories you need. Read-only contents access
                is enough for browsing; grant write access only for actions you
                plan to approve.
              </>
            ) : draft.id ? (
              'Leave blank to keep the saved token.'
            ) : undefined
          }
        >
          <Input
            id="mcp-token"
            nativeInput
            aria-label="MCP token"
            type="password"
            autoComplete="new-password"
            value={draft.token}
            placeholder={
              draft.id
                ? 'Leave blank to keep the saved token'
                : 'Token or API key'
            }
            onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
              update('token', event.target.value)
            }
          />
        </SettingsField>
      ) : null}
      <div className="flex justify-end gap-2">
        {canCancel ? (
          <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        ) : null}
        <Button
          type="submit"
          size="sm"
          disabled={pending || !draft.name.trim() || !draft.endpoint.trim()}
        >
          {pending
            ? 'Saving and testing…'
            : draft.id
              ? 'Save changes'
              : 'Add server'}
        </Button>
      </div>
    </form>
  )
}

function ServerRow({
  server,
  defaultOpen,
  pending,
  onEdit,
  onChange,
}: {
  server: MCPServer
  defaultOpen: boolean
  pending: boolean
  onEdit: (server: MCPServer) => void
  onChange: Change
}) {
  const [open, setOpen] = useState(defaultOpen)
  const [filter, setFilter] = useState('')
  const tools = useQuery({
    queryKey: ['mcp', 'tools', server.id],
    queryFn: async function load() {
      return (
        await mcpRequest<{ tools: Array<MCPTool> }>(
          `servers/${server.id}/tools`,
        )
      ).tools
    },
  })
  const toolList = tools.data ?? []
  const enabledCount = toolList.filter((tool) => tool.enabled).length
  const visibleTools = toolList.filter((tool) =>
    `${tool.name} ${tool.description}`
      .toLowerCase()
      .includes(filter.toLowerCase()),
  )

  return (
    <div>
      <div className="flex items-center gap-3 px-4 py-3">
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((current) => !current)}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          <StatusDot active={server.enabled && server.health === 'connected'} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm text-primary-900">
              {server.name}
            </span>
            <span className="block truncate text-xs tabular-nums text-primary-500">
              {serverStatus(server, enabledCount, toolList.length)}
            </span>
          </span>
          <HugeiconsIcon
            icon={ArrowDown01Icon}
            size={16}
            strokeWidth={1.5}
            className={cn(
              'shrink-0 text-primary-500 transition-transform duration-150',
              open && 'rotate-180',
            )}
          />
        </button>
        <Switch
          aria-label={`Enable server ${server.name}`}
          checked={server.enabled}
          disabled={pending}
          onCheckedChange={(enabled) =>
            onChange(`servers/${server.id}`, 'PATCH', {
              name: server.name,
              endpoint: server.endpoint,
              authMode: server.authMode,
              enabled,
            })
          }
        />
      </div>

      {open ? (
        <div className="flex flex-col gap-3 border-t border-primary-200 bg-primary-50/60 px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="min-w-0 truncate font-mono text-xs text-primary-500">
              {server.endpoint}
            </span>
            <div className="flex flex-wrap items-center gap-1">
              <Button
                size="sm"
                variant="ghost"
                disabled={pending || !server.enabled}
                onClick={() =>
                  onChange(`servers/${server.id}/test`, 'POST', {})
                }
              >
                Test connection
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={pending || !server.enabled}
                onClick={() =>
                  onChange(`servers/${server.id}/refresh-tools`, 'POST', {})
                }
              >
                Refresh tools
              </Button>
              <Button size="sm" variant="ghost" onClick={() => onEdit(server)}>
                Edit
              </Button>
              <ConfirmButton
                label="Delete"
                confirmLabel="Delete server"
                pending={pending}
                onConfirm={() => onChange(`servers/${server.id}`, 'DELETE')}
              />
            </div>
          </div>
          {server.lastError ? (
            <SettingsNotice tone="error">{server.lastError}</SettingsNotice>
          ) : null}
          {tools.error ? (
            <SettingsNotice tone="error">{tools.error.message}</SettingsNotice>
          ) : null}
          {toolList.length === 0 ? (
            <p className="text-pretty text-sm text-primary-500">
              {tools.isLoading
                ? 'Loading tools…'
                : 'No tools yet. Test the connection to discover them.'}
            </p>
          ) : (
            <>
              {toolList.length > 6 ? (
                <Input
                  nativeInput
                  aria-label={`Filter ${server.name} tools`}
                  placeholder="Filter tools"
                  value={filter}
                  onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
                    setFilter(event.target.value)
                  }
                />
              ) : null}
              <ul className="divide-y divide-primary-200 overflow-hidden rounded-lg border border-primary-200 bg-surface">
                {visibleTools.map((tool) => (
                  <ToolRow
                    key={tool.id}
                    server={server}
                    tool={tool}
                    pending={pending}
                    onChange={onChange}
                  />
                ))}
              </ul>
            </>
          )}
        </div>
      ) : null}
    </div>
  )
}

function ToolRow({
  server,
  tool,
  pending,
  onChange,
}: {
  server: MCPServer
  tool: MCPTool
  pending: boolean
  onChange: Change
}) {
  const path = `servers/${server.id}/tools/${tool.id}`
  const name = `${server.name} / ${tool.name}`
  const chatGrants = tool.chatApprovalCount ?? 0
  return (
    <li className="flex flex-col gap-2 px-3 py-2.5">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div
            className={cn(
              'truncate font-mono text-sm text-primary-900',
              (!tool.enabled || !tool.available) && 'text-primary-400',
            )}
          >
            {tool.name}
            {!tool.available ? (
              <span className="ml-2 font-sans text-xs text-primary-500">
                Unavailable
              </span>
            ) : null}
          </div>
          {tool.description ? (
            <p className="mt-0.5 line-clamp-2 text-pretty text-xs text-primary-500">
              {tool.description}
            </p>
          ) : null}
        </div>
        <Switch
          aria-label={`Enable tool ${name}`}
          checked={tool.enabled}
          disabled={pending || (!tool.available && !tool.enabled)}
          onCheckedChange={(enabled) =>
            onChange(path, 'PATCH', {
              enabled,
              approvalPolicy: tool.approvalPolicy,
            })
          }
        />
      </div>
      {tool.enabled && tool.available ? (
        <div className="flex flex-wrap items-center gap-2">
          <SegmentedControl
            label={`Approval for ${name}`}
            value={tool.approvalPolicy}
            options={APPROVAL_OPTIONS}
            disabled={pending}
            onChange={(approvalPolicy) =>
              onChange(path, 'PATCH', { enabled: true, approvalPolicy })
            }
          />
          {tool.approvalPolicy === 'always' && chatGrants > 0 ? (
            <>
              <span className="text-xs tabular-nums text-primary-500">
                Allowed in {chatGrants} {chatGrants === 1 ? 'chat' : 'chats'}
              </span>
              <Button
                size="sm"
                variant="ghost"
                disabled={pending}
                onClick={() =>
                  onChange(path, 'PATCH', {
                    enabled: true,
                    approvalPolicy: 'always',
                  })
                }
              >
                Reset approvals
              </Button>
            </>
          ) : null}
        </div>
      ) : null}
    </li>
  )
}

function serverStatus(server: MCPServer, enabled: number, total: number) {
  const auth = server.authMode === 'bearer' ? 'Token saved' : 'Anonymous'
  if (!server.enabled) return `Off · ${auth}`
  if (server.health === 'error') return `Connection error · ${auth}`
  if (server.health !== 'connected') return `Not tested · ${auth}`
  return total > 0
    ? `Connected · ${enabled} of ${total} tools on · ${auth}`
    : `Connected · ${auth}`
}
