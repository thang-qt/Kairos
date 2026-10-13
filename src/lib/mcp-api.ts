export type MCPServer = {
  id: string
  name: string
  endpoint: string
  authMode: 'none' | 'bearer'
  enabled: boolean
  hasToken: boolean
  revision: number
  health: string
  lastError: string
  discoveredAt: number
}
export type MCPTool = {
  id: string
  serverId: string
  name: string
  alias: string
  description: string
  schema: Record<string, unknown>
  enabled: boolean
  available: boolean
  approvalPolicy: 'always' | 'allow'
  chatApprovalCount?: number
}
export type MCPApproval = {
  id: string
  runId: string
  serverId: string
  serverName: string
  toolName: string
  arguments: Record<string, unknown>
  state: 'pending' | 'approved' | 'executing'
  expiresAt: number
  progress: { message?: string; progress?: number; total?: number }
}
export async function mcpRequest<T>(
  path: string,
  method = 'GET',
  body?: unknown,
): Promise<T> {
  const response = await fetch(`/api/mcp/${path}`, {
    method,
    credentials: 'include',
    headers:
      body === undefined ? undefined : { 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  const data = await response.json()
  if (!response.ok) throw new Error(data.error ?? 'MCP request failed.')
  return data as T
}
