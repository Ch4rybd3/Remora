import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { agentsApi } from '../../api/agents'
import type { Agent, AgentProposal } from '../../types'
import { fmtDateTime } from '../../utils/dateUtils'
import EmptyState from '../ui/EmptyState'
import { Check, ClipboardCheck, Edit2, X } from '../../ui/icons'

const KIND_LABEL: Record<AgentProposal['kind'], string> = {
  ioc:               'IOC',
  timeline_event:    'Timeline event',
  task:              'Task',
  ttp:               'Technique',
  report_section:    'Report section',
  executive_summary: 'Executive summary',
  incident_log:      'Incident log',
  lesson:            'Lesson learned',
}

const KIND_TONE: Record<AgentProposal['kind'], string> = {
  ioc:               'bg-data-2/10 text-data-2 border-data-2/20',
  timeline_event:    'bg-data-4/10 text-data-4 border-data-4/20',
  task:              'bg-accent/10 text-accent border-accent/20',
  ttp:               'bg-data-5/10 text-data-5 border-data-5/20',
  report_section:    'bg-data-1/10 text-data-1 border-data-1/20',
  executive_summary: 'bg-data-1/10 text-data-1 border-data-1/20',
  incident_log:      'bg-data-3/10 text-data-3 border-data-3/20',
  lesson:            'bg-data-6/10 text-data-6 border-data-6/20',
}

/** The fields an analyst may change before accepting, per kind. */
const EDITABLE: Record<AgentProposal['kind'], string[]> = {
  ioc:               ['value', 'description', 'confidence'],
  timeline_event:    ['title', 'description'],
  task:              ['objective'],
  ttp:               ['technique_name', 'comment'],
  report_section:    ['text'],
  executive_summary: ['text'],
  incident_log:      ['title', 'description', 'actor'],
  lesson:            ['title', 'lesson', 'tags'],
}

/** Report text is long: shown in full rather than as a one-line headline. */
const IS_TEXT = new Set<AgentProposal['kind']>(['report_section', 'executive_summary'])

function headline(p: AgentProposal): string {
  const d = p.payload
  if (p.kind === 'ioc') return `${String(d.type)} · ${String(d.value)}`
  if (p.kind === 'timeline_event') return `${String(d.event_ts)}Z · ${String(d.title)}`
  if (p.kind === 'ttp') return `${String(d.technique_id)} · ${String(d.technique_name ?? '')}`
  if (p.kind === 'report_section') return `${String(d.name ?? d.section)} · from ${(d.findings as string[] ?? []).join(', ')}`
  if (p.kind === 'executive_summary') return `from ${(d.findings as string[] ?? []).join(', ')}`
  if (p.kind === 'lesson') return String(d.title)
  if (p.kind === 'incident_log') return `${String(d.event_ts)}Z · ${String(d.category)} · ${String(d.title)}`
  return `${String(d.role)} · ${String(d.objective)}`
}

function ProposalCard({ proposal, agentName, onDecide, busy }: {
  proposal: AgentProposal
  agentName: string
  busy: boolean
  onDecide: (accept: boolean, payload?: Record<string, unknown>, comment?: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<Record<string, string>>({})
  const [comment, setComment] = useState('')
  const open = proposal.state === 'proposed'
  const fields = EDITABLE[proposal.kind]

  const edits = () => {
    const changed = Object.fromEntries(Object.entries(draft).filter(
      ([k, v]) => v !== String(proposal.payload[k] ?? '')))
    return Object.keys(changed).length ? changed : undefined
  }

  return (
    <div className="border border-hairline bg-panel p-3 space-y-2">
      <div className="flex items-center gap-2">
        <span className={`text-label px-2 py-0.5 border rounded-control ${KIND_TONE[proposal.kind]}`}>
          {KIND_LABEL[proposal.kind]}
        </span>
        <span className="text-label text-fg-muted">{agentName} · {fmtDateTime(proposal.created_at)}</span>
        {!open && (
          <span className={`text-label ml-auto ${proposal.state === 'accepted' ? 'text-agent-thinking' : 'text-agent-error'}`}>
            {proposal.state} by {proposal.decided_by}
          </span>
        )}
      </div>

      <p className="text-ui text-fg font-mono break-all">{headline(proposal)}</p>
      {IS_TEXT.has(proposal.kind) && (
        <div className="border border-hairline bg-canvas p-2 text-prose text-fg whitespace-pre-wrap max-h-96 overflow-auto">
          {String(proposal.payload.text ?? '')}
        </div>
      )}
      {IS_TEXT.has(proposal.kind) && open && (
        <p className="text-label text-fg-muted">
          Accepting adds this after what the section already holds, without the [F] marks.
        </p>
      )}
      {proposal.kind === 'lesson' && (
        <p className="text-prose text-fg whitespace-pre-wrap">{String(proposal.payload.lesson ?? '')}</p>
      )}
      {proposal.kind === 'ttp' && Boolean(proposal.payload.comment) && (
        <p className="text-ui text-fg-secondary whitespace-pre-wrap">{String(proposal.payload.comment)}</p>
      )}
      {proposal.kind !== 'task' && Boolean(proposal.payload.description) && (
        <p className="text-ui text-fg-secondary whitespace-pre-wrap">{String(proposal.payload.description)}</p>
      )}
      <p className="text-ui text-fg-secondary whitespace-pre-wrap">
        <span className="text-fg-muted">Why: </span>{proposal.rationale}
      </p>
      {proposal.evidence.length > 0 && (
        <ul className="space-y-1">
          {proposal.evidence.map((e, i) => (
            <li key={i} className="text-label font-mono text-fg-secondary border-l-2 border-hairline pl-2 break-all">{e}</li>
          ))}
        </ul>
      )}
      {proposal.decision_comment && (
        <p className="text-label text-fg-muted">Comment: {proposal.decision_comment}</p>
      )}

      {open && editing && (
        <div className="space-y-2">
          {fields.map(field => (
            <label key={field} className="block">
              <span className="label">{field}</span>
              <textarea className="input w-full resize-y"
                        rows={field === 'text' ? 12 : field === 'value' || field === 'title' ? 1 : 3}
                        defaultValue={String(proposal.payload[field] ?? '')}
                        onChange={e => setDraft(d => ({ ...d, [field]: e.target.value }))} />
            </label>
          ))}
        </div>
      )}

      {open && (
        <div className="flex items-center gap-2 pt-1">
          <input className="input flex-1" placeholder="Comment for the agent (optional)"
                 value={comment} onChange={e => setComment(e.target.value)} />
          <button className="btn-ghost flex items-center gap-1" disabled={busy}
                  onClick={() => setEditing(v => !v)}>
            <Edit2 size={14} /> Edit
          </button>
          <button className="btn-secondary flex items-center gap-1" disabled={busy}
                  onClick={() => onDecide(false, undefined, comment)}>
            <X size={14} /> Reject
          </button>
          <button className="btn-primary flex items-center gap-1" disabled={busy}
                  onClick={() => onDecide(true, editing ? edits() : undefined, comment)}>
            <Check size={14} /> Accept
          </button>
        </div>
      )}
    </div>
  )
}

/**
 * What the agents want written into the case. Nothing reaches the case until
 * it is accepted here, and an accepted proposal is created through the same
 * route, and audited the same way, as one typed by hand.
 */
export default function ProposalInbox({ caseId, agents }: { caseId: string; agents: Agent[] }) {
  const qc = useQueryClient()
  const [showDecided, setShowDecided] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { data: proposals = [] } = useQuery({
    queryKey: ['agent-proposals', caseId], queryFn: () => agentsApi.proposals(caseId),
  })
  const decide = useMutation({
    mutationFn: ({ p, accept, payload, comment }: {
      p: AgentProposal; accept: boolean; payload?: Record<string, unknown>; comment?: string
    }) => accept ? agentsApi.accept(caseId, p.id, payload, comment) : agentsApi.reject(caseId, p.id, comment),
    onSuccess: () => {
      setError(null)
      for (const key of ['agent-proposals', 'agent-tasks', 'agents', 'iocs', 'timeline', 'case', 'mitre-ttps', 'incidentLog']) {
        qc.invalidateQueries({ queryKey: [key, caseId] })
      }
    },
    onError: (e: unknown) => {
      const detail = (e as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail
      setError(typeof detail === 'string' ? detail : 'The decision could not be saved')
    },
  })

  const names = Object.fromEntries(agents.map(a => [a.id, a.name]))
  const shown = proposals.filter(p => showDecided || p.state === 'proposed')

  return (
    <div className="h-full flex flex-col min-h-0">
      <div className="flex items-center gap-2 px-4 py-2 border-b border-hairline">
        <span className="text-ui text-fg-secondary">
          {proposals.filter(p => p.state === 'proposed').length} waiting for a decision
        </span>
        <label className="ml-auto flex items-center gap-2 text-label text-fg-muted">
          <input type="checkbox" checked={showDecided} onChange={e => setShowDecided(e.target.checked)} />
          Show decided
        </label>
      </div>
      {error && <div className="px-4 py-2 border-b border-hairline text-ui text-agent-error">{error}</div>}
      <div className="flex-1 overflow-auto p-4 space-y-3">
        {shown.length === 0 && <EmptyState icon={ClipboardCheck} message="No proposal waiting" />}
        {shown.map(p => (
          <ProposalCard key={p.id} proposal={p} agentName={names[p.agent_id] ?? 'Agent'}
                        busy={decide.isPending}
                        onDecide={(accept, payload, comment) => decide.mutate({ p, accept, payload, comment })} />
        ))}
      </div>
    </div>
  )
}
