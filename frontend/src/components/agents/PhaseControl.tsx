import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { agentsApi } from '../../api/agents'
import { Flag } from '../../ui/icons'

/**
 * The case's phase of the response, with its goal and questions. Every agent
 * is told the phase; the leader may propose moving on, the analyst sets it here.
 */
export default function PhaseControl({ caseId }: { caseId: string }) {
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const { data } = useQuery({ queryKey: ['agent-phase', caseId], queryFn: () => agentsApi.phase(caseId) })
  const set = useMutation({
    mutationFn: (phase: string) => agentsApi.setPhase(caseId, phase),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['agent-phase', caseId] }),
  })
  if (!data) return null
  const current = data.phases.find(p => p.id === data.phase) ?? data.phases[0]

  return (
    <div className="relative">
      <button className="btn-ghost text-label flex items-center gap-1" onClick={() => setOpen(v => !v)}
              title={current.goal}>
        <Flag size={12} /> {current.name}
      </button>
      {open && (
        <div className="absolute left-0 top-full mt-1 z-50 w-96 border border-hairline bg-panel shadow-xl p-3 space-y-2">
          <div className="flex flex-wrap gap-1">
            {data.phases.map(p => (
              <button key={p.id} disabled={set.isPending}
                      className={p.id === data.phase ? 'btn-secondary text-label' : 'btn-ghost text-label'}
                      onClick={() => p.id !== data.phase && set.mutate(p.id)}>
                {p.name}
              </button>
            ))}
          </div>
          <p className="text-ui text-fg">{current.goal}</p>
          <ul className="space-y-1">
            {current.questions.map(q => (
              <li key={q} className="text-label text-fg-secondary border-l-2 border-hairline pl-2">{q}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
