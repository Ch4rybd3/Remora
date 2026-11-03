import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { agentsApi } from '../../api/agents'
import type { AgentHypothesis, HypothesisStance } from '../../types'
import EmptyState from '../ui/EmptyState'
import { Plus, Scale } from '../../ui/icons'

const STANCE_MARK: Record<HypothesisStance, string> = { for: '+', against: '−', neutral: '·' }
const STANCE_TONE: Record<HypothesisStance, string> = {
  for:     'text-agent-thinking bg-agent-thinking/10',
  against: 'text-agent-error bg-agent-error/10',
  neutral: 'text-fg-muted bg-fg/5',
}
/** Clicking a cell walks through the stances, then clears it. */
const NEXT: Record<string, HypothesisStance | null> = { none: 'for', for: 'against', against: 'neutral', neutral: null }

const STATE_LABEL: Record<AgentHypothesis['state'], string> = {
  open: 'Open', supported: 'Supported', refuted: 'Refuted', dropped: 'Dropped',
}

/**
 * Analysis of competing hypotheses: each explanation of the incident against
 * each finding. Read it by columns of "−": the hypothesis with the least
 * evidence against it is the strongest, not the one with the most for it.
 */
export default function HypothesisBoard({ caseId }: { caseId: string }) {
  const qc = useQueryClient()
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)
  const { data: hypotheses = [] } = useQuery({
    queryKey: ['agent-hypotheses', caseId], queryFn: () => agentsApi.hypotheses(caseId),
  })
  const { data: findings = [] } = useQuery({
    queryKey: ['agent-findings', caseId], queryFn: () => agentsApi.findings(caseId),
  })
  const refresh = () => { setError(null); qc.invalidateQueries({ queryKey: ['agent-hypotheses', caseId] }) }
  const fail = (e: unknown) => {
    const detail = (e as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail
    setError(typeof detail === 'string' ? detail : 'The change could not be saved')
  }

  const create = useMutation({
    mutationFn: () => agentsApi.createHypothesis(caseId, draft.trim()),
    onSuccess: () => { setDraft(''); refresh() }, onError: fail,
  })
  const decide = useMutation({
    mutationFn: ({ h, state }: { h: AgentHypothesis; state: AgentHypothesis['state'] }) =>
      agentsApi.updateHypothesis(caseId, h.id, { state }),
    onSuccess: refresh, onError: fail,
  })
  const cell = useMutation({
    mutationFn: ({ h, findingId, stance }: { h: AgentHypothesis; findingId: string; stance: HypothesisStance | null }) =>
      stance ? agentsApi.linkHypothesis(caseId, h.id, findingId, stance)
             : agentsApi.unlinkHypothesis(caseId, h.id, findingId),
    onSuccess: refresh, onError: fail,
  })

  const shown = findings.filter(f => f.state !== 'rejected')

  return (
    <div className="h-full flex flex-col min-h-0">
      <div className="flex items-center gap-2 px-4 py-2 border-b border-hairline">
        <input className="input flex-1" placeholder="State a hypothesis to weigh, e.g. an outsider used svc_backup over RDP"
               value={draft} onChange={e => setDraft(e.target.value)}
               onKeyDown={e => { if (e.key === 'Enter' && draft.trim().length >= 10) create.mutate() }} />
        <button className="btn-secondary flex items-center gap-1" disabled={draft.trim().length < 10 || create.isPending}
                onClick={() => create.mutate()}>
          <Plus size={14} /> Add
        </button>
      </div>
      {error && <div className="px-4 py-2 border-b border-hairline text-ui text-agent-error">{error}</div>}
      <div className="flex-1 overflow-auto p-4">
        {hypotheses.length === 0 ? (
          <EmptyState icon={Scale} message="No hypothesis yet. The Incident Leader states them as it works, or add one above." />
        ) : (
          <table className="border-collapse">
            <thead>
              <tr>
                <th className="text-left text-label text-fg-muted font-normal pb-2 pr-4">Hypothesis</th>
                <th className="text-left text-label text-fg-muted font-normal pb-2 pr-4">State</th>
                {shown.map(f => (
                  <th key={f.id} className="text-label font-mono text-fg-secondary font-normal pb-2 px-1"
                      title={`${f.title} (${f.state})`}>F{f.ref}</th>
                ))}
                <th className="text-label text-fg-muted font-normal pb-2 pl-3">Against</th>
              </tr>
            </thead>
            <tbody>
              {hypotheses.map(h => {
                const stance = Object.fromEntries(h.links.map(l => [l.finding_id, l]))
                const against = h.links.filter(l => l.stance === 'against').length
                return (
                  <tr key={h.id} className="border-t border-hairline align-top">
                    <td className="py-2 pr-4 max-w-md">
                      <span className="text-label font-mono text-fg-muted mr-2">H{h.ref}</span>
                      <span className="text-ui text-fg">{h.statement}</span>
                      <p className="text-label text-fg-muted">by {h.created_by}</p>
                    </td>
                    <td className="py-2 pr-4">
                      <select className="input py-0 text-label" value={h.state}
                              onChange={e => decide.mutate({ h, state: e.target.value as AgentHypothesis['state'] })}>
                        {Object.entries(STATE_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                      </select>
                    </td>
                    {shown.map(f => {
                      const link = stance[f.id]
                      return (
                        <td key={f.id} className="py-2 px-1 text-center">
                          <button className={`w-7 h-7 rounded-control font-mono text-ui ${link ? STANCE_TONE[link.stance] : 'text-fg-muted/40 hover:bg-fg/5'}`}
                                  title={link ? `${link.stance}: ${link.note || 'no note'} (${link.set_by})` : 'Mark how this finding bears on the hypothesis'}
                                  onClick={() => cell.mutate({ h, findingId: f.id, stance: NEXT[link?.stance ?? 'none'] })}>
                            {link ? STANCE_MARK[link.stance] : '?'}
                          </button>
                        </td>
                      )
                    })}
                    <td className={`py-2 pl-3 text-ui font-mono ${against ? 'text-agent-error' : 'text-fg-muted'}`}>{against}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
