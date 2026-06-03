import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { BookmarkPlus } from 'lucide-react'
import { shimcacheApi, amcacheApi } from '../api/ezExecution'
import type { ShimcacheEntry, AmcacheFileEntry, AmcacheProgramEntry } from '../api/ezExecution'
import { timelineApi } from '../api/timeline'
import { useCurrentCase } from '../context/CurrentCaseContext'

type Tab = 'shimcache' | 'amcache-files' | 'amcache-programs'

const TABS: { id: Tab; label: string }[] = [
  { id: 'shimcache',         label: 'Shimcache' },
  { id: 'amcache-files',    label: 'Amcache — Files' },
  { id: 'amcache-programs', label: 'Amcache — Programs' },
]

const EXEC_COLOR: Record<string, string> = {
  Yes: 'text-red-400 font-semibold',
  No:  'text-gray-500',
  NA:  'text-gray-600',
}

function dt(s: string | null) {
  if (!s) return '—'
  return new Date(s).toLocaleString()
}

// ── Shared pin-button ─────────────────────────────────────────────────────────

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

// ── Shared right panel ────────────────────────────────────────────────────────

function PinPanel({
  count,
  onSend,
  children,
}: {
  count: number
  onSend: () => void
  children: React.ReactNode
}) {
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

// ── Shimcache tab ─────────────────────────────────────────────────────────────

function ShimcacheTab({ caseId }: { caseId: string }) {
  const [search, setSearch]   = useState('')
  const [executed, setExecuted] = useState('')
  const [pinned, setPinned]   = useState<Set<number>>(new Set())
  const qc = useQueryClient()

  const { data, isLoading } = useQuery({
    queryKey: ['shimcache', caseId, search, executed],
    queryFn: () => shimcacheApi.list(caseId, { search, executed, limit: 1000 }),
    placeholderData: prev => prev,
  })

  const items = data?.items ?? []

  function togglePin(r: ShimcacheEntry) {
    setPinned(prev => {
      const next = new Set(prev)
      next.has(r.id) ? next.delete(r.id) : next.add(r.id)
      return next
    })
  }

  async function sendToTimeline() {
    for (const r of items.filter(x => pinned.has(x.id))) {
      if (!r.last_modified) continue
      await timelineApi.create(caseId, {
        case_id: caseId,
        event_ts: r.last_modified,
        title: r.path ?? 'Unknown path',
        description: `Shimcache — Position ${r.cache_position ?? '?'} — Executed: ${r.executed ?? 'NA'}`,
        source: 'shimcache',
        actor: '',
        tags: 'shimcache',
      })
    }
    qc.invalidateQueries({ queryKey: ['timeline', caseId] })
    setPinned(new Set())
  }

  return (
    <div className="flex h-full">
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <div className="flex items-center gap-3 px-4 py-2 border-b border-white/10 shrink-0">
          <input
            value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search path…" className="input text-xs flex-1 max-w-sm"
          />
          <select value={executed} onChange={e => setExecuted(e.target.value)} className="input text-xs w-36">
            <option value="">All executed</option>
            <option value="Yes">Yes</option>
            <option value="No">No</option>
            <option value="NA">NA</option>
          </select>
          <span className="text-xs text-gray-500 ml-auto">{data?.total?.toLocaleString() ?? 0} entries</span>
        </div>
        <div className="overflow-auto flex-1">
          <table className="w-full text-xs min-w-[700px]">
            <thead className="sticky top-0 bg-[#0b121f] z-10">
              <tr className="border-b border-white/10 text-gray-500 uppercase tracking-wide text-[10px]">
                <th className="py-2 px-3 w-8" />
                <th className="py-2 px-3 text-right w-16">Pos.</th>
                <th className="py-2 px-3 text-left">Path</th>
                <th className="py-2 px-3 text-left w-40">Last Modified (UTC)</th>
                <th className="py-2 px-3 text-center w-20">Executed</th>
                <th className="py-2 px-3 text-right w-16">CtrlSet</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && <tr><td colSpan={6} className="py-10 text-center text-gray-500">Loading…</td></tr>}
              {!isLoading && items.length === 0 && (
                <tr><td colSpan={6} className="py-10 text-center text-gray-600">No Shimcache data — import an AppCompatCache CSV</td></tr>
              )}
              {items.map(r => (
                <tr key={r.id} className={`border-b border-white/5 hover:bg-white/[0.02] ${pinned.has(r.id) ? 'bg-accent-green/5' : ''}`}>
                  <td className="py-1.5 px-3">
                    <PinBtn active={pinned.has(r.id)} onClick={e => { e.stopPropagation(); togglePin(r) }} />
                  </td>
                  <td className="py-1.5 px-3 text-right text-gray-400 font-mono">{r.cache_position ?? '—'}</td>
                  <td className="py-1.5 px-3 text-gray-200 font-mono max-w-[400px] truncate">{r.path ?? '—'}</td>
                  <td className="py-1.5 px-3 text-gray-400 font-mono tabular-nums">{dt(r.last_modified)}</td>
                  <td className={`py-1.5 px-3 text-center ${EXEC_COLOR[r.executed ?? 'NA'] ?? 'text-gray-500'}`}>
                    {r.executed ?? '—'}
                  </td>
                  <td className="py-1.5 px-3 text-right text-gray-500">{r.control_set ?? '—'}</td>
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
              {r.path?.split('\\').pop() ?? r.path}
            </div>
          ) : null
        })}
      </PinPanel>
    </div>
  )
}

// ── Amcache Files tab ─────────────────────────────────────────────────────────

function AmcacheFilesTab({ caseId }: { caseId: string }) {
  const [search, setSearch]       = useState('')
  const [entryType, setEntryType] = useState('')
  const [pinned, setPinned]       = useState<Set<number>>(new Set())
  const qc = useQueryClient()

  const { data, isLoading } = useQuery({
    queryKey: ['amcache-files', caseId, search, entryType],
    queryFn: () => amcacheApi.listFiles(caseId, { search, entry_type: entryType, limit: 1000 }),
    placeholderData: prev => prev,
  })

  const items = data?.items ?? []

  function togglePin(r: AmcacheFileEntry) {
    setPinned(prev => { const next = new Set(prev); next.has(r.id) ? next.delete(r.id) : next.add(r.id); return next })
  }

  async function sendToTimeline() {
    for (const r of items.filter(x => pinned.has(x.id))) {
      const ts = r.file_key_last_write || r.link_date
      if (!ts) continue
      await timelineApi.create(caseId, {
        case_id: caseId, event_ts: ts,
        title: r.full_path ?? r.name ?? 'Unknown',
        description: `Amcache — SHA1: ${r.sha1 ?? 'N/A'} · ${r.product_name ?? ''}`,
        source: 'amcache', actor: '', tags: 'amcache',
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
            placeholder="Search path, SHA1, product…" className="input text-xs flex-1 max-w-sm" />
          <select value={entryType} onChange={e => setEntryType(e.target.value)} className="input text-xs w-36">
            <option value="">All types</option>
            <option value="unassociated">Unassociated</option>
            <option value="associated">Associated</option>
          </select>
          <span className="text-xs text-gray-500 ml-auto">{data?.total?.toLocaleString() ?? 0} entries</span>
        </div>
        <div className="overflow-auto flex-1">
          <table className="w-full text-xs min-w-[800px]">
            <thead className="sticky top-0 bg-[#0b121f] z-10">
              <tr className="border-b border-white/10 text-gray-500 uppercase tracking-wide text-[10px]">
                <th className="py-2 px-3 w-8" />
                <th className="py-2 px-3 text-left">Path / Name</th>
                <th className="py-2 px-3 text-left w-36">SHA1</th>
                <th className="py-2 px-3 text-left w-32">Key Write (UTC)</th>
                <th className="py-2 px-3 text-left w-24">Version</th>
                <th className="py-2 px-3 text-left w-32">Product</th>
                <th className="py-2 px-3 text-right w-16">Size</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && <tr><td colSpan={7} className="py-10 text-center text-gray-500">Loading…</td></tr>}
              {!isLoading && items.length === 0 && <tr><td colSpan={7} className="py-10 text-center text-gray-600">No Amcache file data</td></tr>}
              {items.map(r => (
                <tr key={r.id} className={`border-b border-white/5 hover:bg-white/[0.02] ${pinned.has(r.id) ? 'bg-accent-green/5' : ''}`}>
                  <td className="py-1.5 px-3">
                    <PinBtn active={pinned.has(r.id)} onClick={e => { e.stopPropagation(); togglePin(r) }} />
                  </td>
                  <td className="py-1.5 px-3 text-gray-200 font-mono max-w-[280px] truncate">{r.full_path ?? r.name ?? '—'}</td>
                  <td className="py-1.5 px-3 text-purple-400 font-mono text-[10px] truncate">{r.sha1 ?? '—'}</td>
                  <td className="py-1.5 px-3 text-gray-400 tabular-nums">{dt(r.file_key_last_write)}</td>
                  <td className="py-1.5 px-3 text-gray-400">{r.version ?? '—'}</td>
                  <td className="py-1.5 px-3 text-gray-400 truncate max-w-[120px]">{r.product_name ?? '—'}</td>
                  <td className="py-1.5 px-3 text-right text-gray-500">{r.size ? `${(r.size / 1024).toFixed(0)} KB` : '—'}</td>
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
              {r.name ?? r.full_path}
            </div>
          ) : null
        })}
      </PinPanel>
    </div>
  )
}

// ── Amcache Programs tab ──────────────────────────────────────────────────────

function AmcacheProgramsTab({ caseId }: { caseId: string }) {
  const [search, setSearch] = useState('')

  const { data, isLoading } = useQuery({
    queryKey: ['amcache-programs', caseId, search],
    queryFn: () => amcacheApi.listPrograms(caseId, { search, limit: 1000 }),
    placeholderData: prev => prev,
  })

  const items = data?.items ?? []

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="flex items-center gap-3 px-4 py-2 border-b border-white/10">
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search name, publisher…" className="input text-xs flex-1 max-w-sm" />
        <span className="text-xs text-gray-500 ml-auto">{data?.total?.toLocaleString() ?? 0} programs</span>
      </div>
      <div className="overflow-auto flex-1">
        <table className="w-full text-xs min-w-[700px]">
          <thead className="sticky top-0 bg-[#0b121f] z-10">
            <tr className="border-b border-white/10 text-gray-500 uppercase tracking-wide text-[10px]">
              <th className="py-2 px-3 text-left">Name</th>
              <th className="py-2 px-3 text-left">Publisher</th>
              <th className="py-2 px-3 text-left w-28">Version</th>
              <th className="py-2 px-3 text-left w-36">Install Date</th>
              <th className="py-2 px-3 text-left w-36">Key Write (UTC)</th>
              <th className="py-2 px-3 text-left">Install Path</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && <tr><td colSpan={6} className="py-10 text-center text-gray-500">Loading…</td></tr>}
            {!isLoading && items.length === 0 && <tr><td colSpan={6} className="py-10 text-center text-gray-600">No Amcache program data</td></tr>}
            {items.map(r => (
              <tr key={r.id} className="border-b border-white/5 hover:bg-white/[0.02]">
                <td className="py-1.5 px-3 text-gray-200">{r.name ?? '—'}</td>
                <td className="py-1.5 px-3 text-gray-400">{r.publisher ?? '—'}</td>
                <td className="py-1.5 px-3 text-gray-400">{r.version ?? '—'}</td>
                <td className="py-1.5 px-3 text-gray-400 tabular-nums">{dt(r.install_date)}</td>
                <td className="py-1.5 px-3 text-gray-400 tabular-nums">{dt(r.key_last_write)}</td>
                <td className="py-1.5 px-3 text-gray-500 font-mono truncate max-w-[200px]">{r.root_dir_path ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function ExecutionArtifacts() {
  const { currentCase } = useCurrentCase()
  const [activeTab, setActiveTab] = useState<Tab>('shimcache')

  if (!currentCase) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center space-y-2">
          <div className="text-5xl opacity-10">⚡</div>
          <p className="text-sm text-accent-muted/50">No current case selected</p>
          <p className="text-xs text-accent-muted/30">
            Set a current case from the Cases page to analyse execution artifacts
          </p>
        </div>
      </div>
    )
  }

  const caseId = currentCase.id

  return (
    <div className="h-full flex flex-col">
      <div className="border-b border-white/10 px-6 py-3 shrink-0">
        <h2 className="text-white font-semibold text-base">Execution Artifacts</h2>
        <p className="text-xs text-gray-500 mt-0.5">
          Shimcache (AppCompatCacheParser) · Amcache (AmcacheParser) — case: <span className="font-mono text-accent-green/70">{currentCase.title}</span>
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
        {activeTab === 'shimcache'         && <ShimcacheTab caseId={caseId} />}
        {activeTab === 'amcache-files'    && <AmcacheFilesTab caseId={caseId} />}
        {activeTab === 'amcache-programs' && <AmcacheProgramsTab caseId={caseId} />}
      </div>
    </div>
  )
}
