import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  ChevronLeft, ChevronRight, BookmarkPlus, BookmarkMinus,
  ChevronDown, ChevronUp, Search, ArrowUpDown,
} from 'lucide-react'
import { prefetchApi, type PrefetchFile, type PrefetchEntry } from '../../api/prefetch'
import { fmtDateTime } from '../../utils/dateUtils'
import { useTimezone } from '../../context/TimezoneContext'

interface Props {
  caseId:     string
  file:       PrefetchFile
  pinnedIds:  Set<string>
  onPin:      (entry: PrefetchEntry) => void
  onUnpin:    (key: string) => void
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function runDots(entry: PrefetchEntry) {
  const runs = [
    entry.last_run, entry.prev_run_0, entry.prev_run_1, entry.prev_run_2,
    entry.prev_run_3, entry.prev_run_4, entry.prev_run_5, entry.prev_run_6,
  ].filter(Boolean)
  return runs
}

function RunCountBadge({ count }: { count: number | null }) {
  if (count == null) return <span className="text-accent-muted/30">—</span>
  const cls =
    count >= 50 ? 'bg-severity-critical/15 text-severity-critical border-severity-critical/30' :
    count >= 20 ? 'bg-orange-500/15 text-orange-400 border-orange-500/30' :
    count >= 5  ? 'bg-yellow-500/15 text-yellow-400 border-yellow-500/30' :
                  'bg-white/5 text-white/50 border-white/10'
  return (
    <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded border ${cls}`}>
      {count}×
    </span>
  )
}

// ── Expanded row detail ───────────────────────────────────────────────────────

function ExpandedDetail({ entry, tz }: { entry: PrefetchEntry; tz: string }) {
  const allRuns = [
    entry.last_run,
    entry.prev_run_0, entry.prev_run_1, entry.prev_run_2,
    entry.prev_run_3, entry.prev_run_4, entry.prev_run_5, entry.prev_run_6,
  ].filter(Boolean) as string[]

  const files = entry.files_loaded
    ? entry.files_loaded.split('|').map(s => s.trim()).filter(Boolean)
    : []

  const dirs = entry.directories
    ? entry.directories.split('|').map(s => s.trim()).filter(Boolean)
    : []

  return (
    <tr className="bg-bg-secondary/40 border-b border-white/5">
      <td />
      <td colSpan={5} className="py-3 pr-4">
        <div className="grid grid-cols-2 gap-4">

          {/* All run times */}
          <div>
            <p className="text-[9px] font-semibold tracking-widest uppercase text-accent-muted/40 mb-1.5">
              All run times ({allRuns.length})
            </p>
            <div className="space-y-0.5">
              {allRuns.map((ts, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className={`text-[8px] font-mono px-1 rounded ${
                    i === 0
                      ? 'bg-accent-green/15 text-accent-green border border-accent-green/30'
                      : 'bg-white/5 text-accent-muted/50 border border-white/8'
                  }`}>
                    {i === 0 ? 'last' : `−${i}`}
                  </span>
                  <span className="text-[10px] font-mono text-white/70">
                    {fmtDateTime(ts, tz)}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Metadata */}
          <div className="space-y-2">
            {/* Volume */}
            {(entry.volume0_name || entry.volume1_name) && (
              <div>
                <p className="text-[9px] font-semibold tracking-widest uppercase text-accent-muted/40 mb-1">
                  Volumes
                </p>
                {entry.volume0_name && (
                  <p className="text-[10px] font-mono text-white/60">
                    {entry.volume0_name}
                    {entry.volume0_serial && (
                      <span className="text-accent-muted/40"> [{entry.volume0_serial}]</span>
                    )}
                  </p>
                )}
                {entry.volume1_name && (
                  <p className="text-[10px] font-mono text-white/60">{entry.volume1_name}</p>
                )}
              </div>
            )}

            {/* Hash + size */}
            <div className="flex items-center gap-3">
              {entry.hash && (
                <div>
                  <p className="text-[9px] text-accent-muted/40">Hash</p>
                  <p className="text-[10px] font-mono text-white/50">{entry.hash}</p>
                </div>
              )}
              {entry.size != null && (
                <div>
                  <p className="text-[9px] text-accent-muted/40">PF size</p>
                  <p className="text-[10px] font-mono text-white/50">
                    {(entry.size / 1024).toFixed(1)} KB
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Files loaded */}
        {files.length > 0 && (
          <div className="mt-3">
            <p className="text-[9px] font-semibold tracking-widest uppercase text-accent-muted/40 mb-1.5">
              Files loaded ({files.length})
            </p>
            <div className="max-h-32 overflow-y-auto space-y-0.5 pr-2">
              {files.map((f, i) => (
                <p key={i} className="text-[9px] font-mono text-white/40 leading-relaxed">{f}</p>
              ))}
            </div>
          </div>
        )}

        {/* Directories */}
        {dirs.length > 0 && (
          <div className="mt-2">
            <p className="text-[9px] font-semibold tracking-widest uppercase text-accent-muted/40 mb-1">
              Directories ({dirs.length})
            </p>
            <div className="max-h-20 overflow-y-auto space-y-0.5 pr-2">
              {dirs.map((d, i) => (
                <p key={i} className="text-[9px] font-mono text-white/40">{d}</p>
              ))}
            </div>
          </div>
        )}
      </td>
    </tr>
  )
}

// ── Summary card ──────────────────────────────────────────────────────────────

function SummaryBar({ caseId, file, tz }: { caseId: string; file: PrefetchFile; tz: string }) {
  const { data: summary } = useQuery({
    queryKey: ['prefetch-summary', caseId, file.id],
    queryFn:  () => prefetchApi.summary(caseId, file.id),
    enabled:  file.status === 'ready',
  })

  if (!summary) return null

  return (
    <div className="flex items-center gap-4 px-4 py-2 border-b border-white/5 bg-bg-secondary/30 text-[10px] shrink-0 overflow-x-auto">
      <div className="flex items-center gap-1.5 shrink-0">
        <span className="text-accent-muted/40">Executables</span>
        <span className="font-mono text-white/70">{summary.total_entries.toLocaleString()}</span>
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        <span className="text-accent-muted/40">Total runs</span>
        <span className="font-mono text-accent-green">{summary.total_runs.toLocaleString()}</span>
      </div>
      {summary.oldest_last_run && (
        <div className="flex items-center gap-1.5 shrink-0">
          <span className="text-accent-muted/40">Earliest run</span>
          <span className="font-mono text-white/50">{fmtDateTime(summary.oldest_last_run, tz)}</span>
        </div>
      )}
      {summary.newest_last_run && (
        <div className="flex items-center gap-1.5 shrink-0">
          <span className="text-accent-muted/40">Latest run</span>
          <span className="font-mono text-white/50">{fmtDateTime(summary.newest_last_run, tz)}</span>
        </div>
      )}
      {summary.versions.map(v => (
        <div key={v.version} className="flex items-center gap-1 shrink-0">
          <span className="text-[8px] px-1.5 py-0.5 rounded border border-white/10 text-accent-muted/50 font-mono">
            {v.version}
          </span>
          <span className="text-accent-muted/30">{v.count}</span>
        </div>
      ))}
    </div>
  )
}

// ── Main Explorer ─────────────────────────────────────────────────────────────

type SortCol = 'last_run' | 'run_count' | 'executable_name'

export default function PrefetchExplorer({ caseId, file, pinnedIds, onPin, onUnpin }: Props) {
  const { timezone } = useTimezone()

  const [page,       setPage]       = useState(1)
  const [search,     setSearch]     = useState('')
  const [sortBy,     setSortBy]     = useState<SortCol>('last_run')
  const [sortDir,    setSortDir]    = useState<'asc' | 'desc'>('desc')
  const [expandedId, setExpandedId] = useState<number | null>(null)

  const PAGE_SIZE = 100

  // Debounce search slightly via useMemo
  const debouncedSearch = useMemo(() => search, [search])

  const { data, isFetching } = useQuery({
    queryKey: ['prefetch-entries', caseId, file.id, page, debouncedSearch, sortBy, sortDir],
    queryFn:  () => prefetchApi.entries(caseId, file.id, {
      page, page_size: PAGE_SIZE,
      search:   debouncedSearch || undefined,
      sort_by:  sortBy,
      sort_dir: sortDir,
    }),
    enabled:     file.status === 'ready',
    placeholderData: prev => prev,
  })

  const items  = data?.items ?? []
  const total  = data?.total ?? 0
  const pages  = data?.pages ?? 1

  function toggleSort(col: SortCol) {
    if (sortBy === col) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortBy(col)
      setSortDir('desc')
    }
    setPage(1)
  }

  function SortIcon({ col }: { col: SortCol }) {
    if (sortBy !== col) return <ArrowUpDown size={10} className="text-accent-muted/30" />
    return sortDir === 'desc'
      ? <ChevronDown size={10} className="text-accent-green" />
      : <ChevronUp   size={10} className="text-accent-green" />
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">

      {/* Summary bar */}
      <SummaryBar caseId={caseId} file={file} tz={timezone} />

      {/* Toolbar */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-white/5 shrink-0 bg-bg-secondary/20">
        {/* Search */}
        <div className="relative flex-1 max-w-xs">
          <Search size={11} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-accent-muted/40 pointer-events-none" />
          <input
            type="text"
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(1) }}
            placeholder="Search executable, file…"
            className="w-full pl-7 pr-3 py-1 bg-bg-secondary border border-white/8 rounded text-[11px] text-white placeholder:text-accent-muted/30 focus:outline-none focus:border-accent-green/40"
          />
        </div>

        {/* Count + pagination */}
        <span className="ml-auto text-[10px] text-accent-muted/40 font-mono shrink-0">
          {total.toLocaleString()} executable{total !== 1 ? 's' : ''}
          {isFetching && <span className="ml-1 opacity-50">…</span>}
        </span>

        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={() => setPage(p => Math.max(1, p - 1))}
            disabled={page === 1}
            className="p-1 rounded text-accent-muted/40 hover:text-white disabled:opacity-20 hover:bg-white/5 transition-colors"
          >
            <ChevronLeft size={13} />
          </button>
          <span className="text-[10px] font-mono text-accent-muted/50">
            {page}/{pages}
          </span>
          <button
            onClick={() => setPage(p => Math.min(pages, p + 1))}
            disabled={page >= pages}
            className="p-1 rounded text-accent-muted/40 hover:text-white disabled:opacity-20 hover:bg-white/5 transition-colors"
          >
            <ChevronRight size={13} />
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        <table className="w-full text-[11px] border-collapse">
          <thead className="sticky top-0 z-10 bg-bg-secondary/90 backdrop-blur-sm">
            <tr className="border-b border-white/5">
              <th className="w-8 px-2 py-2" />
              <th
                className="text-left px-3 py-2 text-accent-muted/50 font-semibold tracking-widest uppercase cursor-pointer hover:text-white transition-colors select-none"
                onClick={() => toggleSort('executable_name')}
              >
                <div className="flex items-center gap-1">
                  Executable <SortIcon col="executable_name" />
                </div>
              </th>
              <th
                className="text-left px-3 py-2 text-accent-muted/50 font-semibold tracking-widest uppercase cursor-pointer hover:text-white transition-colors select-none w-20"
                onClick={() => toggleSort('run_count')}
              >
                <div className="flex items-center gap-1">
                  Runs <SortIcon col="run_count" />
                </div>
              </th>
              <th
                className="text-left px-3 py-2 text-accent-muted/50 font-semibold tracking-widest uppercase cursor-pointer hover:text-white transition-colors select-none"
                onClick={() => toggleSort('last_run')}
              >
                <div className="flex items-center gap-1">
                  Last Run <SortIcon col="last_run" />
                </div>
              </th>
              <th className="text-left px-3 py-2 text-accent-muted/50 font-semibold tracking-widest uppercase w-28">
                Timeline
              </th>
              <th className="text-left px-3 py-2 text-accent-muted/50 font-semibold tracking-widest uppercase w-24">
                Version
              </th>
            </tr>
          </thead>

          <tbody>
            {items.map(entry => {
              const key       = `${file.id}:${entry.row_num}`
              const isPinned  = pinnedIds.has(key)
              const isExpanded = expandedId === entry.row_num
              const runs      = runDots(entry)

              return (
                <>
                  <tr
                    key={entry.row_num}
                    className={`border-b border-white/[0.04] transition-colors group/row hover:bg-white/[0.02] cursor-pointer ${
                      isExpanded ? 'bg-white/[0.03]' : ''
                    }`}
                    onClick={() => setExpandedId(isExpanded ? null : entry.row_num)}
                  >
                    {/* Pin button */}
                    <td className="px-2 py-1.5 w-8">
                      <button
                        onClick={e => {
                          e.stopPropagation()
                          isPinned ? onUnpin(key) : onPin(entry)
                        }}
                        className={`p-1 rounded transition-colors ${
                          isPinned
                            ? 'text-accent-green bg-accent-green/10'
                            : 'text-accent-muted/20 hover:text-accent-green opacity-0 group-hover/row:opacity-100'
                        }`}
                        title={isPinned ? 'Remove from selection' : 'Add to timeline selection'}
                      >
                        {isPinned
                          ? <BookmarkMinus size={11} />
                          : <BookmarkPlus  size={11} />
                        }
                      </button>
                    </td>

                    {/* Executable name */}
                    <td className="px-3 py-1.5 font-mono">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-white/85 truncate max-w-xs" title={entry.executable_name ?? ''}>
                          {entry.executable_name ?? <span className="text-accent-muted/30 italic">unknown</span>}
                        </span>
                        {isExpanded
                          ? <ChevronUp   size={10} className="text-accent-muted/30 shrink-0" />
                          : <ChevronDown size={10} className="text-accent-muted/20 shrink-0 opacity-0 group-hover/row:opacity-100" />
                        }
                      </div>
                    </td>

                    {/* Run count */}
                    <td className="px-3 py-1.5">
                      <RunCountBadge count={entry.run_count} />
                    </td>

                    {/* Last run */}
                    <td className="px-3 py-1.5 font-mono text-white/60 whitespace-nowrap">
                      {entry.last_run
                        ? fmtDateTime(entry.last_run, timezone)
                        : <span className="text-accent-muted/25">—</span>
                      }
                    </td>

                    {/* Timeline dots */}
                    <td className="px-3 py-1.5">
                      <div className="flex items-center gap-0.5">
                        {runs.slice(0, 8).map((_, i) => (
                          <div
                            key={i}
                            className={`rounded-full ${
                              i === 0
                                ? 'w-2 h-2 bg-accent-green'
                                : 'w-1.5 h-1.5 bg-white/20'
                            }`}
                            title={fmtDateTime(runs[i]!, timezone)}
                          />
                        ))}
                      </div>
                    </td>

                    {/* Version */}
                    <td className="px-3 py-1.5">
                      {entry.version
                        ? <span className="text-[9px] font-mono text-accent-muted/50 bg-white/5 border border-white/8 px-1 py-0.5 rounded">
                            {entry.version}
                          </span>
                        : <span className="text-accent-muted/25">—</span>
                      }
                    </td>
                  </tr>

                  {/* Expanded detail row */}
                  {isExpanded && (
                    <ExpandedDetail
                      key={`exp-${entry.row_num}`}
                      entry={entry}
                      tz={timezone}
                    />
                  )}
                </>
              )
            })}

            {items.length === 0 && !isFetching && (
              <tr>
                <td colSpan={6} className="py-16 text-center text-accent-muted/30 text-xs">
                  No entries found
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
