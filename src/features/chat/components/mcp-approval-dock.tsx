import { useEffect, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { HugeiconsIcon } from '@hugeicons/react'
import { PlugSocketIcon } from '@hugeicons/core-free-icons'
import { Button } from '@/components/ui/button'
import { mcpRequest } from '@/lib/mcp-api'
import type { MCPApproval } from '@/lib/mcp-api'

type Decision = {
  id: string
  decision: 'approved' | 'denied'
  scope?: 'chat' | 'tool'
}

type MCPApprovalDockProps = {
  // Pending approvals for the running turn, oldest first.
  approvals: Array<MCPApproval>
}

// Takes the composer's place while a remote tool call waits for the user, so
// the request sits where their attention already is.
export function MCPApprovalDock({ approvals }: MCPApprovalDockProps) {
  const client = useQueryClient()
  const decision = useMutation({
    mutationFn: function decide(input: Decision) {
      return mcpRequest(`approvals/${input.id}`, 'POST', {
        decision: input.decision,
        ...(input.scope ? { scope: input.scope } : {}),
      })
    },
    onSuccess: async function refresh() {
      await client.invalidateQueries({ queryKey: ['mcp'] })
    },
  })
  const approval = approvals[0]
  if (!approval) return null
  const busy = decision.isPending
  function decide(input: Omit<Decision, 'id'>) {
    decision.mutate({ id: approval.id, ...input })
  }

  return (
    <section
      aria-label="Tool approval"
      className="pointer-events-auto space-y-3 rounded-[22px] bg-surface p-4 shadow-xl/5 outline outline-ink/10"
    >
      <div className="flex items-start gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary-100 text-primary-700">
          <HugeiconsIcon icon={PlugSocketIcon} size={20} strokeWidth={1.5} />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-balance text-sm font-medium text-primary-900">
            Allow <span className="font-mono">{approval.toolName}</span> on{' '}
            {approval.serverName}?
          </h3>
          <p className="text-pretty text-xs tabular-nums text-primary-500">
            {approval.expiresAt ? (
              <>
                Expires in <ExpiresIn expiresAt={approval.expiresAt} />
              </>
            ) : (
              'Waiting for your decision'
            )}
            {approvals.length > 1 ? ` · 1 of ${approvals.length}` : ''}
          </p>
        </div>
      </div>

      <ApprovalArguments values={approval.arguments} />

      <p className="text-pretty text-xs text-primary-500">
        This call may change data on {approval.serverName}, and stopping it
        later may not undo its effects.
      </p>

      {decision.error ? (
        <p role="alert" className="text-pretty text-sm text-primary-800">
          {decision.error.message}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="ghost"
          disabled={busy}
          onClick={() => decide({ decision: 'denied' })}
        >
          Deny
        </Button>
        <span className="flex-1" />
        <Button
          size="sm"
          variant="ghost"
          disabled={busy}
          title="Allow future calls to this tool in every chat. You can reset this in MCP settings."
          onClick={() => decide({ decision: 'approved', scope: 'tool' })}
        >
          Always allow
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          title="Allow future calls to this tool in this chat."
          onClick={() => decide({ decision: 'approved', scope: 'chat' })}
        >
          Allow in this chat
        </Button>
        <Button
          size="sm"
          disabled={busy}
          onClick={() => decide({ decision: 'approved' })}
        >
          Allow once
        </Button>
      </div>
    </section>
  )
}

function ApprovalArguments({ values }: { values: Record<string, unknown> }) {
  const entries = Object.entries(values ?? {})
  if (entries.length === 0) {
    return <p className="text-xs text-primary-500">No arguments.</p>
  }
  return (
    <dl className="grid max-h-40 grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 overflow-y-auto rounded-xl bg-primary-50 p-3 font-mono text-xs ring-1 ring-primary-200">
      {entries.map(function entry([key, value]) {
        return (
          <div key={key} className="contents">
            <dt className="text-primary-500">{key}</dt>
            <dd className="whitespace-pre-wrap break-words text-primary-900">
              {typeof value === 'string'
                ? value
                : JSON.stringify(value, null, 2)}
            </dd>
          </div>
        )
      })}
    </dl>
  )
}

// Countdown to the approval's expiry. The interval subscribes to the clock,
// which render logic can't express.
function ExpiresIn({ expiresAt }: { expiresAt: number }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(function tick() {
    const interval = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(interval)
  }, [])
  const seconds = Math.max(0, Math.ceil((expiresAt - now) / 1000))
  return (
    <span>
      {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')}
    </span>
  )
}
