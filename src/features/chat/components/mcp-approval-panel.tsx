import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { mcpRequest } from '@/lib/mcp-api'
import type { MCPApproval } from '@/lib/mcp-api'

export function MCPApprovalPanel({
  runId,
  active,
}: {
  runId: string
  active: boolean
}) {
  const client = useQueryClient()
  const key = ['mcp', 'approvals', runId]
  const approvals = useQuery({
    queryKey: key,
    enabled: active,
    refetchInterval: active ? 1000 : false,
    queryFn: async function load() {
      return (
        await mcpRequest<{ approvals: Array<MCPApproval> }>('approvals')
      ).approvals.filter(function sameRun(approval) {
        return approval.runId === runId
      })
    },
  })
  const decision = useMutation({
    mutationFn: function decide(input: {
      id: string
      decision: 'approved' | 'denied'
      scope?: 'once' | 'chat' | 'tool'
    }) {
      return mcpRequest(`approvals/${input.id}`, 'POST', {
        decision: input.decision,
        ...(input.scope ? { scope: input.scope } : {}),
      })
    },
    onSuccess: async function refresh() {
      await client.invalidateQueries({ queryKey: ['mcp'] })
    },
  })
  if (!active) return null
  return (
    <>
      {approvals.error && (
        <p role="alert" className="text-sm text-primary-600">
          Unable to load tool approvals. The tool will not execute without
          approval.
        </p>
      )}
      {decision.error && (
        <p role="alert" className="text-sm text-primary-700">
          {decision.error.message}
        </p>
      )}
      {approvals.data?.map(function card(approval) {
        return (
          <section
            key={approval.id}
            className="my-2 space-y-2 rounded-xl border border-primary-300 bg-primary-50 p-3"
          >
            <h4 className="text-pretty text-sm font-medium text-primary-900">
              {approval.serverName} / {approval.toolName}
            </h4>
            {approval.state === 'pending' ? (
              <>
                <p className="text-pretty text-xs text-primary-700">
                  Approve this exact call? It may change external data.
                  Canceling a call may not undo its effects. Approval requests
                  expire after three minutes without a decision. Chat and
                  permanent approvals allow future calls to this tool with
                  different arguments; you can reset them in MCP settings.
                </p>
                <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words text-xs text-primary-800">
                  {JSON.stringify(approval.arguments, null, 2)}
                </pre>
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    disabled={decision.isPending}
                    onClick={function approve() {
                      decision.mutate({ id: approval.id, decision: 'approved' })
                    }}
                  >
                    Approve call
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={decision.isPending}
                    onClick={function approveChat() {
                      decision.mutate({
                        id: approval.id,
                        decision: 'approved',
                        scope: 'chat',
                      })
                    }}
                  >
                    Approve for this chat
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={decision.isPending}
                    onClick={function approveTool() {
                      decision.mutate({
                        id: approval.id,
                        decision: 'approved',
                        scope: 'tool',
                      })
                    }}
                  >
                    Always approve this tool
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={decision.isPending}
                    onClick={function deny() {
                      decision.mutate({ id: approval.id, decision: 'denied' })
                    }}
                  >
                    Deny call
                  </Button>
                </div>
              </>
            ) : (
              <p role="status" className="text-pretty text-xs text-primary-700">
                {approval.state === 'approved'
                  ? 'Approved; connecting…'
                  : 'Calling remote tool…'}
                {approval.progress.message
                  ? ` ${approval.progress.message}`
                  : ''}
              </p>
            )}
          </section>
        )
      })}
    </>
  )
}
