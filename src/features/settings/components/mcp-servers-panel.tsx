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
      return mcpRequest(input.path, input.method, input.body)
    },
    onSuccess: async function refresh() {
      setFeedback('')
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
  return (
    <div className="space-y-5 p-4">
      <div>
        <h2 className="text-balance text-lg font-medium text-primary-900">
          MCP Servers
        </h2>
        <p className="text-pretty text-sm text-primary-600">
          Connect remote tools to your chats. Each call requires your approval
          of its exact arguments.
        </p>
      </div>
      {feedback && (
        <p role="alert" className="text-pretty text-sm text-primary-700">
          {feedback}
        </p>
      )}
      {servers.error && <p role="alert">{servers.error.message}</p>}
      <div className="space-y-3 rounded-xl border border-primary-200 bg-surface p-4">
        <h3 className="font-medium text-primary-900">
          {draft.id ? 'Edit server' : 'Add server'}
        </h3>
        {!draft.id && (
          <label className="block text-sm text-primary-700">
            Preset
            <select
              aria-label="MCP preset"
              className="ml-2 rounded border border-primary-200 bg-surface p-2"
              value={
                draft.endpoint === 'https://api.githubcopilot.com/mcp/readonly'
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
          </label>
        )}
        <label className="block text-sm text-primary-700">
          Name
          <Input
            aria-label="MCP server name"
            value={draft.name}
            onChange={function change(event) {
              update('name', event.target.value)
            }}
          />
        </label>
        <label className="block text-sm text-primary-700">
          HTTPS endpoint
          <Input
            aria-label="MCP endpoint"
            placeholder="https://example.com/mcp"
            value={draft.endpoint}
            onChange={function change(event) {
              update('endpoint', event.target.value)
            }}
          />
        </label>
        <label className="block text-sm text-primary-700">
          Authentication
          <select
            aria-label="MCP authentication"
            className="ml-2 rounded border border-primary-200 bg-surface p-2"
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
        </label>
        {draft.authMode === 'bearer' && (
          <label className="block text-sm text-primary-700">
            Token
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
          </label>
        )}
        <p className="text-pretty text-xs text-primary-600">
          For GitHub, create a{' '}
          <a
            className="underline"
            href="https://github.com/settings/personal-access-tokens"
            target="_blank"
            rel="noreferrer"
          >
            fine-grained personal access token
          </a>{' '}
          restricted to the repositories and permissions you need. Read-only
          contents access is sufficient for browsing. Organization approval or
          SSO authorization may also be required. Grant write permissions only
          for actions you intend to approve.
        </p>
        <div className="flex gap-2">
          <Button
            onClick={save}
            disabled={
              mutation.isPending || !draft.name.trim() || !draft.endpoint.trim()
            }
          >
            {draft.id ? 'Save changes' : 'Add server'}
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
      {servers.isLoading && <p role="status">Loading MCP servers…</p>}
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
  return (
    <section className="space-y-3 rounded-xl border border-primary-200 bg-surface p-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="truncate font-medium text-primary-900">{server.name}</h3>
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
      <p className="break-all text-xs text-primary-600">{server.endpoint}</p>
      <p className="text-xs text-primary-600">
        {server.health === 'connected'
          ? 'Connected'
          : server.health === 'error'
            ? 'Connection error'
            : 'Not tested'}{' '}
        · {server.authMode === 'bearer' ? 'Bearer token stored' : 'Anonymous'}
      </p>
      {server.lastError && (
        <p role="alert" className="text-pretty text-sm text-primary-700">
          {server.lastError}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
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
      {tools.error && <p role="alert">{tools.error.message}</p>}
      {tools.data && tools.data.length > 0 ? (
        <>
          <Input
            aria-label={`Filter ${server.name} tools`}
            placeholder="Filter tools"
            value={filter}
            onChange={function change(event) {
              setFilter(event.target.value)
            }}
          />
          <p className="text-xs text-primary-600">
            Tools start disabled. Enabled tools still require approval for every
            call.
          </p>
          <div className="max-h-96 space-y-3 overflow-y-auto">
            {tools.data
              .filter(function match(tool) {
                return `${tool.name} ${tool.description}`
                  .toLowerCase()
                  .includes(filter.toLowerCase())
              })
              .map(function toolRow(tool) {
                return (
                  <div
                    key={tool.id}
                    className="border-t border-primary-200 pt-3"
                  >
                    <label className="flex items-center justify-between gap-3 text-sm text-primary-800">
                      <span className="truncate">
                        {tool.name}
                        {!tool.available ? ' (unavailable)' : ''}
                      </span>
                      <Switch
                        aria-label={`Enable tool ${server.name} / ${tool.name}`}
                        checked={tool.enabled}
                        disabled={pending || (!tool.available && !tool.enabled)}
                        onCheckedChange={function change(enabled) {
                          onChange(
                            `servers/${server.id}/tools/${tool.id}`,
                            'PATCH',
                            { enabled, approvalPolicy: 'always' },
                          )
                        }}
                      />
                    </label>
                    <p className="text-pretty text-xs text-primary-600">
                      {tool.description}
                    </p>
                    <details className="mt-1 text-xs text-primary-600">
                      <summary>Input schema</summary>
                      <pre className="overflow-x-auto whitespace-pre-wrap">
                        {JSON.stringify(tool.schema, null, 2)}
                      </pre>
                    </details>
                  </div>
                )
              })}
          </div>
        </>
      ) : (
        <p className="text-pretty text-sm text-primary-600">
          Test the connection to discover tools.
        </p>
      )}
    </section>
  )
}
