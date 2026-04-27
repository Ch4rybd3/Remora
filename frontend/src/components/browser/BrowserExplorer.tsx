import { useState, useCallback } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Search, ChevronLeft, ChevronRight, Download, Globe, Puzzle,
  Cookie, Star, BookmarkPlus, X, ArrowUpDown, Clock,
} from 'lucide-react'
import { browserApi, type BrowserFile, type BrowserEntry, type BrowserSummary } from '../../api/browser'
import { format } from 'date-fns'

interface Props {
  caseId:    string
  file:      BrowserFile
  pinnedIds: Set<string>   // `${fileId}:${row_num}`
  onPin:     (entry: BrowserEntry) => void
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

function domain(url: string | null): string {
  if (!url) return '—'
  try { return new URL(url).hostname.replace(/^www\./, '') } catch { return url.slice(0, 40) }
}

// ── Artifact type config ──────────────────────────────────────────────────────

const TYPE_CONFIG: Record<string, { label: string; icon: React.ElementType; cls: string }> = {
  history:    { label: 'History',    icon: Globe,    cls: 'text-blue-400/80   bg-blue-500/10   border-blue-500/20'   },
  downloads:  { label: 'Download',   icon: Download, cls: 'text-accent-green/80 bg-accent-green/10 border-accent-green/20' },
  extensions: { label: 'Extension',  icon: Puzzle,   cls: 'text-purple-400/80 bg-purple-500/10 border-purple-500/20' },
  cookies:    { label: 'Cookie',     icon: Cookie,   cls: 'text-orange-400/80 bg-orange-500/10 border-orange-500/20' },
  autofill:   { label: 'Autofill',   icon: Star,     cls: 'text-yellow-400/80 bg-yellow-500/10 border-yellow-500/20' },
  searches:   { label: 'Search',     icon: Search,   cls: 'text-teal-400/80   bg-teal-500/10   border-teal-500/20'   },
  bookmarks:  { label: 'Bookmark',   icon: Star,     cls: 'text-pink-400/80   bg-pink-500/10   border-pink-500/20'   },
  cache:      { label: 'Cache',      icon: Globe,    cls: 'text-white/30      bg-white/5       border-white/10'      },
  generic:    { label: 'Generic',    icon: Globe,    cls: 'text-white/30      bg-white/5       border-white/10'      },
}

function TypeBadge({ type }: { type: string }) {
  const cfg = TYPE_CONFIG[type] ?? TYPE_CONFIG.generic
  return (
    <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded border whitespace-nowrap ${cfg.cls}`}>
      {cfg.label}
    </span>
  )
}

const BROWSER_COLORS: Record<string, string> = {
  chrome:  'text-blue-400/70',
  firefox: 'text-orange-400/70',
  edge:    'text-teal-400/70',
  safari:  'text-sky-400/70',
  brave:   'text-orange-300/70',
  opera:   'text-red-400/70',
}
function browserCls(b: string | null): string {
  return BROWSER_COLORS[(b ?? '').toLowerCase()] ?? 'text-accent-muted/50'
}

// ── Summary bar ───────────────────────────────────────────────────────────────

function SummaryBar({ s }: { s: BrowserSummary }) {
  return (
    <div className="flex items-center gap-4 px-4 py-2 border-b border-white/5 bg-white/[0.01] flex-wrap text-[10px] text-accent-muted/60 shrink-0">
      <span>
        <span className="text-white/70 font-mono">{s.total_entries.toLocaleString()}</span>
        {' '}{s.artifact_type} entries
      </span>
      {s.oldest_timestamp && (
        <>
          <span className="text-accent-muted/30">|</span>
          <span className="font-mono">{fmtTs(s.oldest_timestamp)}</span>
          <span className="text-accent-muted/30">→</span>
          <span className="font-mono">{fmtTs(s.newest_timestamp)}</span>
        </>
      )}
      {(s.top_browsers ?? []).slice(0, 3).map(b => (
        <span key={b.browser} className={`text-[9px] ${browserCls(b.browser)}`}>
          {b.browser} <span className="text-accent-muted/30">({b.count.toLocaleString()})</span>
        </span>
      ))}
      {(s.top_domains ?? []).slice(0, 3).map(d => (
        <span key={d.domain} className="text-[9px] font-mono text-white/30">
          {d.domain} <span className="text-accent-muted/25">({d.count})</span>
        </span>
      ))}
    </div>
  )
}

// ── Entry row ─────────────────────────────────────────────────────────────────

function EntryRow({
  e, idx, fileId, isPinned, onPin, onUnpin,
}: {
  e: BrowserEntry; idx: number; fileId: string
  isPinned: boolean
  onPin:   (e: BrowserEntry) => void
  onUnpin: (key: string) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const key = `${fileId}:${e.row_num}`
  const rd  = e.raw_data ?? {}

  // Primary display value in the URL/Title column
  const displayValue =
    e.artifact_type === 'downloads'
      ? (rd['Target Path'] ?? rd['TargetPath'] ?? rd['target_path'] ?? e.title ?? '—').split(/[\\/]/).pop() ?? '—'
      : e.artifact_type === 'extensions'
      ? (e.title ?? rd['Name'] ?? rd['Extension Name'] ?? '—')
      : e.artifact_type === 'cookies'
      ? (rd['Cookie Name'] ?? rd['Name'] ?? rd['name'] ?? e.title ?? '—')
      : (e.title || domain(e.url))

  // "Extra" value shown in the last short column
  const extraValue =
    e.artifact_type === 'history'    ? (rd['Visit Count'] ?? rd['VisitCount'] ?? rd['visit_count'] ?? null)
    : e.artifact_type === 'downloads'  ? (rd['State'] ?? rd['Download State'] ?? rd['state'] ?? null)
    : e.artifact_type === 'extensions' ? (rd['Version'] ?? rd['version'] ?? null)
    : e.artifact_type === 'cookies'    ? (e.url ? domain(e.url) : (rd['Host'] ?? null))
    : e.artifact_type === 'searches'   ? (e.url ? domain(e.url) : null)
    : null

  return (
    <>
      <tr
        onClick={() => setExpanded(x => !x)}
        className="border-b border-white/[0.04] hover:bg-white/[0.03] cursor-pointer transition-colors group"
      >
        {/* Timestamp */}
        <td className="pl-3 pr-2 py-1.5 text-[10px] font-mono text-white/60 whitespace-nowrap">
          {fmtTsShort(e.event_timestamp)}
        </td>

        {/* Type badge */}
        <td className="px-2 py-1.5 whitespace-nowrap">
          <TypeBadge type={e.artifact_type} />
        </td>

        {/* Browser */}
        <td className={`px-2 py-1.5 text-[10px] font-mono whitespace-nowrap ${browserCls(e.browser)}`}>
          {e.browser || '—'}
        </td>

        {/* Primary value */}
        <td className="px-2 py-1.5 max-w-[320px]">
          <span className="text-xs font-mono text-white/80 truncate block" title={e.url ?? ''}>
            {displayValue}
          </span>
          {e.url && (
            <p className="text-[9px] text-accent-muted/30 font-mono truncate mt-0.5" title={e.url}>
              {domain(e.url)}
            </p>
          )}
          {e.profile && (
            <p className="text-[9px] text-accent-muted/25 font-mono mt-0.5">{e.profile}</p>
          )}
        </td>

        {/* Extra */}
        <td className="px-2 py-1.5 text-[10px] font-mono text-accent-muted/40 whitespace-nowrap">
          {extraValue != null ? String(extraValue) : null}
        </td>

        {/* Pin button */}
        <td
          className="pr-3 py-1.5 w-8"
          onClick={ev => {
            ev.stopPropagation()
            isPinned ? onUnpin(key) : onPin(e)
          }}
        >
          <button
            className={`p-1 rounded transition-colors ${
              isPinned
                ? 'text-accent-green hover:text-accent-green/50'
                : 'text-accent-muted/20 hover:text-accent-green group-hover:text-accent-muted/50'
            }`}
            title={isPinned ? 'Remove from selection' : 'Add to selection'}
          >
            <BookmarkPlus size={12} />
          </button>
        </td>
      </tr>

      {/* ── Expanded detail ───────────────────────────────────────────── */}
      {expanded && (
        <tr className="border-b border-white/5 bg-white/[0.015]">
          <td colSpan={6} className="px-6 py-3">

            {/* Normalized fields row */}
            <div className="flex flex-wrap gap-x-8 gap-y-1 mb-3 text-[10px]">
              <p className="w-full text-[9px] uppercase tracking-widest text-accent-muted/40 mb-0.5">
                {(TYPE_CONFIG[e.artifact_type] ?? TYPE_CONFIG.generic).label} — row #{e.row_num}
              </p>
              {e.event_timestamp && <Kv k="Timestamp" v={fmtTs(e.event_timestamp)} />}
              {e.url             && <Kv k="URL"       v={e.url} />}
              {e.title           && <Kv k="Title"     v={e.title} />}
              {e.browser         && <Kv k="Browser"   v={e.browser} />}
              {e.profile         && <Kv k="Profile"   v={e.profile} />}
              {e.username        && <Kv k="User"      v={e.username} />}
            </div>

            {/* All raw CSV columns */}
            {Object.keys(rd).length > 0 && (
              <div className="rounded border border-white/6 bg-black/20 overflow-hidden">
                <p className="px-2 py-1 text-[9px] uppercase tracking-widest text-accent-muted/30 border-b border-white/5">
                  Raw CSV data
                </p>
                <div className="divide-y divide-white/[0.04]">
                  {Object.entries(rd).map(([col, val], i) => (
                    <div key={col} className={`flex text-[9px] font-mono min-w-0 ${i % 2 === 0 ? 'bg-white/[0.02]' : ''}`}>
                      <span className="w-40 shrink-0 px-2 py-1 text-accent-muted/40 border-r border-white/5 truncate" title={col}>
                        {col}
                      </span>
                      <span className="flex-1 px-2 py-1 text-white/55 break-all">{val}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  )
}

function Kv({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex gap-1.5 items-baseline text-[10px]">
      <span className="text-accent-muted/40 shrink-0">{k}</span>
      <span className="font-mono text-white/60 break-all" title={v}>{v}</span>
    </div>
  )
}

// ── Sort header ───────────────────────────────────────────────────────────────

function SortTh({ label, active, dir, onClick }: {
  label: string; active: boolean; dir: 'asc' | 'desc'; onClick: () => void
}) {
  return (
    <th
      onClick={onClick}
      className="px-2 py-2 text-left text-[9px] uppercase tracking-widest text-accent-muted/40 cursor-pointer hover:text-white/60 transition-colors select-none whitespace-nowrap"
    >
      <span className="flex items-center gap-1">
        {label}
        <ArrowUpDown size={8} className={active ? 'text-accent-green' : 'opacity-30'} />
        {active && <span className="text-accent-green">{dir === 'asc' ? '↑' : '↓'}</span>}
      </span>
    </th>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

const ARTIFACT_TYPES = ['history', 'downloads', 'extensions', 'cookies', 'autofill', 'searches', 'bookmarks', 'cache', 'generic']

export default function BrowserExplorer({ caseId, file, pinnedIds, onPin, onUnpin }: Props) {
  const fileId   = file.id
  const filename = file.filename

  const [search,       setSearch]       = useState('')
  const [browserFilt,  setBrowserFilt]  = useState('')
  const [typeFilt,     setTypeFilt]     = useState('')
  const [timeFrom,     setTimeFrom]     = useState('')
  const [timeTo,       setTimeTo]       = useState('')
  const [sortDir,      setSortDir]      = useState<'asc' | 'desc'>('asc')
  const [page,         setPage]         = useState(1)

  const filters = {
    page, page_size: 200,
    search:        search      || undefined,
    browser:       browserFilt || undefined,
    artifact_type: typeFilt    || undefined,
    time_from:     timeFrom    || undefined,
    time_to:       timeTo      || undefined,
    sort_dir:      sortDir,
  }

  const { data, isFetching } = useQuery({
    queryKey: ['browser-entries', fileId, filters],
    queryFn:  () => browserApi.entries(caseId, fileId, filters),
    placeholderData: prev => prev,
  })

  const { data: summary } = useQuery({
    queryKey: ['browser-summary', fileId],
    queryFn:  () => browserApi.summary(caseId, fileId),
  })

  const handleSort = useCallback(() => {
    setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    setPage(1)
  }, [])

  const reset = () => {
    setSearch(''); setBrowserFilt(''); setTypeFilt('')
    setTimeFrom(''); setTimeTo(''); setPage(1)
  }

  const hasFilters = search || browserFilt || typeFilt || timeFrom || timeTo
  const items  = data?.items ?? []
  const total  = data?.total ?? 0
  const pages  = data?.pages ?? 1

  return (
    <div className="flex flex-col h-full overflow-hidden">

      {/* ── Summary bar ──────────────────────────────────────────────── */}
      {summary && <SummaryBar s={summary} />}

      {/* ── Filter bar ───────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-white/5 bg-bg-secondary/40 flex-wrap shrink-0">

        {/* Search */}
        <div className="relative">
          <Search size={11} className="absolute left-2 top-1/2 -translate-y-1/2 text-accent-muted/40 pointer-events-none" />
          <input
            className="input text-[11px] pl-6 pr-2 py-1 w-48"
            placeholder="Search all columns…"
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(1) }}
          />
        </div>

        {/* Type filter */}
        <select
          className="input text-[10px] py-1 w-32"
          value={typeFilt}
          onChange={e => { setTypeFilt(e.target.value); setPage(1) }}
        >
          <option value="">All types</option>
          {ARTIFACT_TYPES.map(t => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>

        {/* Browser filter */}
        <input
          className="input text-[11px] py-1 w-28"
          placeholder="Browser…"
          value={browserFilt}
          onChange={e => { setBrowserFilt(e.target.value); setPage(1) }}
        />

        {/* Time range */}
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

        {hasFilters && (
          <button onClick={reset} className="flex items-center gap-1 text-[9px] text-accent-muted/40 hover:text-white ml-1">
            <X size={10} /> Reset
          </button>
        )}

        {isFetching && (
          <span className="ml-auto text-[10px] text-accent-muted/40 animate-pulse">Loading…</span>
        )}
      </div>

      {/* ── Table ────────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-auto">
        <table className="w-full text-xs border-collapse min-w-[900px]">
          <thead className="sticky top-0 bg-bg-secondary/90 backdrop-blur-sm z-10 border-b border-white/5">
            <tr>
              <SortTh label="Timestamp" active dir={sortDir} onClick={handleSort} />
              <th className="px-2 py-2 text-left text-[9px] uppercase tracking-widest text-accent-muted/40 w-24">Type</th>
              <th className="px-2 py-2 text-left text-[9px] uppercase tracking-widest text-accent-muted/40 w-24">Browser</th>
              <th className="px-2 py-2 text-left text-[9px] uppercase tracking-widest text-accent-muted/40">Name / URL</th>
              <th className="px-2 py-2 text-left text-[9px] uppercase tracking-widest text-accent-muted/40 w-28">Extra</th>
              <th className="w-8 pr-3" />
            </tr>
          </thead>
          <tbody>
            {items.length === 0 && !isFetching ? (
              <tr>
                <td colSpan={6} className="py-16 text-center text-accent-muted/30 text-xs">
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
                  isPinned={pinnedIds.has(`${fileId}:${e.row_num}`)}
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
              : page <= 4      ? i + 1
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
