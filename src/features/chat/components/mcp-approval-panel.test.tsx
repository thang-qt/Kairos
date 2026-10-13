// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, expect, it, vi } from 'vitest'
import { MCPApprovalPanel } from './mcp-approval-panel'
import type { MCPApproval } from '@/lib/mcp-api'

afterEach(function reset() {
  cleanup()
  vi.unstubAllGlobals()
})

it('shows exact arguments and submits a scoped approval instead of changing arguments', async function () {
  const approval: MCPApproval = {
    id: 'approval',
    runId: 'run',
    serverId: 'server',
    serverName: 'GitHub',
    toolName: 'create_issue',
    arguments: { title: 'Exact title', repository: 'repo' },
    state: 'pending',
    expiresAt: Date.now() + 60000,
    progress: {},
  }
  const requests: Array<{ path: string; body: unknown }> = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async function request(path: string, init?: RequestInit) {
      if (init?.method === 'POST') {
        requests.push({ path, body: JSON.parse(String(init.body)) })
        approval.state = 'approved'
        return Response.json({ ok: true })
      }
      return Response.json({
        approvals: [
          approval,
          {
            ...approval,
            id: 'other',
            runId: 'different-run',
            toolName: 'hidden_tool',
          },
        ],
      })
    }),
  )
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  render(
    <QueryClientProvider client={client}>
      <MCPApprovalPanel runId="run" active />
    </QueryClientProvider>,
  )
  await screen.findByRole('button', { name: 'Approve call' })
  expect(screen.getByText('GitHub / create_issue')).toBeTruthy()
  expect(screen.getByText(/Exact title/)).toBeTruthy()
  expect(screen.queryByText(/hidden_tool/)).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Approve call' }))
  await screen.findByText(/Approved; connecting/)
  expect(requests).toEqual([
    { path: '/api/mcp/approvals/approval', body: { decision: 'approved' } },
  ])
  client.clear()
})

it('allows denial and reports expired or revoked approvals', async function () {
  vi.stubGlobal(
    'fetch',
    vi.fn(async function request(_path: string, init?: RequestInit) {
      return init?.method === 'POST'
        ? Response.json({ error: 'Approval expired' }, { status: 400 })
        : Response.json({
            approvals: [
              {
                id: 'a',
                runId: 'run',
                serverName: 'Server',
                toolName: 'write',
                arguments: { value: 1 },
                state: 'pending',
                progress: {},
              },
            ],
          })
    }),
  )
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  render(
    <QueryClientProvider client={client}>
      <MCPApprovalPanel runId="run" active />
    </QueryClientProvider>,
  )
  fireEvent.click(await screen.findByRole('button', { name: 'Deny call' }))
  expect(await screen.findByRole('alert')).toHaveProperty(
    'textContent',
    'Approval expired',
  )
  client.clear()
})

for (const choice of [
  { label: 'Approve for this chat', scope: 'chat' },
  { label: 'Always approve this tool', scope: 'tool' },
]) {
  it(`sends explicit ${choice.scope} authorization from the matching button`, async function () {
    const writes: Array<unknown> = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async function request(_path: string, init?: RequestInit) {
        if (init?.method === 'POST') {
          writes.push(JSON.parse(String(init.body)))
          return Response.json({ ok: true })
        }
        return Response.json({
          approvals: [
            {
              id: 'approval',
              runId: 'run',
              serverName: 'GitHub',
              toolName: 'write',
              arguments: { title: 'Exact' },
              state: 'pending',
              progress: {},
            },
          ],
        })
      }),
    )
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    render(
      <QueryClientProvider client={client}>
        <MCPApprovalPanel runId="run" active />
      </QueryClientProvider>,
    )
    fireEvent.click(await screen.findByRole('button', { name: choice.label }))
    await screen.findByText(/future calls to this tool/)
    expect(writes).toEqual([{ decision: 'approved', scope: choice.scope }])
    client.clear()
  })
}
