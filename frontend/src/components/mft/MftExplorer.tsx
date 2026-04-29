import { useState, useCallback } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Search, ChevronLeft, ChevronRight, Folder, FileText,
  AlertTriangle, Filter, X, ArrowUpDown, BookmarkPlus, BookmarkCheck,
} from 'lucide-react'
import { mftApi, type MftEntry, type MftSummary } from '../../api/mft'
import { format } from 'date-fns'

interface Props {
  caseId:    string
  fileId:    string
  filename:  string
  pinnedIds: Set<string>
  onPin:     (e: MftEntry) => void
  onUnpin:   (key: string) => void
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtBytes(n: number | null): string {
  if (n === null || n === undefined) return '—'
  if (n === 0) return '0 B'
  if (n < 1024) return `${n} B`
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`
  return `${(n / 1024 ** 3).toFixed(2)} GB`
}

function fmtTs(s: string | null): string {
  if (!s) return '—'
  try { return format(new Date(s), 'yyyy-MM-dd HH:mm:ss') } catch { return s }
}

function fmtTsShort(s: string | null): string {
  if (!s) return '—'
  try { return format(new Date(s), 'MM-dd HH:mm:ss') } catch { return s }
}

// ── Time-field selector ───────────────────────────────────────────────────────

const TIME_FIELDS = [
  { value: 'si_created',     label: 'SI Created'      },
  { value: 'si_modified',    label: 'SI Modified'     },
  { value: 'si_accessed',    label: 'SI Accessed'     },
  { value: 'si_mft_changed', label: 'SI MFT Changed'  },
  { value: 'fn_created',     label: 'FN Created'      },
  { value: 'fn_modified',    label: 'FN Modified'     },
]

// ── Flag toggle button ────────────────────────────────────────────────────────

function FlagBtn({
  label, active, onClick, color = 'accent-green',
}: { label: string; active: boolean; onClick: () => void; color?: string }) {
  return (
    <button
      onClick={onClick}
      className={`text-[9px] px-2 py-0.5 rounded border transition-colors ${
        active
          ? `bg-${color}/10 border-${color}/30 text-${color}`
          : 'border-white/10 text-accent-muted/50 hover:text-white hover:border-white/20'
      }`}
    >
      {label}
    </button>
  )
}

// ── Summary bar ───────────────────────────────────────────────────────────────

function SummaryBar({ s }: { s: MftSummary }) {
  return (
    <div className="flex items-center gap-4 px-4 py-2 border-b border-white/5 bg-white/[0.01] flex-wrap text-[10px] text-accent-muted/60 shrink-0">
      <span><span className="text-white/70 font-mono">{s.total_entries.toLocaleString()}</span> entries</span>
      <span className="text-severity-critical/60"><span className="font-mono">{s.deleted_count.toLocaleString()}</span> deleted</span>
      <span><span className="font-mono">{s.directory_count.toLocaleString()}</span> dirs</span>
      <span><span className="font-mono">{s.file_count.toLocaleString()}</span> files</span>
      {s.oldest_si_modified && (
        <span className="ml-auto">
          {fmtTs(s.oldest_si_modified)} → {fmtTs(s.newest_si_modified)}
        </span>
      )}
    </div>
  )
}

// ── Entry row ─────────────────────────────────────────────────────────────────

function EntryRow({
  e, fileId, isPinned, onPin, onUnpin,
}: {
  e: MftEntry; fileId: string; isPinned: boolean
  onPin: (e: MftEntry) => void; onUnpin: (key: string) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const key = `${fileId}:mft:${e.entry_number}`

  return (
    <>
      <tr
        onClick={() => setExpanded(x => !x)}
        className="border-b border-white/[0.04] hover:bg-white/[0.03] cursor-pointer transition-colors group"
      >
        {/* Pin button */}
        <td
          className="w-8 pl-2 py-1.5 text-center shrink-0"
          onClick={ev => { ev.stopPropagation(); isPinned ? onUnpin(key) : onPin(e) }}
        >
          {isPinned
            ? <BookmarkCheck size={12} className="mx-auto text-accent-green/60" title="Remove from selection" />
            : <BookmarkPlus  size={12} className="mx-auto text-accent-muted/20 group-hover:text-accent-muted/50 hover:!text-accent-green transition-colors" title="Add to selection" />
          }
        </td>

        {/* Filename + path */}
        <td className="px-2 py-1.5 max-w-[240px]">
          <div className="flex items-center gap-1.5">
            {e.is_directory
              ? <Folder   size={11} className="text-blue-400/60 shrink-0" />
              : <FileText size={11} className="text-accent-muted/30 shrink-0" />
            }
            <span className={`text-xs font-mono truncate ${e.is_deleted ? 'line-through text-white/30' : 'text-white/80'}`}>
              {e.filename ?? '—'}
            </span>
            {e.has_ts_anomaly && (
              <AlertTriangle size={9} className="text-yellow-400/70 shrink-0" title="Timestamp anomaly: SI < FN (possible timestomping)" />
            )}
          </div>
          {e.parent_path && (
            <p className="text-[9px] text-accent-muted/30 font-mono truncate mt-0.5" title={e.parent_path}>
              {e.parent_path}
            </p>
          )}
          {/* Badges */}
          <div className="flex gap-1 mt-0.5 flex-wrap">
            {e.is_deleted && <span className="text-[8px] px-1 rounded bg-severity-critical/10 text-severity-critical/70 border border-severity-critical/20">deleted</span>}
            {!e.is_in_use && !e.is_deleted && <span className="text-[8px] px-1 rounded bg-white/5 text-accent-muted/40 border border-white/8">unused</span>}
          </div>
        </td>

        {/* SI Created */}
        <td className="px-2 py-1.5 text-[10px] font-mono text-white/50 whitespace-nowrap">{fmtTsShort(e.si_created)}</td>
        {/* SI Modified */}
        <td className="px-2 py-1.5 text-[10px] font-mono text-white/50 whitespace-nowrap">{fmtTsShort(e.si_modified)}</td>
        {/* SI Accessed */}
        <td className="px-2 py-1.5 text-[10px] font-mono text-white/40 whitespace-nowrap">{fmtTsShort(e.si_accessed)}</td>
        {/* MFT Changed */}
        <td className="px-2 py-1.5 text-[10px] font-mono text-white/40 whitespace-nowrap">{fmtTsShort(e.si_mft_changed)}</td>

        {/* Size */}
        <td className="px-2 py-1.5 text-[10px] font-mono text-accent-muted/50 text-right whitespace-nowrap pr-4">
          {e.is_directory ? '—' : fmtBytes(e.file_size)}
        </td>
      </tr>

      {/* Expanded detail */}
      {expanded && (
        <tr className="border-b border-white/5 bg-white/[0.015]">
          <td colSpan={7} className="px-6 py-3">
            <div className="grid grid-cols-2 gap-x-8 gap-y-1 text-[10px]">
              <div className="space-y-1">
                <p className="text-[9px] uppercase tracking-widest text-accent-muted/40 mb-1.5">$STANDARD_INFORMATION</p>
                <Row label="Created"     value={fmtTs(e.si_created)}     />
                <Row label="Modified"    value={fmtTs(e.si_modified)}    />
                <Row label="Accessed"    value={fmtTs(e.si_accessed)}    />
                <Row label="MFT Changed" value={fmtTs(e.si_mft_changed)} />
              </div>
              <div className="space-y-1">
                <p className="text-[9px] uppercase tracking-widest text-accent-muted/40 mb-1.5">
                  $FILE_NAME
                  {e.has_ts_anomaly && (
                    <span className="ml-2 text-yellow-400/70 normal-case">⚠ SI &lt; FN</span>
                  )}
                </p>
                <Row label="Created"     value={fmtTs(e.fn_created)}     anomaly={e.has_ts_anomaly} />
                <Row label="Modified"    value={fmtTs(e.fn_modified)}    />
                <Row label="Accessed"    value={fmtTs(e.fn_accessed)}    />
                <Row label="MFT Changed" value={fmtTs(e.fn_mft_changed)} />
              </div>
              <div className="col-span-2 flex gap-6 mt-2 pt-2 border-t border-white/5 flex-wrap">
                <Kv k="Entry #"  v={String(e.entry_number)} />
                <Kv k="Parent #" v={e.parent_entry_number !== null ? String(e.parent_entry_number) : '—'} />
                <Kv k="Path"     v={e.parent_path ?? '—'} />
                <Kv k="Extension" v={e.extension || '—'} />
                <Kv k="Size"     v={fmtBytes(e.file_size)} />
                <Kv k="Type"     v={e.is_directory ? 'Directory' : 'File'} />
                <Kv k="Status"   v={e.is_deleted ? 'Deleted' : (e.is_in_use ? 'Active' : 'Unused')} />
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  )
}

function Row({ label, value, anomaly }: { label: string; value: string; anomaly?: boolean }) {
  return (
    <div className="flex gap-2">
      <span className="text-accent-muted/40 w-24 shrink-0">{label}</span>
      <span className={`font-mono ${anomaly ? 'text-yellow-400/80' : 'text-white/60'}`}>{value}</span>
    </div>
  )
}

function Kv({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex gap-1.5 items-baseline">
      <span className="text-accent-muted/40">{k}</span>
      <span className="font-mono text-white/60 truncate max-w-[200px]" title={v}>{v}</span>
    </div>
  )
}

// ── Sort header ───────────────────────────────────────────────────────────────

function SortTh({
  label, field, currentSort, currentDir, onSort,
}: {
  label: string; field: string
  currentSort: string; currentDir: string
  onSort: (f: string) => void
}) {
  const active = currentSort === field
  return (
    <th
      onClick={() => onSort(field)}
      className="px-2 py-2 text-left text-[9px] uppercase tracking-widest text-accent-muted/40 cursor-pointer hover:text-white/60 transition-colors select-none whitespace-nowrap"
    >
      <span className="flex items-center gap-1">
        {label}
        <ArrowUpDown size={8} className={active ? 'text-accent-green' : 'opacity-30'} />
        {active && <span className="text-accent-green">{currentDir === 'asc' ? '↑' : '↓'}</span>}
      </span>
    </th>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function MftExplorer({ caseId, fileId, filename, pinnedIds, onPin, onUnpin }: Props) {
  const [search,     setSearch]     = useState('')
  const [extension,  setExtension]  = useState('')
  const [timeField,  setTimeField]  = useState('si_modified')
  const [timeFrom,   setTimeFrom]   = useState('')
  const [timeTo,     setTimeTo]     = useState('')
  const [sortBy,     setSortBy]     = useState('si_modified')
  const [sortDir,    setSortDir]    = useState<'asc' | 'desc'>('asc')
  const [page,       setPage]       = useState(1)

  const [showDeleted,  setShowDeleted]  = useState(false)
  const [onlyDeleted,  setOnlyDeleted]  = useState(false)
  const [onlyDirs,     setOnlyDirs]     = useState(false)
  const [onlyFiles,    setOnlyFiles]    = useState(false)
  const [onlyAnomaly,  setOnlyAnomaly]  = useState(false)

  const buildFlags = () => {
    const f: string[] = []
    if (onlyDeleted)     f.push('deleted')
    else if (!showDeleted) f.push('active')
    if (onlyDirs)  f.push('directory')
    if (onlyFiles) f.push('file')
    if (onlyAnomaly) f.push('anomaly')
    return f.join(',')
  }

  const filters = {
    page, page_size: 200,
    search:     search     || undefined,
    extension:  extension  || undefined,
    flags:      buildFlags() || undefined,
    time_field: timeField,
    time_from:  timeFrom || undefined,
    time_to:    timeTo   || undefined,
    sort_by:    sortBy,
    sort_dir:   sortDir,
  }

  const { data, isFetching } = useQuery({
    queryKey: ['mft-entries', fileId, filters],
    queryFn:  () => mftApi.entries(caseId, fileId, filters),
    placeholderData: prev => prev,
  })

  const { data: summary } = useQuery({
    queryKey: ['mft-summary', fileId],
    queryFn:  () => mftApi.summary(caseId, fileId),
  })

  const handleSort = useCallback((field: string) => {
    if (sortBy === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortBy(field); setSortDir('asc') }
    setPage(1)
  }, [sortBy])

  const resetFilters = () => {
    setSearch(''); setExtension(''); setTimeFrom(''); setTimeTo('')
    setShowDeleted(false); setOnlyDeleted(false)
    setOnlyDirs(false); setOnlyFiles(false); setOnlyAnomaly(false)
    setPage(1)
  }

  const hasFilters = search || extension || timeFrom || timeTo ||
    showDeleted || onlyDeleted || onlyDirs || onlyFiles || onlyAnomaly

  const items = data?.items ?? []
  const total = data?.total ?? 0
  const pages = data?.pages ?? 1

  return (
    <div className="flex flex-col h-full overflow-hidden">

      {/* ── Summary bar ──────────────────────────────────────────────── */}
      {summary && <SummaryBar s={summary} />}

      {/* ── Filter bar ───────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-white/5 bg-bg-secondary/40 flex-wrap shrink-0">
        {/* Filename / path search */}
        <div className="relative">
          <Search size={11} className="absolute left-2 top-1/2 -translate-y-1/2 text-accent-muted/40 pointer-events-none" />
          <input
            className="input text-[11px] pl-6 pr-2 py-1 w-48"
            placeholder="Filename or path…"
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(1) }}
          />
        </div>

        {/* Extension filter */}
        <input
          className="input text-[11px] py-1 w-20"
          placeholder=".ext"
          value={extension}
          onChange={e => { setExtension(e.target.value); setPage(1) }}
          title="Filter by extension (e.g. exe, dll)"
        />

        {/* Time field */}
        <select
          className="input text-[10px] py-1 w-36"
          value={timeField}
          onChange={e => { setTimeField(e.target.value); setPage(1) }}
        >
          {TIME_FIELDS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
        </select>

        {/* From / To */}
        <input
          type="datetime-local"
          className="input text-[10px] py-1 w-40"
          value={timeFrom}
          onChange={e => { setTimeFrom(e.target.value); setPage(1) }}
          title="From"
        />
        <span className="text-accent-muted/40 text-[10px]">→</span>
        <input
          type="datetime-local"
          className="input text-[10px] py-1 w-40"
          value={timeTo}
          onChange={e => { setTimeTo(e.target.value); setPage(1) }}
          title="To"
        />

        {/* Flag toggles */}
        <div className="flex items-center gap-1 ml-1">
          <Filter size={10} className="text-accent-muted/30" />
          <FlagBtn label="Deleted"  active={onlyDeleted}  onClick={() => { setOnlyDeleted(v => !v); setShowDeleted(false); setPage(1) }} color="severity-critical" />
          <FlagBtn label="+Deleted" active={showDeleted}   onClick={() => { setShowDeleted(v => !v); setOnlyDeleted(false); setPage(1) }} />
          <FlagBtn label="Dirs"     active={onlyDirs}     onClick={() => { setOnlyDirs(v => !v); setOnlyFiles(false); setPage(1) }} />
          <FlagBtn label="Files"    active={onlyFiles}    onClick={() => { setOnlyFiles(v => !v); setOnlyDirs(false); setPage(1) }} />
          <FlagBtn label="⚠ Anomaly" active={onlyAnomaly} onClick={() => { setOnlyAnomaly(v => !v); setPage(1) }} color="yellow-400" />
        </div>

        {hasFilters && (
          <button onClick={resetFilters} className="flex items-center gap-1 text-[9px] text-accent-muted/40 hover:text-white ml-1">
            <X size={10} /> Reset
          </button>
        )}

        {isFetching && <span className="ml-auto text-[10px] text-accent-muted/40 animate-pulse">Loading…</span>}
      </div>

      {/* ── Table ────────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-auto">
        <table className="w-full text-xs border-collapse min-w-[900px]">
          <thead className="sticky top-0 bg-bg-secondary/90 backdrop-blur-sm z-10 border-b border-white/5">
            <tr>
              <th className="w-8 pl-2" />
              <th className="px-2 py-2 text-left text-[9px] uppercase tracking-widest text-accent-muted/40 w-64">Filename / Path</th>
              <SortTh label="SI Created"  field="si_created"     currentSort={sortBy} currentDir={sortDir} onSort={handleSort} />
              <SortTh label="SI Modified" field="si_modified"    currentSort={sortBy} currentDir={sortDir} onSort={handleSort} />
              <SortTh label="SI Accessed" field="si_accessed"    currentSort={sortBy} currentDir={sortDir} onSort={handleSort} />
              <SortTh label="MFT Changed" field="si_mft_changed" currentSort={sortBy} currentDir={sortDir} onSort={handleSort} />
              <th className="px-2 py-2 text-right text-[9px] uppercase tracking-widest text-accent-muted/40 pr-4">Size</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 && !isFetching ? (
              <tr>
                <td colSpan={7} className="py-16 text-center text-accent-muted/30 text-xs">
                  No entries match the current filters
                </td>
              </tr>
            ) : (
              items.map(e => (
                <EntryRow
                  key={e.entry_number}
                  e={e}
                  fileId={fileId}
                  isPinned={pinnedIds.has(`${fileId}:mft:${e.entry_number}`)}
                  onPin={onPin}
                  onUnpin={onUnpin}
                />
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* ── Pagination ───────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 px-4 py-2 border-t border-white/5 shrink-0 bg-bg-secondary/40">
        <span className="text-[10px] text-accent-muted/50">
          {total.toLocaleString()} entries · page {page}/{pages}
        </span>
        <div className="flex items-center gap-1 ml-auto">
          <button
            onClick={() => setPage(p => Math.max(1, p - 1))}
            disabled={page <= 1}
            className="p-1 rounded text-accent-muted hover:text-white disabled:opacity-30 transition-colors"
          >
            <ChevronLeft size={14} />
          </button>
          {Array.from({ length: Math.min(7, pages) }, (_, i) => {
            const p = pages <= 7 ? i + 1
              : page <= 4 ? i + 1
              : page >= pages - 3 ? pages - 6 + i
              : page - 3 + i
            return (
              <button
                key={p}
                onClick={() => setPage(p)}
                className={`w-6 h-6 rounded text-[10px] transition-colors ${
                  p === page ? 'bg-accent-green/20 text-accent-green' : 'text-accent-muted hover:text-white hover:bg-white/5'
                }`}
              >
                {p}
              </button>
            )
          })}
          <button
            onClick={() => setPage(p => Math.min(pages, p + 1))}
            disabled={page >= pages}
            className="p-1 rounded text-accent-muted hover:text-white disabled:opacity-30 transition-colors"
          >
            <ChevronRight size={14} />
          </button>
        </div>
      </div>
    </div>
  )
}
