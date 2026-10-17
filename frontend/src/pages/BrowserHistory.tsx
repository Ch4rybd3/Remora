import { useState, useMemo } from 'react'
import type { ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { PageShell } from '../ui/PageShell'
import {
  AlertTriangle, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight,
  Clock, Download, Globe, History, KeyRound, Loader2, Monitor, Search,
} from '../ui/icons'
import { useCurrentCase } from '../context/CurrentCaseContext'
import { browserApi, type BrowserKind } from '../api/browser'
import { iocsApi } from '../api/iocs'

// ── Tab config ────────────────────────────────────────────────────────────────

const TABS: { kind: BrowserKind; label: string; icon: React.ElementType }[] = [
  { kind: 'history',   label: 'History',   icon: History },
  { kind: 'downloads', label: 'Downloads', icon: Download },
  { kind: 'cookies',   label: 'Cookies',   icon: Globe },
  { kind: 'logins',    label: 'Saved logins', icon: KeyRound },
]

// Columns that contain URLs / domains — get IOC highlighting
const URL_COLS = new Set(['URL', 'Host', 'host_key', 'origin_url', 'tab_url', 'Source'])

const PAGE_SIZE = 100

// ── Pagination strip ──────────────────────────────────────────────────────────

function Pager({
  page, pages, onPage,
}: { page: number; pages: number; onPage: (p: number) => void }) {
  if (pages <= 1) return null
  return (
    <div className="flex items-center gap-1 text-label text-fg-secondary/60">
      <button onClick={() => onPage(1)}       disabled={page === 1}     className="p-1 disabled:opacity-30 hover:text-fg transition-colors"><ChevronsLeft  size={12} /></button>
      <button onClick={() => onPage(page - 1)} disabled={page === 1}     className="p-1 disabled:opacity-30 hover:text-fg transition-colors"><ChevronLeft   size={12} /></button>
      <span className="px-2 font-mono">{page} / {pages}</span>
      <button onClick={() => onPage(page + 1)} disabled={page === pages} className="p-1 disabled:opacity-30 hover:text-fg transition-colors"><ChevronRight  size={12} /></button>
      <button onClick={() => onPage(pages)}    disabled={page === pages} className="p-1 disabled:opacity-30 hover:text-fg transition-colors"><ChevronsRight size={12} /></button>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function BrowserHistory() {
  const { currentCase } = useCurrentCase()
  const caseId = currentCase?.id ?? ''

  const [kind,    setKind]    = useState<BrowserKind>('history')
  const [page,    setPage]    = useState(1)
  const [search,  setSearch]  = useState('')
  const [pending, setPending] = useState('')   // debounced search input

  // debounce: only fire after 350 ms of no typing
  const [debounceHandle, setDebounceHandle] = useState<ReturnType<typeof setTimeout> | null>(null)
  const handleSearch = (v: string) => {
    setPending(v)
    if (debounceHandle) clearTimeout(debounceHandle)
    setDebounceHandle(setTimeout(() => { setSearch(v); setPage(1) }, 350))
  }

  const switchKind = (k: BrowserKind) => {
    setKind(k)
    setPage(1)
    setSearch('')
    setPending('')
  }

  const { data, isLoading, isError } = useQuery({
    queryKey: ['browser', caseId, kind, page, search],
    queryFn:  () => browserApi.rows(caseId, kind, {
      page, page_size: PAGE_SIZE,
      sort_dir: 'desc',
      q: search || undefined,
    }),
    enabled: !!caseId,
  })

  const { data: iocs = [] } = useQuery({
    queryKey: ['iocs', caseId],
    queryFn:  () => iocsApi.list(caseId),
    enabled:  !!caseId,
  })

  const iocSet = useMemo(
    () => new Set(iocs.map(i => i.value.toLowerCase())),
    [iocs],
  )

  const columns  = data?.columns ?? []
  const items    = data?.items   ?? []
  const total    = data?.total   ?? 0
  const pages    = data?.pages   ?? 1
  const noData   = !isLoading && !isError && data && data.artifact_id === null

  // Timestamp column heuristic (same as backend)
  const tsCol = ['VisitTime', 'StartTime', 'Created', 'LastUsed', 'LastAccess']
    .find(c => columns.includes(c))

  function cellClass(col: string) {
    if (col === tsCol)    return 'font-mono text-label text-fg/45 whitespace-nowrap'
    if (URL_COLS.has(col)) return 'text-ui text-fg/80 max-w-xs truncate'
    return 'text-ui text-fg/65'
  }

  function renderCell(col: string, val: string): ReactNode {
    const isIoc = URL_COLS.has(col) && iocSet.has(val.toLowerCase())
    if (isIoc) {
      return (
        <span
          title="IOC match"
          className="inline-block rounded-control px-px font-medium"
          style={{
            background: 'color-mix(in srgb, var(--severity-critical) 22%, transparent)',
            color: 'var(--severity-critical)',
          }}
        >
          {val}
        </span>
      )
    }
    return val
  }

  return (
    <PageShell
      route="/artifacts/browser"
      title="Browser History"
      subtitle={currentCase?.title}
      fullHeight
    >
      <div className="flex flex-col h-full overflow-hidden">

        {/* ── Tab bar ── */}
        <div className="shrink-0 flex items-center gap-0 border-b border-hairline bg-panel/50 px-4">
          {TABS.map(t => {
            const Icon = t.icon
            return (
              <button
                key={t.kind}
                onClick={() => switchKind(t.kind)}
                className={`flex items-center gap-1.5 px-4 py-2.5 text-ui border-b-2 transition-colors ${
                  kind === t.kind
                    ? 'border-accent text-accent'
                    : 'border-transparent text-fg-secondary hover:text-fg'
                }`}
              >
                <Icon size={13} />
                {t.label}
              </button>
            )
          })}
        </div>

        {/* ── Toolbar ── */}
        <div className="shrink-0 flex items-center gap-3 px-4 py-2 border-b border-hairline">
          <div className="relative flex-1 max-w-sm">
            <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-muted pointer-events-none" />
            <input
              type="text"
              value={pending}
              onChange={e => handleSearch(e.target.value)}
              placeholder={kind === 'history'   ? 'Filter by URL, title…'
                         : kind === 'downloads' ? 'Filter by URL, path…'
                         : kind === 'cookies'   ? 'Filter by host, name…'
                                                : 'Filter by URL, username…'}
              className="w-full bg-transparent border border-hairline pl-7 pr-3 py-1.5 text-ui text-fg placeholder-fg-muted focus:outline-none focus:border-accent/50"
            />
          </div>
          {total > 0 && (
            <span className="text-label text-fg-secondary/50 font-mono shrink-0">
              {total.toLocaleString()} rows
            </span>
          )}
          <Pager page={page} pages={pages} onPage={setPage} />
        </div>

        {/* ── Body ── */}
        <div className="flex-1 overflow-auto">
          {isLoading && (
            <div className="flex items-center justify-center h-40 gap-2 text-fg-secondary/50 text-ui">
              <Loader2 size={14} className="animate-spin" />
              Loading…
            </div>
          )}

          {isError && (
            <div className="flex items-center justify-center h-40 gap-2 text-severity-medium text-ui">
              <AlertTriangle size={14} />
              Failed to load browser data
            </div>
          )}

          {noData && (
            <div className="flex flex-col items-center justify-center h-64 gap-3 text-fg-secondary/40">
              <Monitor size={32} className="opacity-30" />
              <p className="text-ui">No {kind} data in this case</p>
              <p className="text-label text-fg-secondary/30">
                Import a Chrome/Edge/Firefox SQLite database via the Collection tab
              </p>
            </div>
          )}

          {!isLoading && !isError && items.length > 0 && (
            <table className="w-full text-left border-collapse">
              <thead className="sticky top-0 z-10 bg-panel/90 backdrop-blur-sm">
                <tr>
                  {columns.map((col: string) => (
                    <th
                      key={col}
                      className="px-3 py-2 text-label font-semibold uppercase tracking-wider text-fg-secondary/60 border-b border-hairline whitespace-nowrap"
                    >
                      {col === tsCol && <Clock size={9} className="inline mr-1 opacity-60" />}
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {items.map((row: Record<string, string>, i: number) => (
                  <tr
                    key={i}
                    className="border-b border-hairline/40 hover:bg-accent/3 transition-colors"
                  >
                    {columns.map((col: string) => (
                      <td
                        key={col}
                        className={`px-3 py-1.5 ${cellClass(col)}`}
                        title={row[col] ?? ''}
                      >
                        {renderCell(col, row[col] ?? '')}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* ── Footer pager ── */}
        {pages > 1 && (
          <div className="shrink-0 flex items-center justify-end px-4 py-2 border-t border-hairline">
            <Pager page={page} pages={pages} onPage={setPage} />
          </div>
        )}
      </div>
    </PageShell>
  )
}
