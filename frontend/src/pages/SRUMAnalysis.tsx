import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { BookmarkPlus } from 'lucide-react'
import { useCurrentCase } from '../context/CurrentCaseContext'
import { timelineApi } from '../api/timeline'
import { srumApi, type SrumAppUsageEntry, type SrumNetworkEntry } from '../api/ezSrum'

type Tab = 'app-usage' | 'network'

const TABS: { id: Tab; label: string }[] = [
  { id: 'app-usage', label: 'App Resource Usage' },
  { id: 'network',   label: 'Network Usage' },
]

function dt(s: string | null) {
  if (!s) return '—'
  return new Date(s).toLocaleString()
}

function fmtBytes(n: number | null) {
  if (!n) return '—'
  if (n < 1024) return `${n} B`
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`
  return `${(n / 1024 ** 3).toFixed(2)} GB`
}

function PinBtn({ active, onClick }: { active: boolean; onClick: (e: React.MouseEvent) => void }) {
  return (
    <button
      className={`flex items-center justify-center w-5 h-5 rounded transition-colors ${
        active ? 'text-accent-green' : 'text-gray-600 hover:text-gray-300'
      }`}
      onClick={onClick}
      title="Pin to timeline"
    >
      <BookmarkPlus size={12} />
    </button>
  )
}

function PinPanel({ count, onSend, children }: { count: number; onSend: () => void; children: React.ReactNode }) {
  return (
    <div className="w-60 shrink-0 border-l border-white/10 flex flex-col">
      <div className="px-3 py-2 border-b border-white/10 flex items-center justify-between shrink-0">
        <span className="text-xs text-gray-400 font-semibold uppercase tracking-wide">
          Pinned {count > 0 && <span className="ml-1 text-accent-green">{count}</span>}
        </span>
        {count > 0 && (
          <button className="text-xs text-accent-green hover:underline" onClick={onSend}>
            Send to Timeline
          </button>
        )}
      </div>
      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {count === 0
          ? <p className="text-xs text-gray-600 italic px-1 pt-2">Pin rows to add to Timeline</p>
          : children}
      </div>
    </div>
  )
}

// ── App Resource Usage tab ────────────────────────────────────────────────────

function AppUsageTab({ caseId }: { caseId: string }) {
  const [search, setSearch] = useState('')
  const [pinned, setPinned] = useState<Set<number>>(new Set())
  const qc = useQueryClient()

  const { data, isLoading } = useQuery({
    queryKey: ['srum-app', caseId, search],
    queryFn: () => srumApi.listAppUsage(caseId, { search, limit: 1000 }),
    placeholderData: prev => prev,
  })
  const items = data?.items ?? []

  function togglePin(r: SrumAppUsageEntry) {
    setPinned(prev => { const n = new Set(prev); n.has(r.id) ? n.delete(r.id) : n.add(r.id); return n })
  }

  async function sendToTimeline() {
    for (const r of items.filter(x => pinned.has(x.id))) {
      if (!r.timestamp) continue
      await timelineApi.create(caseId, {
        case_id: caseId, event_ts: r.timestamp,
        title: r.exe_info ?? 'SRUM App entry',
        description: `SRUM App — User: ${r.user_name ?? '?'} · FG read: ${fmtBytes(r.fg_bytes_read)} · FG write: ${fmtBytes(r.fg_bytes_written)}`,
        source: 'srum', actor: r.user_name ?? '', tags: 'srum,app-usage',
      })
    }
    qc.invalidateQueries({ queryKey: ['timeline', caseId] })
    setPinned(new Set())
  }

  return (
    <div className="flex h-full">
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <div className="flex items-center gap-3 px-4 py-2 border-b border-white/10 shrink-0">
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search exe, description…" className="input text-xs flex-1 max-w-sm" />
          <span className="text-xs text-gray-500 ml-auto">{data?.total?.toLocaleString() ?? 0} entries</span>
        </div>
        <div className="overflow-auto flex-1">
          <table className="w-full text-xs min-w-[1000px]">
            <thead className="sticky top-0 bg-[#0b121f] z-10">
              <tr className="border-b border-white/10 text-gray-500 uppercase tracking-wide text-[10px]">
                <th className="py-2 px-3 w-8" />
                <th className="py-2 px-3 text-left w-36">Timestamp</th>
                <th className="py-2 px-3 text-left">Exe / App</th>
                <th className="py-2 px-3 text-left w-32">User</th>
                <th className="py-2 px-3 text-right w-24">FG Read</th>
                <th className="py-2 px-3 text-right w-24">FG Write</th>
                <th className="py-2 px-3 text-right w-24">BG Read</th>
                <th className="py-2 px-3 text-right w-24">BG Write</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && <tr><td colSpan={8} className="py-10 text-center text-gray-500">Loading…</td></tr>}
              {!isLoading && items.length === 0 && (
                <tr><td colSpan={8} className="py-10 text-center text-gray-600">No SRUM app data — import a SrumECmd AppResourceUseInfo CSV</td></tr>
              )}
              {items.map(r => (
                <tr key={r.id} className={`border-b border-white/5 hover:bg-white/[0.02] ${pinned.has(r.id) ? 'bg-accent-green/5' : ''}`}>
                  <td className="py-1.5 px-3"><PinBtn active={pinned.has(r.id)} onClick={e => { e.stopPropagation(); togglePin(r) }} /></td>
                  <td className="py-1.5 px-3 text-gray-400 tabular-nums font-mono">{dt(r.timestamp)}</td>
                  <td className="py-1.5 px-3 text-gray-200 font-mono max-w-[220px] truncate" title={r.exe_info ?? ''}>
                    {r.exe_info ?? '—'}
                    {r.exe_description && <span className="text-gray-600 ml-1.5">({r.exe_description})</span>}
                  </td>
                  <td className="py-1.5 px-3 text-gray-400 truncate max-w-[120px]">{r.user_name ?? '—'}</td>
                  <td className="py-1.5 px-3 text-right text-blue-400 tabular-nums">{fmtBytes(r.fg_bytes_read)}</td>
                  <td className="py-1.5 px-3 text-right text-orange-400 tabular-nums">{fmtBytes(r.fg_bytes_written)}</td>
                  <td className="py-1.5 px-3 text-right text-gray-500 tabular-nums">{fmtBytes(r.bg_bytes_read)}</td>
                  <td className="py-1.5 px-3 text-right text-gray-500 tabular-nums">{fmtBytes(r.bg_bytes_written)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <PinPanel count={pinned.size} onSend={sendToTimeline}>
        {[...pinned].map(id => {
          const r = items.find(x => x.id === id)
          return r ? (
            <div key={id} className="text-xs text-gray-400 bg-white/5 rounded px-2 py-1.5 font-mono truncate">
              {r.exe_info ?? '?'}
            </div>
          ) : null
        })}
      </PinPanel>
    </div>
  )
}

// ── Network Usage tab ─────────────────────────────────────────────────────────

function NetworkTab({ caseId }: { caseId: string }) {
  const [search, setSearch] = useState('')
  const [pinned, setPinned] = useState<Set<number>>(new Set())
  const qc = useQueryClient()

  const { data, isLoading } = useQuery({
    queryKey: ['srum-net', caseId, search],
    queryFn: () => srumApi.listNetwork(caseId, { search, limit: 1000 }),
    placeholderData: prev => prev,
  })
  const items = data?.items ?? []

  function togglePin(r: SrumNetworkEntry) {
    setPinned(prev => { const n = new Set(prev); n.has(r.id) ? n.delete(r.id) : n.add(r.id); return n })
  }

  async function sendToTimeline() {
    for (const r of items.filter(x => pinned.has(x.id))) {
      if (!r.timestamp) continue
      await timelineApi.create(caseId, {
        case_id: caseId, event_ts: r.timestamp,
        title: r.exe_info ?? 'SRUM Network entry',
        description: `SRUM Network — User: ${r.user_name ?? '?'} · Profile: ${r.profile_name ?? '?'} · Recv: ${fmtBytes(r.bytes_received)} · Sent: ${fmtBytes(r.bytes_sent)}`,
        source: 'srum', actor: r.user_name ?? '', tags: 'srum,network',
      })
    }
    qc.invalidateQueries({ queryKey: ['timeline', caseId] })
    setPinned(new Set())
  }

  return (
    <div className="flex h-full">
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <div className="flex items-center gap-3 px-4 py-2 border-b border-white/10 shrink-0">
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search exe, profile…" className="input text-xs flex-1 max-w-sm" />
          <span className="text-xs text-gray-500 ml-auto">{data?.total?.toLocaleString() ?? 0} entries</span>
        </div>
        <div className="overflow-auto flex-1">
          <table className="w-full text-xs min-w-[900px]">
            <thead className="sticky top-0 bg-[#0b121f] z-10">
              <tr className="border-b border-white/10 text-gray-500 uppercase tracking-wide text-[10px]">
                <th className="py-2 px-3 w-8" />
                <th className="py-2 px-3 text-left w-36">Timestamp</th>
                <th className="py-2 px-3 text-left">Exe / App</th>
                <th className="py-2 px-3 text-left w-32">User</th>
                <th className="py-2 px-3 text-left w-32">Profile / Interface</th>
                <th className="py-2 px-3 text-right w-24">Received</th>
                <th className="py-2 px-3 text-right w-24">Sent</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && <tr><td colSpan={7} className="py-10 text-center text-gray-500">Loading…</td></tr>}
              {!isLoading && items.length === 0 && (
                <tr><td colSpan={7} className="py-10 text-center text-gray-600">No SRUM network data — import a SrumECmd NetworkUsages CSV</td></tr>
              )}
              {items.map(r => (
                <tr key={r.id} className={`border-b border-white/5 hover:bg-white/[0.02] ${pinned.has(r.id) ? 'bg-accent-green/5' : ''}`}>
                  <td className="py-1.5 px-3"><PinBtn active={pinned.has(r.id)} onClick={e => { e.stopPropagation(); togglePin(r) }} /></td>
                  <td className="py-1.5 px-3 text-gray-400 tabular-nums font-mono">{dt(r.timestamp)}</td>
                  <td className="py-1.5 px-3 text-gray-200 font-mono max-w-[220px] truncate">{r.exe_info ?? '—'}</td>
                  <td className="py-1.5 px-3 text-gray-400 truncate">{r.user_name ?? '—'}</td>
                  <td className="py-1.5 px-3 text-gray-500 truncate">
                    {r.profile_name ?? '—'}
                    {r.interface_type && <span className="text-gray-600 ml-1">·{r.interface_type}</span>}
                  </td>
                  <td className="py-1.5 px-3 text-right text-blue-400 tabular-nums">{fmtBytes(r.bytes_received)}</td>
                  <td className="py-1.5 px-3 text-right text-orange-400 tabular-nums">{fmtBytes(r.bytes_sent)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <PinPanel count={pinned.size} onSend={sendToTimeline}>
        {[...pinned].map(id => {
          const r = items.find(x => x.id === id)
          return r ? (
            <div key={id} className="text-xs text-gray-400 bg-white/5 rounded px-2 py-1.5 font-mono truncate">
              {r.exe_info ?? '?'}
            </div>
          ) : null
        })}
      </PinPanel>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function SRUMAnalysis() {
  const { currentCase } = useCurrentCase()
  const [activeTab, setActiveTab] = useState<Tab>('app-usage')

  if (!currentCase) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center space-y-2">
          <div className="text-5xl opacity-10">📊</div>
          <p className="text-sm text-accent-muted/50">No current case selected</p>
          <p className="text-xs text-accent-muted/30">
            Set a current case from the Cases page to analyse SRUM data
          </p>
        </div>
      </div>
    )
  }

  const caseId = currentCase.id

  return (
    <div className="h-full flex flex-col">
      <div className="border-b border-white/10 px-6 py-3 shrink-0">
        <h2 className="text-white font-semibold text-base">SRUM Analysis</h2>
        <p className="text-xs text-gray-500 mt-0.5">
          System Resource Usage Monitor (SrumECmd) — <span className="font-mono text-accent-green/70">{currentCase.title}</span>
        </p>
      </div>

      <div className="flex border-b border-white/10 px-4 shrink-0 bg-[#0b121f]">
        {TABS.map(t => (
          <button
            key={t.id}
            className={`px-4 py-2.5 text-xs font-medium border-b-2 transition-colors ${
              activeTab === t.id
                ? 'border-accent-green text-accent-green'
                : 'border-transparent text-gray-500 hover:text-gray-300'
            }`}
            onClick={() => setActiveTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-hidden">
        {activeTab === 'app-usage' && <AppUsageTab caseId={caseId} />}
        {activeTab === 'network'   && <NetworkTab caseId={caseId} />}
      </div>
    </div>
  )
}
