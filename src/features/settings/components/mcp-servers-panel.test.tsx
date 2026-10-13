// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, expect, it, vi } from 'vitest'
import { MCPServersPanel } from './mcp-servers-panel'
import type { MCPServer, MCPTool } from '@/lib/mcp-api'

afterEach(function reset() {
  cleanup()
  vi.unstubAllGlobals()
})

it('automatically discovers and enables new tools, supports policy changes, disabling, credential replacement and deletion', async function () {
  let servers: Array<MCPServer> = []
  const tool: MCPTool = {
    id: 'tool',
    serverId: 'server',
    name: 'get_file',
    alias: 'mcp_alias',
    description: 'Read a file',
    schema: { type: 'object' },
    enabled: true,
    available: true,
    approvalPolicy: 'always',
  }
  const writes: Array<{
    path: string
    method: string
    body: Record<string, unknown>
  }> = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async function request(path: string, init?: RequestInit) {
      const method = init?.method ?? 'GET'
      const body = init?.body ? JSON.parse(String(init.body)) : {}
      if (method !== 'GET') writes.push({ path, method, body })
      if (path === '/api/mcp/servers' && method === 'POST') {
        servers = [
          {
            id: 'server',
            name: body.name,
            endpoint: body.endpoint,
            authMode: body.authMode,
            enabled: true,
            hasToken: true,
            revision: 1,
            health: 'connected',
            lastError: '',
            discoveredAt: 0,
          },
        ]
        return Response.json({ server: servers[0] })
      }
      if (path === '/api/mcp/servers/server/test') {
        servers[0].health = 'connected'
        return Response.json({ tools: [tool] })
      }
      if (path === '/api/mcp/servers/server/tools/tool') {
        tool.enabled = body.enabled
        tool.approvalPolicy = body.approvalPolicy
        return Response.json({ ok: true })
      }
      if (path === '/api/mcp/servers/server' && method === 'PATCH') {
        servers[0] = { ...servers[0], name: body.name, revision: 2 }
        return Response.json({ server: servers[0] })
      }
      if (path === '/api/mcp/servers/server' && method === 'DELETE') {
        servers = []
        return Response.json({ ok: true })
      }
      if (path.endsWith('/tools'))
        return Response.json({
          tools: servers[0]?.health === 'connected' ? [tool] : [],
        })
      return Response.json({ servers })
    }),
  )
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  render(
    <QueryClientProvider client={client}>
      <MCPServersPanel />
    </QueryClientProvider>,
  )
  fireEvent.change(screen.getByLabelText('MCP preset'), {
    target: { value: 'github-readonly' },
  })
  expect(
    (screen.getByLabelText('MCP endpoint') as HTMLInputElement).value,
  ).toBe('https://api.githubcopilot.com/mcp/readonly')
  fireEvent.change(screen.getByLabelText('MCP token'), {
    target: { value: 'fixture-pat' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Add server' }))
  await screen.findByRole('button', { name: 'Test connection' })
  expect(writes[0].body.token).toBe('fixture-pat')
  expect(screen.queryByDisplayValue('fixture-pat')).toBeNull()
  const toggle = await screen.findByRole('switch', {
    name: 'Enable tool GitHub / get_file',
  })
  expect(toggle.getAttribute('aria-checked')).toBe('true')
  fireEvent.change(screen.getByLabelText('Approval for GitHub / get_file'), {
    target: { value: 'allow' },
  })
  await waitFor(function allowed() {
    expect(tool.approvalPolicy).toBe('allow')
  })
  await screen.findByRole('button', { name: 'Reset approvals' })
  fireEvent.click(screen.getByRole('button', { name: 'Reset approvals' }))
  await waitFor(function reset() {
    expect(tool.approvalPolicy).toBe('always')
  })
  fireEvent.click(toggle)
  await waitFor(function disabled() {
    expect(toggle.getAttribute('aria-checked')).toBe('false')
  })
  expect(
    writes.some(function approvedPolicy(write) {
      return write.body.approvalPolicy === 'always'
    }),
  ).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
  expect((screen.getByLabelText('MCP token') as HTMLInputElement).value).toBe(
    '',
  )
  fireEvent.change(screen.getByLabelText('MCP server name'), {
    target: { value: 'My GitHub' },
  })
  fireEvent.change(screen.getByLabelText('MCP token'), {
    target: { value: 'replacement-pat' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))
  await screen.findByRole('heading', { name: 'My GitHub' })
  expect(
    writes.some(function replaced(write) {
      return write.method === 'PATCH' && write.body.token === 'replacement-pat'
    }),
  ).toBe(true)
  expect(screen.queryByDisplayValue('replacement-pat')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
  await waitFor(function removed() {
    expect(screen.queryByRole('button', { name: 'Test connection' })).toBeNull()
  })
  client.clear()
})

it('supports anonymous custom servers and displays safe connection errors', async function () {
  vi.stubGlobal(
    'fetch',
    vi.fn(async function request(_path: string, init?: RequestInit) {
      return init?.method === 'POST'
        ? Response.json({ error: 'MCP endpoint is blocked' }, { status: 400 })
        : Response.json({ servers: [] })
    }),
  )
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  render(
    <QueryClientProvider client={client}>
      <MCPServersPanel />
    </QueryClientProvider>,
  )
  expect(screen.queryByLabelText('MCP token')).toBeNull()
  fireEvent.change(screen.getByLabelText('MCP server name'), {
    target: { value: 'Public' },
  })
  fireEvent.change(screen.getByLabelText('MCP endpoint'), {
    target: { value: 'https://example.com/mcp' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Add server' }))
  expect(await screen.findByRole('alert')).toHaveProperty(
    'textContent',
    'MCP endpoint is blocked',
  )
  client.clear()
})
