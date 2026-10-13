import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { HugeiconsIcon } from '@hugeicons/react'
import { ArrowDown01Icon } from '@hugeicons/core-free-icons'
import { Switch } from '@/components/ui/switch'
import { mcpRequest } from '@/lib/mcp-api'
import type { MCPServer, MCPTool } from '@/lib/mcp-api'
import { cn } from '@/lib/utils'

type Change = { path: string; method: string; body?: unknown }

// Quick per-chat view of remote MCP tools: turn servers and tools on or off
// and choose which run without asking. Adding and editing servers lives in
// Settings.
export function MCPToolsPanel() {
  const client = useQueryClient()
  const servers = useQuery({
    queryKey: ['mcp', 'servers'],
    queryFn: async function loadServers() {
      return (await mcpRequest<{ servers: Array<MCPServer> }>('servers'))
        .servers
    },
  })
  const change = useMutation({
    mutationFn: function apply(input: Change) {
      return mcpRequest(input.path, input.method, input.body)
    },
    onSuccess: async function refresh() {
      await client.invalidateQueries({ queryKey: ['mcp'] })
    },
  })
  function apply(input: Change) {
    change.mutate(input)
  }

  return (
    <div className="pb-4">
      <section className="space-y-3 px-4 py-4">
        <div className="space-y-1">
          <h3 className="text-xs text-primary-500">MCP tools</h3>
          <p className="text-pretty text-xs text-primary-500">
            Tools ask before each call unless you allow them. Changes apply to
            all chats.
          </p>
        </div>
        {servers.error || change.error ? (
          <p role="alert" className="text-pretty text-sm text-primary-800">
            {(change.error ?? servers.error)?.message}
          </p>
        ) : null}
        {servers.isLoading ? (
          <p role="status" className="text-sm text-primary-500">
            Loading servers…
          </p>
        ) : null}
        {servers.data?.length === 0 ? (
          <div className="rounded-lg border border-dashed border-primary-300 px-3 py-4 text-center">
            <p className="text-pretty text-sm text-primary-700">
              No MCP servers connected.
            </p>
          </div>
        ) : null}
        <div className="space-y-2">
          {servers.data?.map((server) => (
            <ServerRow
              key={server.id}
              server={server}
              pending={change.isPending}
              onChange={apply}
            />
          ))}
        </div>
        <Link
          to="/settings"
          search={{ tab: 'mcp' }}
          className="inline-flex text-sm text-primary-700 underline-offset-4 hover:text-primary-950 hover:underline"
        >
          {servers.data?.length === 0 ? 'Add a server' : 'Manage servers'}
        </Link>
      </section>
    </div>
  )
}

function ServerRow({
  server,
  pending,
  onChange,
}: {
  server: MCPServer
  pending: boolean
  onChange: (input: Change) => void
}) {
  const [open, setOpen] = useState(false)
  const tools = useQuery({
    queryKey: ['mcp', 'tools', server.id],
    queryFn: async function loadTools() {
      return (
        await mcpRequest<{ tools: Array<MCPTool> }>(
          `servers/${server.id}/tools`,
        )
      ).tools
    },
  })
  const toolList = tools.data ?? []
  const enabledCount = toolList.filter((tool) => tool.enabled).length

  return (
    <div className="rounded-lg border border-primary-200 bg-surface">
      <div className="flex items-center gap-2 px-3 py-2.5">
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((current) => !current)}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          <span
            aria-hidden
            className={cn(
              'size-1.5 shrink-0 rounded-full',
              server.health === 'connected' && server.enabled
                ? 'bg-primary-700'
                : 'bg-primary-300',
            )}
          />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium text-primary-800">
              {server.name}
            </span>
            <span className="block truncate text-xs tabular-nums text-primary-500">
              {serverStatus(server, enabledCount, toolList.length)}
            </span>
          </span>
          <HugeiconsIcon
            icon={ArrowDown01Icon}
            size={14}
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
            onChange({
              path: `servers/${server.id}`,
              method: 'PATCH',
              body: {
                name: server.name,
                endpoint: server.endpoint,
                authMode: server.authMode,
                enabled,
              },
            })
          }
        />
      </div>
      {open ? (
        <ul className="border-t border-primary-200 px-3 py-1">
          {server.lastError ? (
            <li className="text-pretty py-2 text-xs text-primary-700">
              {server.lastError}
            </li>
          ) : null}
          {toolList.length === 0 ? (
            <li className="py-2 text-xs text-primary-500">
              {tools.isLoading ? 'Loading tools…' : 'No tools discovered.'}
            </li>
          ) : null}
          {toolList.map((tool) => (
            <ToolRow
              key={tool.id}
              server={server}
              tool={tool}
              pending={pending}
              onChange={onChange}
            />
          ))}
        </ul>
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
  onChange: (input: Change) => void
}) {
  const path = `servers/${server.id}/tools/${tool.id}`
  const usable = server.enabled && tool.enabled && tool.available
  const autoAllowed = tool.approvalPolicy === 'allow'
  return (
    <li className="flex items-center gap-2 py-2">
      <div className="min-w-0 flex-1">
        <div
          className={cn(
            'truncate font-mono text-xs text-primary-800',
            !usable && 'text-primary-400',
          )}
          title={tool.description || tool.name}
        >
          {tool.name}
        </div>
        {tool.available ? (
          <button
            type="button"
            disabled={pending || !usable}
            onClick={() =>
              onChange({
                path,
                method: 'PATCH',
                body: {
                  enabled: tool.enabled,
                  approvalPolicy: autoAllowed ? 'always' : 'allow',
                },
              })
            }
            className="-mx-1 rounded px-1 text-xs text-primary-500 transition-colors hover:bg-primary-100 hover:text-primary-800 disabled:pointer-events-none"
            aria-label={`${autoAllowed ? 'Ask before' : 'Always allow'} ${server.name} / ${tool.name}`}
          >
            {autoAllowed ? 'Always allowed' : 'Asks first'}
            {!autoAllowed && tool.chatApprovalCount
              ? ` · allowed in ${tool.chatApprovalCount} ${tool.chatApprovalCount === 1 ? 'chat' : 'chats'}`
              : ''}
          </button>
        ) : (
          <div className="text-xs text-primary-500">Unavailable</div>
        )}
      </div>
      <Switch
        aria-label={`Enable tool ${server.name} / ${tool.name}`}
        checked={tool.enabled}
        disabled={
          pending || !server.enabled || (!tool.available && !tool.enabled)
        }
        onCheckedChange={(enabled) =>
          onChange({
            path,
            method: 'PATCH',
            body: { enabled, approvalPolicy: tool.approvalPolicy },
          })
        }
      />
    </li>
  )
}

function serverStatus(server: MCPServer, enabled: number, total: number) {
  if (!server.enabled) return 'Off'
  if (server.health === 'error') return 'Connection error'
  if (server.health !== 'connected') return 'Not tested'
  return total > 0 ? `${enabled} of ${total} tools on` : 'Connected'
}
