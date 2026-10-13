import { useQuery } from '@tanstack/react-query'
import { mcpRequest } from '@/lib/mcp-api'
import type { MCPApproval, MCPServer, MCPTool } from '@/lib/mcp-api'

const EMPTY_LABELS: ReadonlyMap<string, string> = new Map()

// Remote tools reach the model under hashed aliases (`mcp_…`). Map each alias
// to "Server · tool" so running steps read well before their result arrives.
export function useMcpToolLabels(): ReadonlyMap<string, string> {
  const query = useQuery({
    queryKey: ['mcp', 'tool-labels'],
    staleTime: 60_000,
    retry: false,
    queryFn: async function loadToolLabels() {
      const { servers } = await mcpRequest<{ servers: Array<MCPServer> }>(
        'servers',
      )
      const entries = await Promise.all(
        servers
          .filter((server) => server.enabled)
          .map(async function loadServerTools(server) {
            const { tools } = await mcpRequest<{ tools: Array<MCPTool> }>(
              `servers/${server.id}/tools`,
            )
            return tools.map(
              (tool) =>
                [tool.alias, mcpToolLabel(server.name, tool.name)] as const,
            )
          }),
      )
      return new Map<string, string>(entries.flat())
    },
  })
  return query.data ?? EMPTY_LABELS
}

// Approvals still waiting on the user for one run, polled while it runs.
export function useMcpApprovals(runId: string | null) {
  return useQuery({
    queryKey: ['mcp', 'approvals', runId],
    enabled: Boolean(runId),
    refetchInterval: runId ? 1000 : false,
    queryFn: async function loadApprovals() {
      const { approvals } = await mcpRequest<{
        approvals: Array<MCPApproval>
      }>('approvals')
      return approvals.filter((approval) => approval.runId === runId)
    },
  })
}

export function mcpToolLabel(serverName: string, toolName: string) {
  return `${serverName} · ${toolName}`
}
