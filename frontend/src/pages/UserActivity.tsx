import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { BookmarkPlus } from 'lucide-react'
import { useCurrentCase } from '../context/CurrentCaseContext'
import { timelineApi } from '../api/timeline'
import {
  lnkApi, jumpListApi, shellbagApi, recycleBinApi, windowsTimelineApi,
  type LnkEntry, type JumpListEntry, type ShellbagEntry,
  type RecycleBinEntry, type WindowsTimelineEntry,
} from '../api/ezUserActivity'

type Tab = 'lnk' | 'jump-lists' | 'shellbags' | 'recycle-bin' | 'windows-timeline'

const TABS: { id: Tab; label: string }[] = [
  { id: 'lnk',              label: 'LNK Files' },
  { id: 'jump-lists',       label: 'Jump Lists' },
  { id: 'shellbags',        label: 'Shellbags' },
  { id: 'recycle-bin',      label: 'Recycle Bin' },
  { id: 'windows-timeline', label: 'Windows Timeline' },
]

function dt(s: string | null) {
  if (!s) return '—'
  return new Date(s).toLocaleString()
}

function fmtBytes(n: number | null) {
  if (!n) return '—'
  if (n < 1024) return `${n} B`
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 ** 2).toFixed(1)} MB`
}

// ── Shared ────────────────────────────────────────────────────────────────────

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

function PinnedChip({ label }: { label: string }) {
  return (
    <div className="text-xs text-gray-400 bg-white/5 rounded px-2 py-1.5 font-mono truncate">
      {label}
    </div>
  )
}

// ── LNK Files tab ─────────────────────────────────────────────────────────────

function LnkTab({ caseId }: { caseId: string }) {
  const [search, setSearch] = useState('')
  const [pinned, setPinned] = useState<Set<number>>(new Set())
  const qc = useQueryClient()

  const { data, isLoading } = useQuery({
    queryKey: ['lnk', caseId, search],
    queryFn: () => lnkApi.list(caseId, { search, limit: 1000 }),
    placeholderData: prev => prev,
  })
  const items = data?.items ?? []

  function togglePin(r: LnkEntry) {
    setPinned(prev => { const n = new Set(prev); n.has(r.id) ? n.delete(r.id) : n.add(r.id); return n })
  }

  async function sendToTimeline() {
    for (const r of items.filter(x => pinned.has(x.id))) {
      const ts = r.source_modified || r.source_created
      if (!ts) continue
      await timelineApi.create(caseId, {
        case_id: caseId, event_ts: ts,
        title: r.target_path ?? r.local_path ?? r.source_file ?? 'LNK target',
        description: `LNK — Machine: ${r.machine_id ?? '?'} · MAC: ${r.mac_address ?? '?'}`,
        source: 'lnk', actor: '', tags: 'lnk',
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
            placeholder="Search path, machine ID…" className="input text-xs flex-1 max-w-sm" />
          <span className="text-xs text-gray-500 ml-auto">{data?.total?.toLocaleString() ?? 0} entries</span>
        </div>
        <div className="overflow-auto flex-1">
          <table className="w-full text-xs min-w-[900px]">
            <thead className="sticky top-0 bg-[#0b121f] z-10">
              <tr className="border-b border-white/10 text-gray-500 uppercase tracking-wide text-[10px]">
                <th className="py-2 px-3 w-8" />
                <th className="py-2 px-3 text-left w-36">Source Modified</th>
                <th className="py-2 px-3 text-left">Target / Local Path</th>
                <th className="py-2 px-3 text-left w-32">Network Path</th>
                <th className="py-2 px-3 text-left w-28">Machine ID</th>
                <th className="py-2 px-3 text-left w-28">MAC</th>
                <th className="py-2 px-3 text-right w-20">Size</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && <tr><td colSpan={7} className="py-10 text-center text-gray-500">Loading…</td></tr>}
              {!isLoading && items.length === 0 && <tr><td colSpan={7} className="py-10 text-center text-gray-600">No LNK data — import a LECmd CSV</td></tr>}
              {items.map(r => (
                <tr key={r.id} className={`border-b border-white/5 hover:bg-white/[0.02] ${pinned.has(r.id) ? 'bg-accent-green/5' : ''}`}>
                  <td className="py-1.5 px-3"><PinBtn active={pinned.has(r.id)} onClick={e => { e.stopPropagation(); togglePin(r) }} /></td>
                  <td className="py-1.5 px-3 text-gray-400 tabular-nums font-mono">{dt(r.source_modified)}</td>
                  <td className="py-1.5 px-3 text-gray-200 font-mono max-w-[280px] truncate">{r.target_path ?? r.local_path ?? '—'}</td>
                  <td className="py-1.5 px-3 text-gray-400 font-mono truncate max-w-[120px]">{r.network_path ?? '—'}</td>
                  <td className="py-1.5 px-3 text-gray-400">{r.machine_id ?? '—'}</td>
                  <td className="py-1.5 px-3 text-gray-400 font-mono">{r.mac_address ?? '—'}</td>
                  <td className="py-1.5 px-3 text-right text-gray-500">{fmtBytes(r.file_size)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <PinPanel count={pinned.size} onSend={sendToTimeline}>
        {[...pinned].map(id => {
          const r = items.find(x => x.id === id)
          return r ? <PinnedChip key={id} label={r.target_path ?? r.local_path ?? r.source_file ?? '?'} /> : null
        })}
      </PinPanel>
    </div>
  )
}

// ── Jump Lists tab ────────────────────────────────────────────────────────────

function JumpListsTab({ caseId }: { caseId: string }) {
  const [search, setSearch] = useState('')
  const [jlType, setJlType] = useState('')
  const [pinned, setPinned] = useState<Set<number>>(new Set())
  const qc = useQueryClient()

  const { data, isLoading } = useQuery({
    queryKey: ['jumplists', caseId, search, jlType],
    queryFn: () => jumpListApi.list(caseId, { search, jl_type: jlType, limit: 1000 }),
    placeholderData: prev => prev,
  })
  const items = data?.items ?? []

  function togglePin(r: JumpListEntry) {
    setPinned(prev => { const n = new Set(prev); n.has(r.id) ? n.delete(r.id) : n.add(r.id); return n })
  }

  async function sendToTimeline() {
    for (const r of items.filter(x => pinned.has(x.id))) {
      const ts = r.last_modified || r.creation_time
      if (!ts) continue
      await timelineApi.create(caseId, {
        case_id: caseId, event_ts: ts,
        title: r.path ?? r.local_path ?? r.target_path ?? 'Jump List entry',
        description: `Jump List (${r.jl_type ?? '?'}) — App: ${r.app_description ?? r.app_id ?? '?'}`,
        source: 'jumplists', actor: '', tags: 'jumplists',
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
            placeholder="Search path, app…" className="input text-xs flex-1 max-w-sm" />
          <select value={jlType} onChange={e => setJlType(e.target.value)} className="input text-xs w-36">
            <option value="">All types</option>
            <option value="automatic">Automatic</option>
            <option value="custom">Custom</option>
          </select>
          <span className="text-xs text-gray-500 ml-auto">{data?.total?.toLocaleString() ?? 0} entries</span>
        </div>
        <div className="overflow-auto flex-1">
          <table className="w-full text-xs min-w-[900px]">
            <thead className="sticky top-0 bg-[#0b121f] z-10">
              <tr className="border-b border-white/10 text-gray-500 uppercase tracking-wide text-[10px]">
                <th className="py-2 px-3 w-8" />
                <th className="py-2 px-3 text-left w-36">Last Modified</th>
                <th className="py-2 px-3 text-left">Path</th>
                <th className="py-2 px-3 text-left w-40">App Description</th>
                <th className="py-2 px-3 text-center w-20">Type</th>
                <th className="py-2 px-3 text-right w-16">Interactions</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && <tr><td colSpan={6} className="py-10 text-center text-gray-500">Loading…</td></tr>}
              {!isLoading && items.length === 0 && <tr><td colSpan={6} className="py-10 text-center text-gray-600">No Jump List data — import a JLECmd CSV</td></tr>}
              {items.map(r => (
                <tr key={r.id} className={`border-b border-white/5 hover:bg-white/[0.02] ${pinned.has(r.id) ? 'bg-accent-green/5' : ''}`}>
                  <td className="py-1.5 px-3"><PinBtn active={pinned.has(r.id)} onClick={e => { e.stopPropagation(); togglePin(r) }} /></td>
                  <td className="py-1.5 px-3 text-gray-400 tabular-nums font-mono">{dt(r.last_modified)}</td>
                  <td className="py-1.5 px-3 text-gray-200 font-mono max-w-[280px] truncate">{r.path ?? r.local_path ?? r.target_path ?? '—'}</td>
                  <td className="py-1.5 px-3 text-gray-400 truncate">{r.app_description ?? r.app_id ?? '—'}</td>
                  <td className="py-1.5 px-3 text-center text-gray-500">{r.jl_type ?? '—'}</td>
                  <td className="py-1.5 px-3 text-right text-gray-500">{r.interaction_count ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <PinPanel count={pinned.size} onSend={sendToTimeline}>
        {[...pinned].map(id => {
          const r = items.find(x => x.id === id)
          return r ? <PinnedChip key={id} label={r.path ?? r.app_description ?? '?'} /> : null
        })}
      </PinPanel>
    </div>
  )
}

// ── Shellbags tab ─────────────────────────────────────────────────────────────

function ShellbagsTab({ caseId }: { caseId: string }) {
  const [search, setSearch] = useState('')
  const [pinned, setPinned] = useState<Set<number>>(new Set())
  const qc = useQueryClient()

  const { data, isLoading } = useQuery({
    queryKey: ['shellbags', caseId, search],
    queryFn: () => shellbagApi.list(caseId, { search, limit: 1000 }),
    placeholderData: prev => prev,
  })
  const items = data?.items ?? []

  function togglePin(r: ShellbagEntry) {
    setPinned(prev => { const n = new Set(prev); n.has(r.id) ? n.delete(r.id) : n.add(r.id); return n })
  }

  async function sendToTimeline() {
    for (const r of items.filter(x => pinned.has(x.id))) {
      const ts = r.last_interacted || r.last_write_time
      if (!ts) continue
      await timelineApi.create(caseId, {
        case_id: caseId, event_ts: ts,
        title: r.absolute_path ?? r.bag_path ?? 'Shellbag entry',
        description: `Shellbag — Type: ${r.shell_type ?? '?'} · Hive: ${r.hive_source ?? '?'}`,
        source: 'shellbags', actor: '', tags: 'shellbags',
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
            placeholder="Search path…" className="input text-xs flex-1 max-w-sm" />
          <span className="text-xs text-gray-500 ml-auto">{data?.total?.toLocaleString() ?? 0} entries</span>
        </div>
        <div className="overflow-auto flex-1">
          <table className="w-full text-xs min-w-[900px]">
            <thead className="sticky top-0 bg-[#0b121f] z-10">
              <tr className="border-b border-white/10 text-gray-500 uppercase tracking-wide text-[10px]">
                <th className="py-2 px-3 w-8" />
                <th className="py-2 px-3 text-left w-36">Last Interacted</th>
                <th className="py-2 px-3 text-left">Absolute Path</th>
                <th className="py-2 px-3 text-left w-32">Shell Type</th>
                <th className="py-2 px-3 text-left w-24">Hive</th>
                <th className="py-2 px-3 text-left w-36">Last Write</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && <tr><td colSpan={6} className="py-10 text-center text-gray-500">Loading…</td></tr>}
              {!isLoading && items.length === 0 && <tr><td colSpan={6} className="py-10 text-center text-gray-600">No Shellbag data — import a SBECmd CSV</td></tr>}
              {items.map(r => (
                <tr key={r.id} className={`border-b border-white/5 hover:bg-white/[0.02] ${pinned.has(r.id) ? 'bg-accent-green/5' : ''}`}>
                  <td className="py-1.5 px-3"><PinBtn active={pinned.has(r.id)} onClick={e => { e.stopPropagation(); togglePin(r) }} /></td>
                  <td className="py-1.5 px-3 text-gray-400 tabular-nums font-mono">{dt(r.last_interacted)}</td>
                  <td className="py-1.5 px-3 text-gray-200 font-mono max-w-[300px] truncate">{r.absolute_path ?? '—'}</td>
                  <td className="py-1.5 px-3 text-gray-400">{r.shell_type ?? '—'}</td>
                  <td className="py-1.5 px-3 text-gray-500">{r.hive_source ?? '—'}</td>
                  <td className="py-1.5 px-3 text-gray-400 tabular-nums font-mono">{dt(r.last_write_time)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <PinPanel count={pinned.size} onSend={sendToTimeline}>
        {[...pinned].map(id => {
          const r = items.find(x => x.id === id)
          return r ? <PinnedChip key={id} label={r.absolute_path ?? r.bag_path ?? '?'} /> : null
        })}
      </PinPanel>
    </div>
  )
}

// ── Recycle Bin tab ───────────────────────────────────────────────────────────

function RecycleBinTab({ caseId }: { caseId: string }) {
  const [search, setSearch] = useState('')
  const [pinned, setPinned] = useState<Set<number>>(new Set())
  const qc = useQueryClient()

  const { data, isLoading } = useQuery({
    queryKey: ['recycle-bin', caseId, search],
    queryFn: () => recycleBinApi.list(caseId, { search, limit: 1000 }),
    placeholderData: prev => prev,
  })
  const items = data?.items ?? []

  function togglePin(r: RecycleBinEntry) {
    setPinned(prev => { const n = new Set(prev); n.has(r.id) ? n.delete(r.id) : n.add(r.id); return n })
  }

  async function sendToTimeline() {
    for (const r of items.filter(x => pinned.has(x.id))) {
      if (!r.deleted_on) continue
      await timelineApi.create(caseId, {
        case_id: caseId, event_ts: r.deleted_on,
        title: r.file_name ?? 'Deleted file',
        description: `Recycle Bin — Type: ${r.file_type ?? '?'} · SID: ${r.sid ?? '?'} · Size: ${fmtBytes(r.file_size)}`,
        source: 'recycle_bin', actor: '', tags: 'recycle-bin',
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
            placeholder="Search filename…" className="input text-xs flex-1 max-w-sm" />
          <span className="text-xs text-gray-500 ml-auto">{data?.total?.toLocaleString() ?? 0} entries</span>
        </div>
        <div className="overflow-auto flex-1">
          <table className="w-full text-xs min-w-[700px]">
            <thead className="sticky top-0 bg-[#0b121f] z-10">
              <tr className="border-b border-white/10 text-gray-500 uppercase tracking-wide text-[10px]">
                <th className="py-2 px-3 w-8" />
                <th className="py-2 px-3 text-left w-36">Deleted On</th>
                <th className="py-2 px-3 text-left">File Name</th>
                <th className="py-2 px-3 text-left w-24">Type</th>
                <th className="py-2 px-3 text-right w-20">Size</th>
                <th className="py-2 px-3 text-left">SID</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && <tr><td colSpan={6} className="py-10 text-center text-gray-500">Loading…</td></tr>}
              {!isLoading && items.length === 0 && <tr><td colSpan={6} className="py-10 text-center text-gray-600">No Recycle Bin data — import a RBCmd CSV</td></tr>}
              {items.map(r => (
                <tr key={r.id} className={`border-b border-white/5 hover:bg-white/[0.02] ${pinned.has(r.id) ? 'bg-accent-green/5' : ''}`}>
                  <td className="py-1.5 px-3"><PinBtn active={pinned.has(r.id)} onClick={e => { e.stopPropagation(); togglePin(r) }} /></td>
                  <td className="py-1.5 px-3 text-red-400/80 tabular-nums font-mono">{dt(r.deleted_on)}</td>
                  <td className="py-1.5 px-3 text-gray-200 font-mono max-w-[300px] truncate">{r.file_name ?? '—'}</td>
                  <td className="py-1.5 px-3 text-gray-400">{r.file_type ?? '—'}</td>
                  <td className="py-1.5 px-3 text-right text-gray-500">{fmtBytes(r.file_size)}</td>
                  <td className="py-1.5 px-3 text-gray-500 font-mono text-[10px]">{r.sid ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <PinPanel count={pinned.size} onSend={sendToTimeline}>
        {[...pinned].map(id => {
          const r = items.find(x => x.id === id)
          return r ? <PinnedChip key={id} label={r.file_name ?? '?'} /> : null
        })}
      </PinPanel>
    </div>
  )
}

// ── Windows Timeline tab ──────────────────────────────────────────────────────

function WindowsTimelineTab({ caseId }: { caseId: string }) {
  const [search, setSearch] = useState('')
  const [pinned, setPinned] = useState<Set<number>>(new Set())
  const qc = useQueryClient()

  const { data, isLoading } = useQuery({
    queryKey: ['windows-timeline', caseId, search],
    queryFn: () => windowsTimelineApi.list(caseId, { search, limit: 1000 }),
    placeholderData: prev => prev,
  })
  const items = data?.items ?? []

  function togglePin(r: WindowsTimelineEntry) {
    setPinned(prev => { const n = new Set(prev); n.has(r.id) ? n.delete(r.id) : n.add(r.id); return n })
  }

  async function sendToTimeline() {
    for (const r of items.filter(x => pinned.has(x.id))) {
      const ts = r.start_time || r.last_modified
      if (!ts) continue
      await timelineApi.create(caseId, {
        case_id: caseId, event_ts: ts,
        title: r.display_text ?? r.executable ?? 'Windows Timeline entry',
        description: `Windows Timeline — Type: ${r.activity_type ?? '?'} · Platform: ${r.platform ?? '?'}`,
        source: 'windows_timeline', actor: '', tags: 'windows-timeline',
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
            placeholder="Search exe, display text…" className="input text-xs flex-1 max-w-sm" />
          <span className="text-xs text-gray-500 ml-auto">{data?.total?.toLocaleString() ?? 0} entries</span>
        </div>
        <div className="overflow-auto flex-1">
          <table className="w-full text-xs min-w-[900px]">
            <thead className="sticky top-0 bg-[#0b121f] z-10">
              <tr className="border-b border-white/10 text-gray-500 uppercase tracking-wide text-[10px]">
                <th className="py-2 px-3 w-8" />
                <th className="py-2 px-3 text-left w-36">Start Time</th>
                <th className="py-2 px-3 text-left">Executable</th>
                <th className="py-2 px-3 text-left">Display Text</th>
                <th className="py-2 px-3 text-left w-28">Activity Type</th>
                <th className="py-2 px-3 text-left w-24">Duration</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && <tr><td colSpan={6} className="py-10 text-center text-gray-500">Loading…</td></tr>}
              {!isLoading && items.length === 0 && <tr><td colSpan={6} className="py-10 text-center text-gray-600">No Windows Timeline data — import a WxTCmd CSV</td></tr>}
              {items.map(r => (
                <tr key={r.id} className={`border-b border-white/5 hover:bg-white/[0.02] ${pinned.has(r.id) ? 'bg-accent-green/5' : ''}`}>
                  <td className="py-1.5 px-3"><PinBtn active={pinned.has(r.id)} onClick={e => { e.stopPropagation(); togglePin(r) }} /></td>
                  <td className="py-1.5 px-3 text-gray-400 tabular-nums font-mono">{dt(r.start_time)}</td>
                  <td className="py-1.5 px-3 text-gray-200 font-mono max-w-[200px] truncate">{r.executable ?? '—'}</td>
                  <td className="py-1.5 px-3 text-gray-400 max-w-[200px] truncate">{r.display_text ?? '—'}</td>
                  <td className="py-1.5 px-3 text-gray-500">{r.activity_type ?? '—'}</td>
                  <td className="py-1.5 px-3 text-gray-500">{r.duration ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <PinPanel count={pinned.size} onSend={sendToTimeline}>
        {[...pinned].map(id => {
          const r = items.find(x => x.id === id)
          return r ? <PinnedChip key={id} label={r.display_text ?? r.executable ?? '?'} /> : null
        })}
      </PinPanel>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function UserActivity() {
  const { currentCase } = useCurrentCase()
  const [activeTab, setActiveTab] = useState<Tab>('lnk')

  if (!currentCase) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center space-y-2">
          <div className="text-5xl opacity-10">👤</div>
          <p className="text-sm text-accent-muted/50">No current case selected</p>
          <p className="text-xs text-accent-muted/30">
            Set a current case from the Cases page to analyse user activity artifacts
          </p>
        </div>
      </div>
    )
  }

  const caseId = currentCase.id

  return (
    <div className="h-full flex flex-col">
      <div className="border-b border-white/10 px-6 py-3 shrink-0">
        <h2 className="text-white font-semibold text-base">User Activity</h2>
        <p className="text-xs text-gray-500 mt-0.5">
          LNK (LECmd) · Jump Lists (JLECmd) · Shellbags (SBECmd) · Recycle Bin (RBCmd) · Windows Timeline (WxTCmd)
          {' '}— <span className="font-mono text-accent-green/70">{currentCase.title}</span>
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
        {activeTab === 'lnk'              && <LnkTab caseId={caseId} />}
        {activeTab === 'jump-lists'       && <JumpListsTab caseId={caseId} />}
        {activeTab === 'shellbags'        && <ShellbagsTab caseId={caseId} />}
        {activeTab === 'recycle-bin'      && <RecycleBinTab caseId={caseId} />}
        {activeTab === 'windows-timeline' && <WindowsTimelineTab caseId={caseId} />}
      </div>
    </div>
  )
}
