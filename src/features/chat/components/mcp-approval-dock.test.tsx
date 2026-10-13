// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, expect, it, vi } from 'vitest'
import { MCPApprovalDock } from './mcp-approval-dock'
import { toolStepTitle } from './tool-step-item'
import { ChatComposer } from './chat-composer'
import type { MCPApproval } from '@/lib/mcp-api'

afterEach(function reset() {
  cleanup()
  vi.unstubAllGlobals()
})

function pendingApproval(overrides: Partial<MCPApproval> = {}): MCPApproval {
  return {
    id: 'approval',
    runId: 'run',
    serverId: 'server',
    serverName: 'GitHub',
    toolName: 'create_issue',
    arguments: { title: 'Exact title', repository: 'repo' },
    state: 'pending',
    expiresAt: Date.now() + 60000,
    progress: {},
    ...overrides,
  }
}

function renderWithClient(node: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  render(<QueryClientProvider client={client}>{node}</QueryClientProvider>)
  return client
}

function stubDecisions(response?: Response) {
  const writes: Array<{ path: string; body: unknown }> = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async function request(path: string, init?: RequestInit) {
      if (init?.method === 'POST') {
        writes.push({ path, body: JSON.parse(String(init.body)) })
        return response ?? Response.json({ ok: true })
      }
      return Response.json({ approvals: [] })
    }),
  )
  return writes
}

it('shows the exact arguments and approves a single call', async function () {
  const writes = stubDecisions()
  const client = renderWithClient(
    <MCPApprovalDock
      approvals={[pendingApproval(), pendingApproval({ id: 'next' })]}
    />,
  )
  expect(screen.getByRole('region', { name: 'Tool approval' })).toBeTruthy()
  expect(screen.getByText('create_issue')).toBeTruthy()
  expect(screen.getByText('Exact title')).toBeTruthy()
  expect(screen.getByText(/1 of 2/)).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Allow once' }))
  await vi.waitFor(() => expect(writes).toHaveLength(1))
  expect(writes[0]).toEqual({
    path: '/api/mcp/approvals/approval',
    body: { decision: 'approved' },
  })
  client.clear()
})

for (const choice of [
  {
    label: 'Allow in this chat',
    body: { decision: 'approved', scope: 'chat' },
  },
  { label: 'Always allow', body: { decision: 'approved', scope: 'tool' } },
  { label: 'Deny', body: { decision: 'denied' } },
]) {
  it(`sends "${choice.label}" as an explicit decision`, async function () {
    const writes = stubDecisions()
    const client = renderWithClient(
      <MCPApprovalDock approvals={[pendingApproval()]} />,
    )
    fireEvent.click(screen.getByRole('button', { name: choice.label }))
    await vi.waitFor(() => expect(writes).toHaveLength(1))
    expect(writes[0].body).toEqual(choice.body)
    client.clear()
  })
}

it('reports a decision the server rejects', async function () {
  stubDecisions(Response.json({ error: 'Approval expired' }, { status: 400 }))
  const client = renderWithClient(
    <MCPApprovalDock approvals={[pendingApproval()]} />,
  )
  fireEvent.click(screen.getByRole('button', { name: 'Deny' }))
  expect(await screen.findByRole('alert')).toHaveProperty(
    'textContent',
    'Approval expired',
  )
  client.clear()
})

it('replaces the prompt while an approval is pending', function () {
  stubDecisions()
  const client = renderWithClient(
    <ChatComposer
      onSubmit={() => {}}
      isLoading={false}
      disabled={false}
      approvals={[pendingApproval()]}
    />,
  )
  expect(screen.getByRole('region', { name: 'Tool approval' })).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'Send message' })).toBeNull()
  client.clear()
})

it('names remote tools by server and tool instead of their alias', function () {
  const step = {
    kind: 'tool' as const,
    key: 'tool-1',
    toolPart: {
      type: 'mcp_0123abcd',
      state: 'input-available' as const,
      displayName: 'GitHub · create_issue',
    },
  }
  expect(toolStepTitle(step)).toBe('Calling GitHub · create_issue')
  expect(
    toolStepTitle({
      ...step,
      toolPart: { ...step.toolPart, state: 'output-available' },
    }),
  ).toBe('Called GitHub · create_issue')
})
