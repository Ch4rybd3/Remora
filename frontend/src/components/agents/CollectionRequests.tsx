import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { agentsApi } from '../../api/agents'
import type { CollectionRequest } from '../../types'
import { fmtDateTimeShort } from '../../utils/dateUtils'
import EmptyState from '../ui/EmptyState'
import { Download, FolderInput } from '../../ui/icons'

const STATES: CollectionRequest['state'][] = ['requested', 'collected', 'unavailable', 'dropped']

const STATE_TONE: Record<CollectionRequest['state'], string> = {
  requested:   'text-agent-waiting',
  collected:   'text-agent-thinking',
  unavailable: 'text-agent-error',
  dropped:     'text-fg-muted',
}

function RequestRow({ request, onChange, busy }: {
  request: CollectionRequest
  busy: boolean
  onChange: (state: CollectionRequest['state'], note: string) => void
}) {
  const [note, setNote] = useState(request.note)
  return (
    <div className="border border-hairline bg-panel p-3 space-y-1">
      <div className="flex items-center gap-2">
        <span className="text-ui text-fg">{request.label}</span>
        <span className="text-label font-mono text-fg-muted">{request.artifact}</span>
        {request.hypothesis && <span className="text-label font-mono text-fg-secondary">{request.hypothesis}</span>}
        <select className={`input ml-auto w-36 text-label ${STATE_TONE[request.state]}`} value={request.state}
                disabled={busy} onChange={e => onChange(e.target.value as CollectionRequest['state'], note)}>
          {STATES.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>
      <p className="text-ui text-fg-secondary whitespace-pre-wrap">{request.reason}</p>
      <div className="flex items-center gap-2">
        <input className="input flex-1 text-label" placeholder="Note (who was asked, when, what came back)"
               value={note} onChange={e => setNote(e.target.value)}
               onBlur={() => note !== request.note && onChange(request.state, note)} />
        <span className="text-label text-fg-muted shrink-0">
          {request.requested_by} · accepted by {request.accepted_by} · {fmtDateTimeShort(request.created_at)}
        </span>
      </div>
    </div>
  )
}

/**
 * The evidence agents found missing and the analyst agreed to ask for,
 * grouped by host. The open ones export as a Markdown list per host, to send
 * to whoever holds the systems.
 */
export default function CollectionRequests({ caseId }: { caseId: string }) {
  const qc = useQueryClient()
  const [error, setError] = useState<string | null>(null)
  const { data: requests = [] } = useQuery({
    queryKey: ['agent-collection', caseId], queryFn: () => agentsApi.collectionRequests(caseId),
  })
  const update = useMutation({
    mutationFn: ({ id, state, note }: { id: string; state: CollectionRequest['state']; note: string }) =>
      agentsApi.updateCollectionRequest(caseId, id, { state, note }),
    onSuccess: () => { setError(null); qc.invalidateQueries({ queryKey: ['agent-collection', caseId] }) },
    onError: () => setError('The request could not be updated'),
  })
  const byHost = useMemo(() => {
    const groups = new Map<string, CollectionRequest[]>()
    for (const r of requests) groups.set(r.host, [...(groups.get(r.host) ?? []), r])
    return [...groups.entries()]
  }, [requests])
  const open = requests.filter(r => r.state === 'requested').length

  const exportList = async () => {
    const blob = await agentsApi.exportCollectionRequests(caseId)
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = 'collection-request.md'
    link.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="h-full flex flex-col min-h-0">
      <div className="flex items-center gap-2 px-4 py-2 border-b border-hairline">
        <span className="text-ui text-fg-secondary">{open} waiting to be collected</span>
        <button className="btn-ghost ml-auto flex items-center gap-1" disabled={open === 0} onClick={exportList}>
          <Download size={14} /> Export the request list
        </button>
      </div>
      {error && <div className="px-4 py-2 border-b border-hairline text-ui text-agent-error">{error}</div>}
      <div className="flex-1 overflow-auto p-4 space-y-4">
        {requests.length === 0 && (
          <EmptyState icon={FolderInput} message="No evidence requested. Agents propose what is missing; accepted proposals land here." />
        )}
        {byHost.map(([host, rows]) => (
          <div key={host} className="space-y-2">
            <h3 className="text-ui font-semibold font-mono text-fg">{host}</h3>
            {rows.map(r => (
              <RequestRow key={r.id} request={r} busy={update.isPending}
                          onChange={(state, note) => update.mutate({ id: r.id, state, note })} />
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}
