import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { agentsApi } from '../../api/agents'
import type { Agent, AgentApproval } from '../../types'
import { fmtDateTime } from '../../utils/dateUtils'
import EmptyState from '../ui/EmptyState'
import { Check, ExternalLink, X } from '../../ui/icons'

function ApprovalCard({ approval, agentName, busy, onDecide }: {
  approval: AgentApproval
  agentName: string
  busy: boolean
  onDecide: (approve: boolean, comment: string) => void
}) {
  const [comment, setComment] = useState('')
  const [showResult, setShowResult] = useState(false)
  const open = approval.state === 'pending'
  return (
    <div className="border border-hairline bg-panel p-3 space-y-2">
      <div className="flex items-center gap-2">
        <span className="text-label px-2 py-0.5 border rounded-control font-mono bg-data-3/10 text-data-3 border-data-3/20">
          {approval.tool}
        </span>
        <span className="text-label text-fg-muted">{agentName} · {fmtDateTime(approval.created_at)}</span>
        {!open && (
          <span className={`text-label ml-auto ${approval.state === 'approved' ? 'text-agent-thinking' : 'text-agent-error'}`}>
            {approval.state} by {approval.decided_by}
          </span>
        )}
      </div>
      <p className="text-ui text-fg">{approval.summary}</p>
      <pre className="border border-hairline bg-canvas p-2 text-label font-mono text-fg-secondary whitespace-pre-wrap break-all max-h-48 overflow-auto">
        {JSON.stringify(approval.arguments, null, 2)}
      </pre>
      {approval.decision_comment && (
        <p className="text-label text-fg-muted">Comment: {approval.decision_comment}</p>
      )}
      {approval.result && (
        <div>
          <button className="btn-ghost text-label" onClick={() => setShowResult(v => !v)}>
            {showResult ? 'Hide the result' : 'Show the result'}
          </button>
          {showResult && (
            <pre className="mt-1 border border-hairline bg-canvas p-2 text-label font-mono text-fg-secondary whitespace-pre-wrap break-all max-h-80 overflow-auto">
              {approval.result}
            </pre>
          )}
        </div>
      )}
      {open && (
        <div className="flex items-center gap-2 pt-1">
          <input className="input flex-1" placeholder="Comment for the agent (optional)"
                 value={comment} onChange={e => setComment(e.target.value)} />
          <button className="btn-secondary flex items-center gap-1" disabled={busy}
                  onClick={() => onDecide(false, comment)}>
            <X size={14} /> Deny
          </button>
          <button className="btn-primary flex items-center gap-1" disabled={busy}
                  title="Runs the action now, as you, and hands the result back to the agent"
                  onClick={() => onDecide(true, comment)}>
            <Check size={14} /> Approve
          </button>
        </div>
      )}
    </div>
  )
}

/**
 * Actions an agent asked to take that send something out of Remora: a CTI
 * lookup, a call to a third-party MCP server. The agent is paused until one
 * is decided; approving runs the action as the analyst, and audits it.
 */
export default function ApprovalQueue({ caseId, agents }: { caseId: string; agents: Agent[] }) {
  const qc = useQueryClient()
  const [showDecided, setShowDecided] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { data: approvals = [] } = useQuery({
    queryKey: ['agent-approvals', caseId], queryFn: () => agentsApi.approvals(caseId), refetchInterval: 15_000,
  })
  const decide = useMutation({
    mutationFn: ({ a, approve, comment }: { a: AgentApproval; approve: boolean; comment: string }) =>
      approve ? agentsApi.approve(caseId, a.id, comment || undefined)
              : agentsApi.deny(caseId, a.id, comment || undefined),
    onSuccess: () => {
      setError(null)
      for (const key of ['agent-approvals', 'agent-tasks', 'agent-attention']) {
        qc.invalidateQueries({ queryKey: [key, caseId] })
      }
    },
    onError: (e: unknown) => {
      const detail = (e as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail
      setError(typeof detail === 'string' ? detail : 'The decision could not be saved')
    },
  })

  const names = Object.fromEntries(agents.map(a => [a.id, a.name]))
  const pending = approvals.filter(a => a.state === 'pending').length
  const shown = approvals.filter(a => showDecided || a.state === 'pending')

  return (
    <div className="h-full flex flex-col min-h-0">
      <div className="flex items-center gap-2 px-4 py-2 border-b border-hairline">
        <span className="text-ui text-fg-secondary">{pending} waiting for your approval</span>
        <label className="ml-auto flex items-center gap-2 text-label text-fg-muted">
          <input type="checkbox" checked={showDecided} onChange={e => setShowDecided(e.target.checked)} />
          Show decided
        </label>
      </div>
      {error && <div className="px-4 py-2 border-b border-hairline text-ui text-agent-error">{error}</div>}
      <div className="flex-1 overflow-auto p-4 space-y-3">
        {shown.length === 0 && <EmptyState icon={ExternalLink} message="No action waiting for approval" />}
        {shown.map(a => (
          <ApprovalCard key={a.id} approval={a} agentName={names[a.agent_id] ?? 'Agent'}
                        busy={decide.isPending}
                        onDecide={(approve, comment) => decide.mutate({ a, approve, comment })} />
        ))}
      </div>
    </div>
  )
}
