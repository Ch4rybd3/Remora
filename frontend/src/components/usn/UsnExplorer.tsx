import { useState, useCallback } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Search, ChevronLeft, ChevronRight, Folder, FileText,
  Filter, X, ArrowUpDown, BookmarkPlus, BookmarkCheck,
} from 'lucide-react'
import { usnApi, type UsnEntry, type UsnSummary } from '../../api/usn'
import { fmtDateTime, fmtCompactMs } from '../../utils/dateUtils'

interface Props {
  caseId:    string
  fileId:    string
  filename:  string
  pinnedIds: Set<string>
  onPin:     (e: UsnEntry, idx: number) => void
  onUnpin:   (key: string) => void
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtTs(s: string | null): string { return fmtDateTime(s) }
function fmtTsShort(s: string | null): string { return fmtCompactMs(s) }

// ── Reason color-coding ───────────────────────────────────────────────────────

const REASON_COLORS: Record<string, string> = {
  'FileCreate':      'text-accent-green/80 bg-accent-green/10 border-accent-green/20',
  'FileDelete':      'text-severity-critical/80 bg-severity-critical/10 border-severity-critical/20',
  'RenameOldName':   'text-yellow-400/80 bg-yellow-400/10 border-yellow-400/20',
  'RenameNewName':   'text-yellow-400/80 bg-yellow-400/10 border-yellow-400/20',
  'DataExtend':      'text-blue-400/80 bg-blue-400/10 border-blue-400/20',
  'DataOverwrite':   'text-blue-400/80 bg-blue-400/10 border-blue-400/20',
  'DataTruncation':  'text-orange-400/80 bg-orange-400/10 border-orange-400/20',
  'SecurityChange':  'text-purple-400/80 bg-purple-400/10 border-purple-400/20',
  'BasicInfoChange': 'text-white/50 bg-white/5 border-white/10',
  'Close':           'text-accent-muted/40 bg-white/[0.02] border-white/5',
}

function reasonClass(reason: string | null): string {
  if (!reason) return 'text-accent-muted/30'
  // reason may be comma-separated (e.g. "DataExtend | Close")
  const primary = reason.split('|')[0].trim()
  return REASON_COLORS[primary] ?? 'text-accent-muted/50 bg-white/[0.02] border-white/5'
}

// ── Quick-filter reason buttons ───────────────────────────────────────────────

const QUICK_REASONS = [
  { label: 'Create',    value: 'FileCreate'    },
  { label: 'Delete',    value: 'FileDelete'    },
  { label: 'Rename',    value: 'RenameOldName' },
  { label: 'DataExtend',value: 'DataExtend'    },
  { label: 'Overwrite', value: 'DataOverwrite' },
  { label: 'Security',  value: 'SecurityChange'},
]

function FlagBtn({
  label, active, onClick,
}: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`text-[9px] px-2 py-0.5 rounded border transition-colors ${
        active
          ? 'bg-accent-green/10 border-accent-green/30 text-accent-green'
          : 'border-white/10 text-accent-muted/50 hover:text-white hover:border-white/20'
      }`}
    >
      {label}
    </button>
  )
}

// ── Summary bar ───────────────────────────────────────────────────────────────

function SummaryBar({ s }: { s: UsnSummary }) {
  return (
    <div className="flex items-center gap-4 px-4 py-2 border-b border-white/5 bg-white/[0.01] flex-wrap text-[10px] text-accent-muted/60 shrink-0">
      <span><span className="text-white/70 font-mono">{s.total_entries.toLocaleString()}</span> journal entries</span>
      {s.oldest_timestamp && (
        <>
          <span className="text-accent-muted/30">|</span>
          <span className="font-mono">{fmtTs(s.oldest_timestamp)}</span>
          <span className="text-accent-muted/30">→</span>
          <span className="font-mono">{fmtTs(s.newest_timestamp)}</span>
        </>
      )}
      {(s.top_reasons ?? []).slice(0, 4).map((r, i) => {
        const label = r?.reason ? String(r.reason).split('|')[0].trim() : '?'
        return (
          <span key={`${label}-${i}`} className="text-[9px]">
            <span className="text-white/40">{label}</span>
            <span className="text-accent-muted/30 ml-1">({(r?.count ?? 0).toLocaleString()})</span>
          </span>
        )
      })}
    </div>
  )
}

// ── Entry row ─────────────────────────────────────────────────────────────────

function EntryRow({
  e, idx, fileId, isPinned, onPin, onUnpin,
}: {
  e: UsnEntry; idx: number; fileId: string; isPinned: boolean
  onPin: (e: UsnEntry, idx: number) => void; onUnpin: (key: string) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const key = `${fileId}:usn:${idx}`

  return (
    <>
      <tr
        onClick={() => setExpanded(x => !x)}
        className="border-b border-white/[0.04] hover:bg-white/[0.03] cursor-pointer transition-colors group"
      >
        {/* Pin button */}
        <td
          className="w-8 pl-2 py-1.5 text-center shrink-0"
          onClick={ev => { ev.stopPropagation(); isPinned ? onUnpin(key) : onPin(e, idx) }}
        >
          {isPinned
            ? <BookmarkCheck size={12} className="mx-auto text-accent-green/60" title="Remove from selection" />
            : <BookmarkPlus  size={12} className="mx-auto text-accent-muted/20 group-hover:text-accent-muted/50 hover:!text-accent-green transition-colors" title="Add to selection" />
          }
        </td>

        {/* Timestamp */}
        <td className="px-2 py-1.5 text-[10px] font-mono text-white/70 whitespace-nowrap">
          {fmtTsShort(e.update_timestamp)}
        </td>

        {/* Reason badge */}
        <td className="px-2 py-1.5 whitespace-nowrap">
          {e.reason ? (
            <span className={`text-[9px] px-1.5 py-0.5 rounded border font-mono ${reasonClass(e.reason)}`}>
              {e.reason}
            </span>
          ) : (
            <span className="text-[9px] text-accent-muted/30">—</span>
          )}
        </td>

        {/* Filename / path */}
        <td className="px-2 py-1.5 max-w-[280px]">
          <div className="flex items-center gap-1.5">
            {e.is_directory
              ? <Folder   size={11} className="text-blue-400/60 shrink-0" />
              : <FileText size={11} className="text-accent-muted/30 shrink-0" />
            }
            <span className="text-xs font-mono text-white/80 truncate" title={e.filename ?? ''}>
              {e.filename ?? '—'}
            </span>
          </div>
          {e.full_path && (
            <p className="text-[9px] text-accent-muted/30 font-mono truncate mt-0.5" title={e.full_path}>
              {e.full_path}
            </p>
          )}
        </td>

        {/* Extension */}
        <td className="px-2 py-1.5 text-[10px] font-mono text-accent-muted/50 whitespace-nowrap">
          {e.extension || '—'}
        </td>
      </tr>

      {/* Expanded detail — mirrors MftExplorer pattern exactly */}
      {expanded && (
        <tr className="border-b border-white/5 bg-white/[0.015]">
          <td colSpan={5} className="px-6 py-3">
            <div className="grid grid-cols-2 gap-x-8 gap-y-1 text-[10px]">
              <div className="space-y-1">
                <p className="text-[9px] uppercase tracking-widest text-accent-muted/40 mb-1.5">Journal Entry</p>
                <DetailRow label="Timestamp" value={fmtTs(e.update_timestamp)} />
                <DetailRow label="Reason"    value={e.reason    || '—'} />
                <DetailRow label="Filename"  value={e.filename  || '—'} />
                <DetailRow label="Extension" value={e.extension || '—'} />
                <DetailRow label="Type"      value={e.is_directory ? 'Directory' : 'File'} />
              </div>
              <div className="space-y-1">
                <p className="text-[9px] uppercase tracking-widest text-accent-muted/40 mb-1.5">References</p>
                <DetailRow label="Full Path"  value={e.full_path  || '—'} />
                <DetailRow label="File Ref"   value={e.file_ref   || '—'} />
                <DetailRow label="Parent Ref" value={e.parent_ref || '—'} />
              </div>
              <div className="col-span-2 flex gap-6 mt-2 pt-2 border-t border-white/5 flex-wrap">
                <Kv k="USN"    v={e.usn          != null ? e.usn.toLocaleString()          : '—'} />
                <Kv k="Offset" v={e.entry_offset != null ? e.entry_offset.toLocaleString() : '—'} />
                <Kv k="Row"    v={String(idx + 1)} />
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  )
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2">
      <span className="text-accent-muted/40 w-24 shrink-0">{label}</span>
      <span className="font-mono text-white/60 break-all" title={value}>{value}</span>
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

export default function UsnExplorer({ caseId, fileId, filename, pinnedIds, onPin, onUnpin }: Props) {
  const [search,    setSearch]    = useState('')
  const [reason,    setReason]    = useState('')
  const [extension, setExtension] = useState('')
  const [timeFrom,  setTimeFrom]  = useState('')
  const [timeTo,    setTimeTo]    = useState('')
  const [sortDir,   setSortDir]   = useState<'asc' | 'desc'>('asc')
  const [page,      setPage]      = useState(1)

  const filters = {
    page, page_size: 200,
    search:     search    || undefined,
    reason:     reason    || undefined,
    extension:  extension || undefined,
    time_from:  timeFrom  || undefined,
    time_to:    timeTo    || undefined,
    sort_dir:   sortDir,
  }

  const { data, isFetching } = useQuery({
    queryKey: ['usn-entries', fileId, filters],
    queryFn:  () => usnApi.entries(caseId, fileId, filters),
    placeholderData: prev => prev,
  })

  const { data: summary } = useQuery({
    queryKey: ['usn-summary', fileId],
    queryFn:  () => usnApi.summary(caseId, fileId),
  })

  const handleSort = useCallback((_field: string) => {
    // Only update_timestamp sorting is meaningful for USN
    setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    setPage(1)
  }, [])

  const resetFilters = () => {
    setSearch(''); setReason(''); setExtension('')
    setTimeFrom(''); setTimeTo('')
    setPage(1)
  }

  const hasFilters = search || reason || extension || timeFrom || timeTo

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
            className="input text-[11px] pl-6 pr-2 py-1 w-44"
            placeholder="Filename or path…"
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(1) }}
          />
        </div>

        {/* Reason text filter */}
        <input
          className="input text-[11px] py-1 w-36"
          placeholder="Reason…"
          value={reason}
          onChange={e => { setReason(e.target.value); setPage(1) }}
          title="Filter by reason (e.g. FileCreate, FileDelete)"
        />

        {/* Extension filter */}
        <input
          className="input text-[11px] py-1 w-20"
          placeholder=".ext"
          value={extension}
          onChange={e => { setExtension(e.target.value); setPage(1) }}
          title="Filter by extension (e.g. exe, dll)"
        />

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

        {/* Quick-filter reason buttons */}
        <div className="flex items-center gap-1 ml-1">
          <Filter size={10} className="text-accent-muted/30" />
          {QUICK_REASONS.map(r => (
            <FlagBtn
              key={r.value}
              label={r.label}
              active={reason === r.value}
              onClick={() => { setReason(v => v === r.value ? '' : r.value); setPage(1) }}
            />
          ))}
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
        <table className="w-full text-xs border-collapse min-w-[800px]">
          <thead className="sticky top-0 bg-bg-secondary/90 backdrop-blur-sm z-10 border-b border-white/5">
            <tr>
              <th className="w-8 pl-2" />
              <SortTh
                label="Timestamp"
                field="update_timestamp"
                currentSort="update_timestamp"
                currentDir={sortDir}
                onSort={handleSort}
              />
              <th className="px-2 py-2 text-left text-[9px] uppercase tracking-widest text-accent-muted/40 w-48">Reason</th>
              <th className="px-2 py-2 text-left text-[9px] uppercase tracking-widest text-accent-muted/40">Filename / Path</th>
              <th className="px-2 py-2 text-left text-[9px] uppercase tracking-widest text-accent-muted/40">Ext</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 && !isFetching ? (
              <tr>
                <td colSpan={5} className="py-16 text-center text-accent-muted/30 text-xs">
                  No entries match the current filters
                </td>
              </tr>
            ) : (
              items.map((e, i) => (
                <EntryRow
                  key={i}
                  e={e}
                  idx={i}
                  fileId={fileId}
                  isPinned={pinnedIds.has(`${fileId}:usn:${i}`)}
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
