import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { agentsApi } from '../../api/agents'
import type { Agent, AgentFinding, AgentObservation } from '../../types'
import { fmtDateTime } from '../../utils/dateUtils'
import EmptyState from '../ui/EmptyState'
import { Check, ExternalLink, Lightbulb, X } from '../../ui/icons'

const SEVERITY_TONE: Record<AgentFinding['severity'], string> = {
  critical: 'bg-severity-critical/10 text-severity-critical border-severity-critical/20',
  high:     'bg-severity-high/10 text-severity-high border-severity-high/20',
  medium:   'bg-severity-medium/10 text-severity-medium border-severity-medium/20',
  low:      'bg-severity-low/10 text-severity-low border-severity-low/20',
  info:     'bg-severity-info/10 text-severity-info border-severity-info/20',
}

const STATE_LABEL: Record<AgentFinding['state'], string> = {
  in_review: 'In review',
  proposed:  'Waiting for you',
  validated: 'Validated',
  rejected:  'Rejected',
}

/** Pages holding sources that are not tables. They open on their list, not on the line. */
const SOURCE_PAGE: Record<Exclude<AgentObservation['source_kind'], 'artifact'>, string> = {
  memory: '/artifacts/memory',
  email:  '/artifacts/email',
  binary: '/artifacts/binary',
}

/**
 * Where a citation opens: an Explorer row filtered to it, in the detail panel;
 * for a memory line, an email part or a binary entry, the page that holds it.
 */
export function observationLink(o: AgentObservation): string {
  if (o.source_kind && o.source_kind !== 'artifact') return SOURCE_PAGE[o.source_kind]
  return `/artifacts/explorer?observation=${encodeURIComponent(o.id)}`
}

function Citation({ observation }: { observation: AgentObservation }) {
  const navigate = useNavigate()
  const identifying = Object.entries(observation.row).slice(0, 4)
    .map(([k, v]) => `${k}=${v ?? ''}`).join(' · ')
  return (
    <li className="border-l-2 border-hairline pl-2 space-y-1">
      <div className="flex items-center gap-2">
        <span className="text-label font-mono text-fg">{observation.artifact_name}</span>
        <span className="text-label font-mono text-fg-muted break-all">{observation.locator}</span>
        {observation.available ? (
          <button className="btn-ghost ml-auto flex items-center gap-1 text-label"
                  title="Open this row in the Artifact Explorer"
                  onClick={() => navigate(observationLink(observation))}>
            <ExternalLink size={12} /> {observation.source_kind === 'artifact' ? 'Open row' : 'Open page'}
          </button>
        ) : (
          <span className="ml-auto text-label text-fg-muted"
                title="The table this row came from was removed. The copy below is what the agent read.">
            table removed
          </span>
        )}
      </div>
      <p className="text-ui text-fg-secondary whitespace-pre-wrap">{observation.note}</p>
      <p className="text-label font-mono text-fg-muted break-all">{identifying}</p>
    </li>
  )
}

function FindingCard({ finding, author, busy, onDecide }: {
  finding: AgentFinding
  author: string
  busy: boolean
  onDecide: (validate: boolean, comment: string) => void
}) {
  const [comment, setComment] = useState('')
  const open = finding.state === 'in_review' || finding.state === 'proposed'
  const challenged = finding.review_verdict === 'unsupported'

  return (
    <div className="border border-hairline bg-panel p-3 space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-label font-mono font-semibold text-fg">F{finding.ref}</span>
        <span className={`text-label px-2 py-0.5 border rounded-control ${SEVERITY_TONE[finding.severity]}`}>
          {finding.severity}
        </span>
        <span className="text-label text-fg-muted">confidence {finding.confidence}</span>
        {finding.attack_ids.map(id => (
          <span key={id} className="text-label font-mono px-1.5 py-0.5 border border-hairline rounded-control text-fg-secondary">{id}</span>
        ))}
        <span className="text-label text-fg-muted ml-auto">
          {author} · {fmtDateTime(finding.created_at)} · {STATE_LABEL[finding.state]}
          {finding.decided_by ? ` by ${finding.decided_by}` : ''}
        </span>
      </div>

      <p className="text-ui text-fg font-semibold">{finding.title}</p>
      <p className="text-prose text-fg whitespace-pre-wrap">{finding.statement}</p>
      <p className="text-ui text-fg-secondary whitespace-pre-wrap">
        <span className="text-fg-muted">Confidence: </span>{finding.confidence_reason}
      </p>

      <ul className="space-y-2">
        {finding.observations.map(o => <Citation key={o.id} observation={o} />)}
      </ul>

      {(finding.review_verdict || finding.review_comment) && (
        <div className={`border-l-2 pl-3 space-y-1 ${challenged ? 'border-agent-error/60' : 'border-agent-thinking/60'}`}>
          <p className={`text-label font-semibold ${challenged ? 'text-agent-error' : 'text-agent-thinking'}`}>
            {finding.review_verdict
              ? `Reviewer${finding.reviewed_by ? ` (${finding.reviewed_by})` : ''}: ${finding.review_verdict}`
              : 'Reviewer'}
          </p>
          {finding.review_comment && (
            <p className="text-ui text-fg-secondary whitespace-pre-wrap">{finding.review_comment}</p>
          )}
          {finding.review_alternatives && (
            <p className="text-ui text-fg-secondary whitespace-pre-wrap">
              <span className="text-fg-muted">Alternatives: </span>{finding.review_alternatives}
            </p>
          )}
        </div>
      )}
      {finding.decision_comment && (
        <p className="text-label text-fg-muted">Comment: {finding.decision_comment}</p>
      )}

      {open && (
        <div className="flex items-center gap-2 pt-1">
          <input className="input flex-1" placeholder="Comment for the agent (optional)"
                 value={comment} onChange={e => setComment(e.target.value)} />
          <button className="btn-secondary flex items-center gap-1" disabled={busy}
                  onClick={() => onDecide(false, comment)}>
            <X size={14} /> Reject
          </button>
          <button className="btn-primary flex items-center gap-1" disabled={busy}
                  title={finding.state === 'in_review' ? 'The reviewer has not answered yet' : undefined}
                  onClick={() => onDecide(true, comment)}>
            <Check size={14} /> Validate
          </button>
        </div>
      )}
    </div>
  )
}

/**
 * The team's conclusions. Each rests on rows the agent re-read from the store
 * when it cited them; the reviewer's verdict comes first, the analyst decides.
 * Only validated findings can be cited by the reporter.
 */
export default function FindingsBoard({ caseId, agents }: { caseId: string; agents: Agent[] }) {
  const qc = useQueryClient()
  const [showDecided, setShowDecided] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { data: findings = [] } = useQuery({
    queryKey: ['agent-findings', caseId], queryFn: () => agentsApi.findings(caseId),
  })
  const decide = useMutation({
    mutationFn: ({ f, validate, comment }: { f: AgentFinding; validate: boolean; comment: string }) =>
      validate ? agentsApi.validateFinding(caseId, f.id, comment) : agentsApi.rejectFinding(caseId, f.id, comment),
    onSuccess: () => { setError(null); qc.invalidateQueries({ queryKey: ['agent-findings', caseId] }) },
    onError: (e: unknown) => {
      const detail = (e as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail
      setError(typeof detail === 'string' ? detail : 'The decision could not be saved')
    },
  })

  const names = Object.fromEntries(agents.map(a => [a.id, a.name]))
  const isOpen = (f: AgentFinding) => f.state === 'in_review' || f.state === 'proposed'
  const shown = findings.filter(f => showDecided || isOpen(f))
  // Report text accepted from the reporter that rests on a finding rejected since.
  const { data: reportIssues = [] } = useQuery({
    queryKey: ['agent-report-check', caseId, findings.map(f => f.state).join()],
    queryFn: () => agentsApi.reportCheck(caseId),
  })

  return (
    <div className="h-full flex flex-col min-h-0">
      <div className="flex items-center gap-2 px-4 py-2 border-b border-hairline">
        <span className="text-ui text-fg-secondary">
          {findings.filter(isOpen).length} open · {findings.filter(f => f.state === 'validated').length} validated
        </span>
        <label className="ml-auto flex items-center gap-2 text-label text-fg-muted">
          <input type="checkbox" checked={showDecided} onChange={e => setShowDecided(e.target.checked)} />
          Show decided
        </label>
      </div>
      {error && <div className="px-4 py-2 border-b border-hairline text-ui text-agent-error">{error}</div>}
      {reportIssues.length > 0 && (
        <div className="px-4 py-2 border-b border-hairline text-ui text-agent-error space-y-1">
          <p className="font-semibold">The report relies on findings that are no longer validated:</p>
          {reportIssues.map(i => (
            <p key={`${i.proposal_id}-${i.finding}`} className="text-label">
              {i.part} cites {i.finding}, now {i.state}. Review that part of the report before delivery.
            </p>
          ))}
        </div>
      )}
      <div className="flex-1 overflow-auto p-4 space-y-3">
        {shown.length === 0 && <EmptyState icon={Lightbulb} message="No finding to decide on" />}
        {shown.map(f => (
          <FindingCard key={f.id} finding={f} author={names[f.agent_id] ?? 'Agent'}
                       busy={decide.isPending}
                       onDecide={(validate, comment) => decide.mutate({ f, validate, comment })} />
        ))}
      </div>
    </div>
  )
}
