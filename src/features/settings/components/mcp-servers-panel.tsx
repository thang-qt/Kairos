import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { mcpRequest } from '@/lib/mcp-api'
import type { MCPServer, MCPTool } from '@/lib/mcp-api'

type ServerDraft = {
  id?: string
  name: string
  endpoint: string
  authMode: 'none' | 'bearer'
  token: string
  enabled: boolean
}
const emptyDraft: ServerDraft = {
  name: '',
  endpoint: '',
  authMode: 'none',
  token: '',
  enabled: true,
}

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
  function update(field: keyof ServerDraft, value: string | boolean) {
    setDraft(function next(previous) {
      return { ...previous, [field]: value }
    })
  }
  function preset(value: string) {
    setDraft(
      value === 'custom'
        ? emptyDraft
        : {
            ...emptyDraft,
            name: 'GitHub',
            authMode: 'bearer',
            endpoint:
              value === 'github-readonly'
                ? 'https://api.githubcopilot.com/mcp/readonly'
                : 'https://api.githubcopilot.com/mcp/',
          },
    )
  }
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
        },
        onSettled: function clearSecretMutation() {
          mutation.reset()
        },
      },
    )
    setDraft(function clearSecret(previous) {
      return { ...previous, token: '' }
    })
  }
  function edit(server: MCPServer) {
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
  const formTitle = draft.id ? 'Edit server' : 'Add server'
  return (
    <main className="min-h-0 flex-1 overflow-y-auto px-4 pb-10 pt-2">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
        <section className="rounded-xl border border-primary-200 bg-surface p-5">
          <div className="mb-4 max-w-2xl">
            <h2 className="text-balance text-base font-medium text-primary-950">
              MCP servers
            </h2>
            <p className="mt-1 text-pretty text-sm text-primary-500">
              Connect remote tools. New servers are tested and their tools
              turned on automatically. Each call asks for approval unless you
              allow the tool for a chat or everywhere.
            </p>
          </div>
          {servers.error ? (
            <p role="alert" className="text-pretty text-sm text-primary-800">
              {servers.error.message}
            </p>
          ) : null}
          {servers.isLoading ? (
            <p role="status" className="text-sm text-primary-500">
              Loading MCP servers…
            </p>
          ) : null}
          {servers.data?.length === 0 ? (
            <p className="rounded-lg border border-dashed border-primary-300 px-4 py-6 text-center text-pretty text-sm text-primary-500">
              No servers yet. Add one below.
            </p>
          ) : null}
          <div className="flex flex-col gap-3">
            {servers.data?.map(function card(server) {
              return (
                <MCPServerCard
                  key={server.id}
                  server={server}
                  pending={mutation.isPending}
                  onEdit={edit}
                  onChange={function change(path, method, body) {
                    mutation.mutate({ path, method, body })
                  }}
                />
              )
            })}
          </div>
        </section>

        <section className="rounded-xl border border-primary-200 bg-surface p-5">
          <h3 className="mb-4 text-balance text-base font-medium text-primary-950">
            {formTitle}
          </h3>
          {feedback ? (
            <p
              role="alert"
              className="mb-4 rounded-lg border border-primary-200 bg-primary-50 px-3 py-2 text-pretty text-sm text-primary-800"
            >
              {feedback}
            </p>
          ) : null}
          <div className="flex max-w-2xl flex-col gap-4">
            {!draft.id && (
              <Field label="Preset">
                <select
                  aria-label="MCP preset"
                  className={SELECT_CLASS}
                  value={
                    draft.endpoint ===
                    'https://api.githubcopilot.com/mcp/readonly'
                      ? 'github-readonly'
                      : draft.endpoint === 'https://api.githubcopilot.com/mcp/'
                        ? 'github'
                        : 'custom'
                  }
                  onChange={function choose(event) {
                    preset(event.target.value)
                  }}
                >
                  <option value="custom">Custom server</option>
                  <option value="github-readonly">GitHub — read-only</option>
                  <option value="github">GitHub — all available tools</option>
                </select>
              </Field>
            )}
            <Field label="Name">
              <Input
                aria-label="MCP server name"
                value={draft.name}
                onChange={function change(event) {
                  update('name', event.target.value)
                }}
              />
            </Field>
            <Field label="HTTPS endpoint">
              <Input
                aria-label="MCP endpoint"
                placeholder="https://example.com/mcp"
                value={draft.endpoint}
                onChange={function change(event) {
                  update('endpoint', event.target.value)
                }}
              />
            </Field>
            <Field label="Authentication">
              <select
                aria-label="MCP authentication"
                className={SELECT_CLASS}
                value={draft.authMode}
                onChange={function change(event) {
                  setDraft(function next(previous) {
                    return {
                      ...previous,
                      authMode: event.target.value as 'none' | 'bearer',
                      token: '',
                    }
                  })
                }}
              >
                <option value="none">Anonymous</option>
                <option value="bearer">Bearer token</option>
              </select>
            </Field>
            {draft.authMode === 'bearer' && (
              <Field label="Token">
                <Input
                  aria-label="MCP token"
                  type="password"
                  autoComplete="new-password"
                  value={draft.token}
                  placeholder={
                    draft.id
                      ? 'Leave blank to keep the stored token'
                      : 'Personal access token or API key'
                  }
                  onChange={function change(event) {
                    update('token', event.target.value)
                  }}
                />
              </Field>
            )}
            <p className="text-pretty text-xs text-primary-500">
              For GitHub, create a{' '}
              <a
                className="underline underline-offset-2 hover:text-primary-800"
                href="https://github.com/settings/personal-access-tokens"
                target="_blank"
                rel="noreferrer"
              >
                fine-grained personal access token
              </a>{' '}
              limited to the repositories and permissions you need. Read-only
              contents access is enough for browsing. Your organization may also
              require approval or SSO authorization. Grant write access only for
              actions you plan to approve.
            </p>
            <div className="flex gap-2">
              <Button
                onClick={save}
                disabled={
                  mutation.isPending ||
                  !draft.name.trim() ||
                  !draft.endpoint.trim()
                }
              >
                {mutation.isPending
                  ? 'Saving and testing…'
                  : draft.id
                    ? 'Save changes'
                    : 'Add server'}
              </Button>
              {draft.id && (
                <Button
                  variant="ghost"
                  onClick={function cancel() {
                    setDraft(emptyDraft)
                  }}
                >
                  Cancel edit
                </Button>
              )}
            </div>
          </div>
        </section>
      </div>
    </main>
  )
}

const SELECT_CLASS =
  'h-9 rounded-md border border-primary-200 bg-surface px-3 text-sm text-primary-900'

function Field({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <label className="flex flex-col gap-1.5 text-sm text-primary-900">
      {label}
      {children}
    </label>
  )
}

function MCPServerCard({
  server,
  pending,
  onEdit,
  onChange,
}: {
  server: MCPServer
  pending: boolean
  onEdit: (server: MCPServer) => void
  onChange: (path: string, method: string, body?: unknown) => void
}) {
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
  const [filter, setFilter] = useState('')
  const health =
    server.health === 'connected'
      ? 'Connected'
      : server.health === 'error'
        ? 'Connection error'
        : 'Not tested'
  return (
    <section className="rounded-lg border border-primary-200 bg-primary-50/60 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-medium text-primary-900">
            {server.name}
          </h3>
          <p className="truncate text-xs text-primary-500">
            {health} ·{' '}
            {server.authMode === 'bearer' ? 'Bearer token stored' : 'Anonymous'}
          </p>
          <p className="break-all font-mono text-xs text-primary-500">
            {server.endpoint}
          </p>
        </div>
        <Switch
          aria-label={`Enable server ${server.name}`}
          checked={server.enabled}
          disabled={pending}
          onCheckedChange={function change(enabled) {
            onChange(`servers/${server.id}`, 'PATCH', {
              name: server.name,
              endpoint: server.endpoint,
              authMode: server.authMode,
              enabled,
            })
          }}
        />
      </div>
      {server.lastError && (
        <p
          role="alert"
          className="mt-3 rounded-md bg-surface px-3 py-2 text-pretty text-sm text-primary-800 ring-1 ring-primary-200"
        >
          {server.lastError}
        </p>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={pending || !server.enabled}
          onClick={function test() {
            onChange(`servers/${server.id}/test`, 'POST', {})
          }}
        >
          Test connection
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={pending || !server.enabled}
          onClick={function refresh() {
            onChange(`servers/${server.id}/refresh-tools`, 'POST', {})
          }}
        >
          Refresh tools
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={function edit() {
            onEdit(server)
          }}
        >
          Edit
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={pending}
          onClick={function remove() {
            onChange(`servers/${server.id}`, 'DELETE')
          }}
        >
          Delete
        </Button>
      </div>
      {tools.error && (
        <p role="alert" className="mt-3 text-sm text-primary-800">
          {tools.error.message}
        </p>
      )}
      {tools.data && tools.data.length > 0 ? (
        <div className="mt-4 border-t border-primary-200 pt-4">
          <div className="mb-2 flex items-center justify-between gap-3">
            <h4 className="text-xs text-primary-500">
              Tools ·{' '}
              <span className="tabular-nums">
                {tools.data.filter((tool) => tool.enabled).length} of{' '}
                {tools.data.length} on
              </span>
            </h4>
          </div>
          <Input
            aria-label={`Filter ${server.name} tools`}
            placeholder="Filter tools"
            value={filter}
            onChange={function change(event) {
              setFilter(event.target.value)
            }}
          />
          <ul className="mt-2 max-h-96 divide-y divide-primary-200 overflow-y-auto">
            {tools.data
              .filter(function match(tool) {
                return `${tool.name} ${tool.description}`
                  .toLowerCase()
                  .includes(filter.toLowerCase())
              })
              .map(function toolRow(tool) {
                return (
                  <li key={tool.id} className="py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate font-mono text-sm text-primary-900">
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
                        aria-label={`Enable tool ${server.name} / ${tool.name}`}
                        checked={tool.enabled}
                        disabled={pending || (!tool.available && !tool.enabled)}
                        onCheckedChange={function change(enabled) {
                          onChange(
                            `servers/${server.id}/tools/${tool.id}`,
                            'PATCH',
                            { enabled, approvalPolicy: tool.approvalPolicy },
                          )
                        }}
                      />
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <select
                        aria-label={`Approval for ${server.name} / ${tool.name}`}
                        className="h-8 rounded-md border border-primary-200 bg-surface px-2 text-xs text-primary-900"
                        value={tool.approvalPolicy}
                        disabled={pending || !tool.enabled || !tool.available}
                        onChange={function policy(event) {
                          onChange(
                            `servers/${server.id}/tools/${tool.id}`,
                            'PATCH',
                            {
                              enabled: tool.enabled,
                              approvalPolicy: event.target.value,
                            },
                          )
                        }}
                      >
                        <option value="always">Ask for each call</option>
                        <option value="allow">Always approve this tool</option>
                      </select>
                      {(tool.approvalPolicy === 'allow' ||
                        (tool.chatApprovalCount ?? 0) > 0) && (
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={pending}
                          onClick={function resetApprovals() {
                            onChange(
                              `servers/${server.id}/tools/${tool.id}`,
                              'PATCH',
                              {
                                enabled: tool.enabled,
                                approvalPolicy: 'always',
                              },
                            )
                          }}
                        >
                          Reset approvals
                          {tool.chatApprovalCount
                            ? ` (${tool.chatApprovalCount} chats)`
                            : ''}
                        </Button>
                      )}
                      <details className="w-full text-xs text-primary-500">
                        <summary className="cursor-pointer hover:text-primary-800">
                          Input schema
                        </summary>
                        <pre className="mt-1 overflow-x-auto whitespace-pre-wrap rounded-md bg-surface p-2 font-mono text-primary-800 ring-1 ring-primary-200">
                          {JSON.stringify(tool.schema, null, 2)}
                        </pre>
                      </details>
                    </div>
                  </li>
                )
              })}
          </ul>
        </div>
      ) : (
        <p className="mt-3 text-pretty text-sm text-primary-500">
          Test the connection to discover tools.
        </p>
      )}
    </section>
  )
}
