import { useState, useCallback, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Search, ChevronLeft, ChevronRight, BookmarkPlus, BookmarkCheck,
  ChevronDown, ChevronRight as ChevronRightIcon, ArrowUpDown, Clock,
  Shield,
} from 'lucide-react'
import {
  registryApi, type RegistryFile, type RegistryEntry, type RegistrySummary,
} from '../../api/registry'
import { HiveBadge } from './RegistryFileList'
import { format } from 'date-fns'

interface Props {
  caseId:    string
  file:      RegistryFile
  pinnedIds: Set<string>
  onPin:     (entry: RegistryEntry, rowNum: number) => void
  onUnpin:   (key: string) => void
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtTs(s: string | null): string {
  if (!s) return '—'
  try { return format(new Date(s), 'yyyy-MM-dd HH:mm:ss') } catch { return s }
}

function fmtTsShort(s: string | null): string {
  if (!s) return '—'
  try { return format(new Date(s), 'MM-dd HH:mm:ss') } catch { return s }
}

// ── Value-type badge ──────────────────────────────────────────────────────────

const VT_COLORS: Record<string, string> = {
  REG_SZ:        'text-blue-400/80   bg-blue-500/10   border-blue-500/20',
  REG_EXPAND_SZ: 'text-cyan-400/80   bg-cyan-500/10   border-cyan-500/20',
  REG_MULTI_SZ:  'text-purple-400/80 bg-purple-500/10 border-purple-500/20',
  REG_DWORD:     'text-accent-green/80 bg-accent-green/10 border-accent-green/20',
  REG_QWORD:     'text-teal-400/80   bg-teal-500/10   border-teal-500/20',
  REG_BINARY:    'text-orange-400/80 bg-orange-500/10 border-orange-500/20',
  REG_NONE:      'text-white/25      bg-white/5       border-white/10',
}

function VtBadge({ type }: { type: string | null }) {
  if (!type) return null
  const key = type.toUpperCase()
  const cls = VT_COLORS[key] ?? 'text-white/30 bg-white/5 border-white/10'
  const short = key.replace('REG_', '')
  return (
    <span className={`text-[8px] font-mono px-1.5 py-0.5 rounded border whitespace-nowrap ${cls}`}>
      {short}
    </span>
  )
}

// ── Summary bar ───────────────────────────────────────────────────────────────

function SummaryBar({ s, file }: { s: RegistrySummary; file: RegistryFile }) {
  return (
    <div className="flex items-center gap-4 px-4 py-2 border-b border-white/5 bg-white/[0.01] flex-wrap text-[10px] text-accent-muted/60 shrink-0">
      <span>
        <span className="text-white/70 font-mono">{s.total_entries.toLocaleString()}</span>
        {' '}entries
      </span>
      {s.oldest_timestamp && (
        <>
          <span className="text-accent-muted/20">·</span>
          <span className="flex items-center gap-1">
            <Clock size={9} />
            {fmtTsShort(s.oldest_timestamp)}
            <span className="text-accent-muted/30">→</span>
            {fmtTsShort(s.newest_timestamp)}
          </span>
        </>
      )}
      {s.top_hive_types.length > 1 && (
        <>
          <span className="text-accent-muted/20">·</span>
          <div className="flex items-center gap-1">
            {s.top_hive_types.slice(0, 5).map(h => (
              <span key={h.hive_type} className="flex items-center gap-0.5">
                <HiveBadge type={h.hive_type} />
                <span className="text-accent-muted/30">{h.count.toLocaleString()}</span>
              </span>
            ))}
          </div>
        </>
      )}
      {s.top_value_types.length > 0 && (
        <>
          <span className="text-accent-muted/20">·</span>
          <div className="flex items-center gap-1">
            {s.top_value_types.slice(0, 4).map(v => (
              <span key={v.value_type} className="flex items-center gap-0.5">
                <VtBadge type={v.value_type} />
                <span className="text-accent-muted/30">{v.count.toLocaleString()}</span>
              </span>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

// ── Expanded row detail ───────────────────────────────────────────────────────

function ExpandedDetail({ entry, file }: { entry: RegistryEntry; file: RegistryFile }) {
  const fields: [string, string | null][] = [
    ['Timestamp',  entry.timestamp ? fmtTs(entry.timestamp) : null],
    ['Hive path',  entry.hive_path],
    ['Hive type',  entry.hive_type],
    ['Key path',   entry.key_path],
    ['Value name', entry.value_name],
    ['Value type', entry.value_type],
    ['Value data', entry.value_data],
    ['Deleted',    entry.deleted],
  ]

  const rawEntries = Object.entries(entry.raw_data)

  return (
    <div className="border-t border-white/5 bg-bg-secondary/30">
      {/* Normalized fields */}
      <div className="grid grid-cols-2 gap-x-4 px-10 py-2">
        {fields.filter(([, v]) => v).map(([k, v]) => (
          <div key={k} className="flex text-[9px] font-mono py-0.5">
            <span className="w-24 text-accent-muted/35 shrink-0">{k}</span>
            <span className="text-white/60 break-all">{v}</span>
          </div>
        ))}
      </div>
      {/* Raw CSV columns */}
      {rawEntries.length > 0 && (
        <div className="border-t border-white/5 px-10 py-2">
          <p className="text-[8px] font-semibold tracking-widest uppercase text-accent-muted/30 mb-1.5">
            Raw CSV columns
          </p>
          <div className="grid grid-cols-2 gap-x-4">
            {rawEntries.map(([col, val]) => (
              <div key={col} className="flex text-[9px] font-mono py-0.5">
                <span className="w-32 text-accent-muted/30 shrink-0 truncate" title={col}>{col}</span>
                <span className="text-white/50 break-all">{val}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Entry row ─────────────────────────────────────────────────────────────────

function EntryRow({
  entry, fileId, isPinned, onPin, onUnpin,
}: {
  entry:    RegistryEntry
  fileId:   string
  isPinned: boolean
  onPin:    () => void
  onUnpin:  () => void
}) {
  const [expanded, setExpanded] = useState(false)
  const key = `${fileId}:reg:${entry.row_num}`

  return (
    <>
      <tr
        className={`group border-b border-white/5 hover:bg-white/5 transition-colors cursor-pointer ${
          isPinned ? 'bg-accent-green/5' : ''
        }`}
        onClick={() => setExpanded(v => !v)}
      >
        {/* Pin */}
        <td
          className="w-8 pl-2 py-1.5 text-center shrink-0"
          onClick={ev => { ev.stopPropagation(); isPinned ? onUnpin() : onPin() }}
        >
          {isPinned
            ? <BookmarkCheck size={12} className="mx-auto text-accent-green/60" />
            : <BookmarkPlus  size={12} className="mx-auto text-accent-muted/20 group-hover:text-accent-muted/50 hover:!text-accent-green transition-colors" />
          }
        </td>

        {/* Timestamp */}
        <td className="px-2 py-1.5 text-[9px] font-mono text-accent-muted/50 whitespace-nowrap">
          {fmtTsShort(entry.timestamp)}
        </td>

        {/* Hive type (per-row, for BATCH exports) */}
        <td className="px-2 py-1.5">
          {entry.hive_type && <HiveBadge type={entry.hive_type} />}
        </td>

        {/* Key path */}
        <td className="px-2 py-1.5 text-[10px] font-mono text-white/70 max-w-0">
          <div className="truncate" title={entry.key_path ?? undefined}>
            {entry.key_path ?? '—'}
          </div>
        </td>

        {/* Value name */}
        <td className="px-2 py-1.5 text-[10px] font-mono text-accent-muted/70 whitespace-nowrap max-w-[160px]">
          <div className="truncate" title={entry.value_name ?? undefined}>
            {entry.value_name || <span className="text-accent-muted/25 italic">(default)</span>}
          </div>
        </td>

        {/* Value type */}
        <td className="px-2 py-1.5 whitespace-nowrap">
          <VtBadge type={entry.value_type} />
        </td>

        {/* Value data */}
        <td className="px-2 py-1.5 text-[10px] font-mono text-accent-muted/60 max-w-0">
          <div className="truncate" title={entry.value_data ?? undefined}>
            {entry.value_data ?? '—'}
          </div>
        </td>

        {/* Deleted */}
        <td className="px-2 py-1.5 text-center">
          {entry.deleted?.toLowerCase() === 'true' && (
            <span className="text-[8px] text-severity-critical font-mono">DEL</span>
          )}
        </td>

        {/* Expand chevron */}
        <td className="pr-2 py-1.5 text-center">
          {expanded
            ? <ChevronDown size={10} className="text-accent-muted/40 mx-auto" />
            : <ChevronRightIcon size={10} className="text-accent-muted/20 mx-auto group-hover:text-accent-muted/40" />
          }
        </td>
      </tr>

      {expanded && (
        <tr>
          <td colSpan={9}>
            <ExpandedDetail entry={entry} file={{} as any} />
          </td>
        </tr>
      )}
    </>
  )
}

// ── Main explorer ─────────────────────────────────────────────────────────────

export default function RegistryExplorer({ caseId, file, pinnedIds, onPin, onUnpin }: Props) {
  const qc = useQueryClient()
  const [search,    setSearch]    = useState('')
  const [searchQ,   setSearchQ]   = useState('')
  const [hiveType,  setHiveType]  = useState('')
  const [valueType, setValueType] = useState('')
  const [page,      setPage]      = useState(1)
  const [sortDir,   setSortDir]   = useState<'asc'|'desc'>('asc')
  const PAGE_SIZE = 200

  // Debounce search
  const applySearch = useCallback(() => {
    setSearchQ(search)
    setPage(1)
  }, [search])

  const { data: summary } = useQuery({
    queryKey: ['registry-summary', file.id],
    queryFn:  () => registryApi.summary(caseId, file.id),
    enabled:  file.status === 'ready',
  })

  const { data, isFetching } = useQuery({
    queryKey: ['registry-entries', file.id, page, searchQ, hiveType, valueType, sortDir],
    queryFn:  () => registryApi.entries(caseId, file.id, {
      page, page_size: PAGE_SIZE,
      search: searchQ, hive_type: hiveType, value_type: valueType, sort_dir: sortDir,
    }),
    enabled:     file.status === 'ready',
    placeholderData: prev => prev,
  })

  const addEvidence = useMutation({
    mutationFn: () => registryApi.addEvidence(caseId, file.id),
    onSuccess:  () => qc.invalidateQueries({ queryKey: ['registry-files', caseId] }),
  })

  const entries  = data?.items ?? []
  const total    = data?.total ?? 0
  const pages    = data?.pages ?? 1
  const hiveTypes  = useMemo(() => [...new Set(summary?.top_hive_types.map(h => h.hive_type) ?? [])], [summary])
  const valueTypes = useMemo(() => [...new Set(summary?.top_value_types.map(v => v.value_type) ?? [])], [summary])

  const handleFilter = (ht: string, vt: string) => {
    setHiveType(ht); setValueType(vt); setPage(1)
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">

      {/* ── Summary bar ──────────────────────────────────────────────── */}
      {summary && <SummaryBar s={summary} file={file} />}

      {/* ── Toolbar ──────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-white/5 shrink-0 flex-wrap">
        {/* Search */}
        <div className="flex items-center gap-1 bg-bg-secondary border border-white/10 rounded px-2 py-1 flex-1 min-w-36">
          <Search size={11} className="text-accent-muted/40 shrink-0" />
          <input
            className="bg-transparent flex-1 text-[11px] text-white placeholder:text-accent-muted/30 focus:outline-none"
            placeholder="Search key path, value name, data…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && applySearch()}
          />
          {search && (
            <button onClick={() => { setSearch(''); setSearchQ(''); setPage(1) }}
              className="text-accent-muted/30 hover:text-white">✕</button>
          )}
        </div>
        <button
          onClick={applySearch}
          className="px-2.5 py-1 rounded bg-accent-green/10 border border-accent-green/20 text-accent-green text-[10px] hover:bg-accent-green/15 transition-colors"
        >
          Search
        </button>

        {/* Hive type filter */}
        <select
          value={hiveType}
          onChange={e => handleFilter(e.target.value, valueType)}
          className="bg-bg-secondary border border-white/10 rounded px-2 py-1 text-[10px] text-white/70 focus:outline-none focus:border-accent-green/30"
        >
          <option value="">All hive types</option>
          {hiveTypes.map(h => <option key={h} value={h}>{h}</option>)}
        </select>

        {/* Value type filter */}
        <select
          value={valueType}
          onChange={e => handleFilter(hiveType, e.target.value)}
          className="bg-bg-secondary border border-white/10 rounded px-2 py-1 text-[10px] text-white/70 focus:outline-none focus:border-accent-green/30"
        >
          <option value="">All value types</option>
          {valueTypes.map(v => <option key={v} value={v}>{v}</option>)}
        </select>

        {/* Sort */}
        <button
          onClick={() => { setSortDir(d => d === 'asc' ? 'desc' : 'asc'); setPage(1) }}
          className="flex items-center gap-1 px-2 py-1 rounded border border-white/10 text-[9px] text-accent-muted/40 hover:text-white hover:border-white/20 transition-colors"
          title="Toggle sort direction"
        >
          <ArrowUpDown size={10} />
          {sortDir.toUpperCase()}
        </button>

        {/* Add to evidence */}
        <button
          onClick={() => addEvidence.mutate()}
          disabled={file.added_to_evidence || file.status !== 'ready' || addEvidence.isPending}
          className={`flex items-center gap-1 px-2 py-1 rounded border text-[9px] transition-colors ml-auto ${
            file.added_to_evidence
              ? 'border-accent-green/30 text-accent-green/60 bg-accent-green/5 cursor-default'
              : 'border-white/10 text-accent-muted/40 hover:border-accent-green/30 hover:text-accent-green hover:bg-accent-green/5'
          }`}
        >
          <Shield size={10} />
          {file.added_to_evidence ? 'In evidence' : 'Add to evidence'}
        </button>

        {/* Count + loading */}
        <span className={`text-[9px] text-accent-muted/30 transition-opacity ${isFetching ? 'opacity-60' : ''}`}>
          {total.toLocaleString()} {isFetching ? '…' : 'entries'}
        </span>
      </div>

      {/* ── Table ────────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-auto">
        <table className="w-full text-sm min-w-[900px]">
          <thead className="sticky top-0 z-10 bg-bg-secondary border-b border-white/5">
            <tr>
              <th className="w-8 pl-2" />
              <th className="px-2 py-1.5 text-left text-[9px] font-semibold tracking-widest uppercase text-accent-muted/40 whitespace-nowrap w-32">Timestamp</th>
              <th className="px-2 py-1.5 text-left text-[9px] font-semibold tracking-widest uppercase text-accent-muted/40 w-24">Hive</th>
              <th className="px-2 py-1.5 text-left text-[9px] font-semibold tracking-widest uppercase text-accent-muted/40">Key path</th>
              <th className="px-2 py-1.5 text-left text-[9px] font-semibold tracking-widest uppercase text-accent-muted/40 w-40">Value name</th>
              <th className="px-2 py-1.5 text-left text-[9px] font-semibold tracking-widest uppercase text-accent-muted/40 w-24">Type</th>
              <th className="px-2 py-1.5 text-left text-[9px] font-semibold tracking-widest uppercase text-accent-muted/40">Data</th>
              <th className="px-2 py-1.5 text-center text-[9px] font-semibold tracking-widest uppercase text-accent-muted/40 w-10">Del</th>
              <th className="w-6 pr-2" />
            </tr>
          </thead>
          <tbody>
            {entries.map(e => {
              const key = `${file.id}:reg:${e.row_num}`
              return (
                <EntryRow
                  key={key}
                  entry={e}
                  fileId={file.id}
                  isPinned={pinnedIds.has(key)}
                  onPin={() => onPin(e, e.row_num)}
                  onUnpin={() => onUnpin(key)}
                />
              )
            })}
          </tbody>
        </table>

        {entries.length === 0 && !isFetching && (
          <div className="flex items-center justify-center py-12">
            <p className="text-[11px] text-accent-muted/30">No entries match your filters</p>
          </div>
        )}
      </div>

      {/* ── Pagination ───────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-4 py-2 border-t border-white/5 shrink-0">
        <button
          disabled={page <= 1}
          onClick={() => setPage(p => p - 1)}
          className="flex items-center gap-1 px-2 py-1 rounded border border-white/10 text-[10px] text-accent-muted/40 hover:text-white disabled:opacity-30 transition-colors"
        >
          <ChevronLeft size={12} /> Prev
        </button>
        <span className="text-[9px] text-accent-muted/40 font-mono">
          Page {page} / {pages}
        </span>
        <button
          disabled={page >= pages}
          onClick={() => setPage(p => p + 1)}
          className="flex items-center gap-1 px-2 py-1 rounded border border-white/10 text-[10px] text-accent-muted/40 hover:text-white disabled:opacity-30 transition-colors"
        >
          Next <ChevronRight size={12} />
        </button>
      </div>
    </div>
  )
}
