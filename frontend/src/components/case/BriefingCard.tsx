import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { briefingApi } from '../../api/briefing'
import { featuresApi } from '../../api/agents'
import { useAuth } from '../../context/AuthContext'
import { fmtDateTimeShort } from '../../utils/dateUtils'
import { Bot, Edit2, Save } from '../../ui/icons'

/**
 * The executive briefing: figures counted from the case and a short status in
 * plain language. Executives read it; analysts write it, or ask the reporter
 * agent for a draft they accept in the Team tab. The report language set here
 * is the one agents draft the report and the briefing in.
 */
export default function BriefingCard({ caseId }: { caseId: string }) {
  const qc = useQueryClient()
  const { can } = useAuth()
  const writer = can('write')
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [note, setNote] = useState<string | null>(null)
  const { data } = useQuery({ queryKey: ['briefing', caseId], queryFn: () => briefingApi.get(caseId) })
  const { data: languages = {} } = useQuery({
    queryKey: ['report-languages'], queryFn: briefingApi.languages, staleTime: Infinity, enabled: writer,
  })
  const { data: features } = useQuery({ queryKey: ['features'], queryFn: featuresApi.get, staleTime: Infinity })
  const refresh = () => qc.invalidateQueries({ queryKey: ['briefing', caseId] })
  const save = useMutation({
    mutationFn: (text: string) => briefingApi.update(caseId, text),
    onSuccess: () => { setEditing(false); refresh() },
  })
  const language = useMutation({
    mutationFn: (code: string) => briefingApi.setLanguage(caseId, code),
    onSuccess: refresh,
  })
  const ask = useMutation({
    mutationFn: () => briefingApi.draft(caseId),
    onSuccess: sent => setNote(`${sent.agent_name} is drafting it; accept the proposal in the Team tab.`),
    onError: () => setNote('The reporter could not be asked'),
  })
  if (!data) return null

  return (
    <div className="border border-hairline bg-panel p-4 mb-4 space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <h2 className="text-title font-semibold text-fg">Briefing</h2>
        <span className="text-label text-fg-muted">{data.phase} · {data.status} · {data.severity}</span>
        {writer && (
          <label className="ml-auto flex items-center gap-2 text-label text-fg-muted">
            Report language
            <select className="input w-32 text-label" value={data.report_language} disabled={language.isPending}
                    onChange={e => language.mutate(e.target.value)}>
              {Object.entries(languages).map(([code, name]) => <option key={code} value={code}>{name}</option>)}
            </select>
          </label>
        )}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {data.kpis.map(k => (
          <div key={k.key} className="border border-hairline bg-canvas p-2">
            <p className="text-title font-semibold font-mono text-fg">{k.value}</p>
            <p className="text-label text-fg-muted">{k.label}</p>
          </div>
        ))}
      </div>

      {editing ? (
        <div className="space-y-2">
          <textarea className="input w-full resize-y" rows={8} value={draft} onChange={e => setDraft(e.target.value)} />
          <div className="flex justify-end gap-2">
            <button className="btn-ghost" onClick={() => setEditing(false)}>Cancel</button>
            <button className="btn-primary flex items-center gap-1" disabled={save.isPending}
                    onClick={() => save.mutate(draft)}>
              <Save size={14} /> Save
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-1">
          {data.briefing
            ? <p className="text-prose text-fg whitespace-pre-wrap">{data.briefing}</p>
            : <p className="text-ui text-fg-muted">No status written yet.</p>}
          {data.briefing_at && (
            <p className="text-label text-fg-muted">{data.briefing_by} · {fmtDateTimeShort(data.briefing_at)}</p>
          )}
        </div>
      )}

      {writer && !editing && (
        <div className="flex items-center gap-2">
          {note && <p className="text-label text-fg-muted flex-1">{note}</p>}
          <div className="ml-auto flex items-center gap-2">
            {features?.charybdis && (
              <button className="btn-ghost flex items-center gap-1" disabled={ask.isPending} onClick={() => ask.mutate()}>
                <Bot size={14} /> Draft with the reporter
              </button>
            )}
            <button className="btn-secondary flex items-center gap-1"
                    onClick={() => { setDraft(data.briefing); setEditing(true) }}>
              <Edit2 size={14} /> Edit
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
