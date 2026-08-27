import { useState, useCallback, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { auditApi, type AuditFilters, type AuditLogEntry } from '../api/audit'
import { fmtDateTime } from '../utils/dateUtils'
import {
  Search, ChevronLeft, ChevronRight, ChevronDown, ChevronUp,
  Filter, X, RefreshCw, Shield,
} from '../ui/icons'

// ── Action badge colours ─────────────────────────────────────────────────────

const ACTION_COLORS: Record<string, string> = {
  'auth':      'bg-severity-low/10 text-severity-low border-severity-low/20',
  'case':      'bg-accent/10 text-accent border-accent/20',
  'ioc':       'bg-data-2/10 text-data-2 border-data-2/20',
  'asset':     'bg-severity-medium/10 text-severity-medium border-severity-medium/20',
  'evidence':  'bg-severity-high/10 text-severity-high border-severity-high/20',
  'timeline':  'bg-data-5/10 text-data-5 border-data-5/20',
  'user':      'bg-severity-critical/10 text-severity-critical border-severity-critical/20',
  'template':  'bg-data-1/10 text-data-1 border-data-1/20',
  'playbook':  'bg-data-3/10 text-data-3 border-data-3/20',
  'evtx':      'bg-accent/10 text-accent border-accent/20',
  'knowledge': 'bg-accent/10 text-accent border-accent/20',
}

function actionColor(action: string): string {
  const prefix = action.split('.')[0]
  return ACTION_COLORS[prefix] ?? 'bg-fg/5 text-fg-secondary border-hairline'
}

// ── Row detail panel ─────────────────────────────────────────────────────────

function DetailPanel({ entry, onClose }: { entry: AuditLogEntry; onClose: () => void }) {
  return (
    <div className="border-t border-hairline bg-panel/50 px-6 py-4 text-label space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-fg-secondary font-medium uppercase tracking-wider text-label">
          Event detail #{entry.id}
        </span>
        <button onClick={onClose} className="text-fg-secondary hover:text-fg transition-colors">
          <X size={13} />
        </button>
      </div>
      <div className="grid grid-cols-2 gap-x-8 gap-y-1.5">
        {[
          ['Timestamp',      fmtDateTime(entry.timestamp)],
          ['Utilisateur',    entry.username ?? '—'],
          ['Role',           entry.user_role ?? '-'],
          ['Action',         entry.action],
          ['Type ressource', entry.resource_type ?? '—'],
          ['ID ressource',   entry.resource_id ?? '—'],
          ['Resource name',  entry.resource_name ?? '—'],
          ['Case ID',        entry.case_id ?? '—'],
          ['Case titre',     entry.case_title ?? '—'],
          ['IP',             entry.ip_address ?? '—'],
        ].map(([k, v]) => (
          <div key={k} className="flex gap-2">
            <span className="text-fg-secondary/60 shrink-0 w-28">{k}</span>
            <span className="text-fg/80 font-mono break-all">{v}</span>
          </div>
        ))}
      </div>
      {entry.details && (
        <div>
          <p className="text-fg-secondary/60 mb-1">JSON details</p>
          <pre className="bg-canvas rounded-control p-3 text-label text-fg/70 overflow-x-auto leading-relaxed">
            {JSON.stringify(entry.details, null, 2)}
          </pre>
        </div>
      )}
    </div>
  )
}

// ── Main page ────────────────────────────────────────────────────────────────

const PAGE_SIZES = [25, 50, 100, 200]

export default function AuditLog() {
  const [filters, setFilters]           = useState<AuditFilters>({ page: 1, page_size: 50 })
  const [search, setSearch]             = useState('')
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [expanded, setExpanded]         = useState<number | null>(null)

  // Dropdown values
  const { data: meta } = useQuery({
    queryKey: ['audit-meta'],
    queryFn:  auditApi.meta,
    staleTime: 60_000,
  })

  // Debounce search → filters
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const handleSearch = (v: string) => {
    setSearch(v)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      setFilters(prev => ({ ...prev, search: v || undefined, page: 1 }))
    }, 350)
  }

  const { data, isFetching, refetch } = useQuery({
    queryKey:    ['audit', filters],
    queryFn:     () => auditApi.list(filters),
    staleTime:   15_000,
    placeholderData: prev => prev,
  })

  const setFilter = useCallback(<K extends keyof AuditFilters>(key: K, value: AuditFilters[K]) => {
    setFilters(prev => ({ ...prev, [key]: value || undefined, page: 1 }))
  }, [])

  const clearFilters = () => {
    setSearch('')
    setFilters({ page: 1, page_size: filters.page_size })
  }

  const hasActiveFilters = !!(
    filters.search || filters.username || filters.action ||
    filters.resource_type || filters.case_id || filters.date_from || filters.date_to
  )

  const total = data?.total ?? 0
  const pages = data?.pages ?? 1
  const page  = filters.page ?? 1

  return (
    <div className="h-full flex flex-col bg-canvas overflow-hidden">

      {/* Header */}
      <div className="px-6 py-5 border-b border-hairline flex items-center gap-3 shrink-0">
        <Shield size={18} className="text-accent" />
        <div>
          <h1 className="text-fg font-semibold text-prose">Journal d'audit</h1>
          <p className="text-fg-secondary text-label mt-0.5">
            Toutes les actions administratives de la plateforme
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {isFetching && (
            <RefreshCw size={13} className="text-fg-secondary animate-spin" />
          )}
          <button
            onClick={() => refetch()}
            className="flex items-center gap-1.5 px-3 py-1.5 text-label rounded-control bg-fg/5 text-fg-secondary hover:text-fg transition-colors"
          >
            <RefreshCw size={12} />
            Actualiser
          </button>
        </div>
      </div>

      {/* Toolbar */}
      <div className="px-6 py-3 border-b border-hairline space-y-2 shrink-0">
        <div className="flex items-center gap-2">
          {/* Global search */}
          <div className="relative flex-1 max-w-sm">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-fg-secondary pointer-events-none" />
            <input
              type="text"
              placeholder="Search user, action, resource..."
              value={search}
              onChange={e => handleSearch(e.target.value)}
              className="w-full bg-panel border border-hairline rounded-control pl-9 pr-3 py-1.5 text-label text-fg placeholder:text-fg-secondary/50 focus:outline-none focus:border-accent/50"
            />
            {search && (
              <button
                onClick={() => handleSearch('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-fg-secondary hover:text-fg"
              >
                <X size={12} />
              </button>
            )}
          </div>

          {/* Advanced toggle */}
          <button
            onClick={() => setShowAdvanced(v => !v)}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-label rounded-control border transition-colors ${ showAdvanced || hasActiveFilters
                ? 'bg-accent/10 text-accent border-accent/30'
                : 'bg-fg/5 text-fg-secondary border-hairline hover:text-fg'
            }`}
          >
            <Filter size={12} />
            Filtres
            {hasActiveFilters && (
              <span className="bg-accent text-black rounded-pill px-1 text-label font-bold leading-none py-0.5">
                ✓
              </span>
            )}
            {showAdvanced ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          </button>

          {hasActiveFilters && (
            <button
              onClick={clearFilters}
              className="px-2 py-1.5 text-label text-fg-secondary hover:text-fg transition-colors"
            >
              Reset
            </button>
          )}

          {/* Page size */}
          <div className="ml-auto flex items-center gap-2">
            <span className="text-fg-secondary text-label">{total.toLocaleString()} entries</span>
            <select
              value={filters.page_size}
              onChange={e => setFilters(prev => ({ ...prev, page_size: Number(e.target.value), page: 1 }))}
              className="bg-panel border border-hairline rounded-control px-2 py-1 text-label text-fg focus:outline-none"
            >
              {PAGE_SIZES.map(s => (
                <option key={s} value={s}>{s} / page</option>
              ))}
            </select>
          </div>
        </div>

        {/* Advanced filters panel */}
        {showAdvanced && (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 pt-1">
            {/* Username */}
            <div className="flex flex-col gap-1">
              <label className="text-label text-fg-secondary uppercase tracking-wider">Utilisateur</label>
              <select
                value={filters.username ?? ''}
                onChange={e => setFilter('username', e.target.value)}
                className="bg-panel border border-hairline rounded-control px-2 py-1.5 text-label text-fg focus:outline-none focus:border-accent/50"
              >
                <option value="">Tous</option>
                {meta?.usernames.map(u => <option key={u} value={u}>{u}</option>)}
              </select>
            </div>

            {/* Action prefix */}
            <div className="flex flex-col gap-1">
              <label className="text-label text-fg-secondary uppercase tracking-wider">Action category</label>
              <select
                value={filters.action ?? ''}
                onChange={e => setFilter('action', e.target.value)}
                className="bg-panel border border-hairline rounded-control px-2 py-1.5 text-label text-fg focus:outline-none focus:border-accent/50"
              >
                <option value="">Toutes</option>
                {/* Group by prefix */}
                {Array.from(new Set((meta?.actions ?? []).map(a => a.split('.')[0]))).sort().map(prefix => (
                  <option key={prefix} value={prefix}>{prefix}</option>
                ))}
              </select>
            </div>

            {/* Resource type */}
            <div className="flex flex-col gap-1">
              <label className="text-label text-fg-secondary uppercase tracking-wider">Type ressource</label>
              <select
                value={filters.resource_type ?? ''}
                onChange={e => setFilter('resource_type', e.target.value)}
                className="bg-panel border border-hairline rounded-control px-2 py-1.5 text-label text-fg focus:outline-none focus:border-accent/50"
              >
                <option value="">Tous</option>
                {meta?.resource_types.map(rt => <option key={rt} value={rt}>{rt}</option>)}
              </select>
            </div>

            {/* Case ID */}
            <div className="flex flex-col gap-1">
              <label className="text-label text-fg-secondary uppercase tracking-wider">Case ID</label>
              <input
                type="text"
                placeholder="UUID du case…"
                value={filters.case_id ?? ''}
                onChange={e => setFilter('case_id', e.target.value)}
                className="bg-panel border border-hairline rounded-control px-2 py-1.5 text-label text-fg placeholder:text-fg-secondary/40 focus:outline-none focus:border-accent/50"
              />
            </div>

            {/* Date from */}
            <div className="flex flex-col gap-1">
              <label className="text-label text-fg-secondary uppercase tracking-wider">Start date</label>
              <input
                type="datetime-local"
                value={filters.date_from ?? ''}
                onChange={e => setFilter('date_from', e.target.value)}
                className="bg-panel border border-hairline rounded-control px-2 py-1.5 text-label text-fg focus:outline-none focus:border-accent/50 [color-scheme:dark]"
              />
            </div>

            {/* Date to */}
            <div className="flex flex-col gap-1">
              <label className="text-label text-fg-secondary uppercase tracking-wider">Date fin</label>
              <input
                type="datetime-local"
                value={filters.date_to ?? ''}
                onChange={e => setFilter('date_to', e.target.value)}
                className="bg-panel border border-hairline rounded-control px-2 py-1.5 text-label text-fg focus:outline-none focus:border-accent/50 [color-scheme:dark]"
              />
            </div>
          </div>
        )}
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        <table className="w-full text-label border-collapse">
          <thead className="sticky top-0 z-10 bg-panel">
            <tr className="border-b border-hairline">
              <th className="text-left px-4 py-2.5 text-fg-secondary font-medium whitespace-nowrap w-40">
                Timestamp
              </th>
              <th className="text-left px-4 py-2.5 text-fg-secondary font-medium whitespace-nowrap w-28">
                Utilisateur
              </th>
              <th className="text-left px-4 py-2.5 text-fg-secondary font-medium whitespace-nowrap w-36">
                Action
              </th>
              <th className="text-left px-4 py-2.5 text-fg-secondary font-medium">
                Ressource
              </th>
              <th className="text-left px-4 py-2.5 text-fg-secondary font-medium">
                Case
              </th>
              <th className="text-left px-4 py-2.5 text-fg-secondary font-medium w-32">
                IP
              </th>
            </tr>
          </thead>
          <tbody>
            {!data?.items.length && (
              <tr>
                <td colSpan={6} className="text-center py-16 text-fg-secondary/50">
                  {isFetching ? 'Loading...' : 'No entry'}
                </td>
              </tr>
            )}
            {data?.items.map(entry => (
              <>
                <tr
                  key={entry.id}
                  onClick={() => setExpanded(expanded === entry.id ? null : entry.id)}
                  className={`border-b border-hairline cursor-pointer transition-colors ${ expanded === entry.id
                      ? 'bg-accent/5'
                      : 'hover:bg-fg/5'
                  }`}
                >
                  <td className="px-4 py-2 font-mono text-fg-secondary whitespace-nowrap">
                    {fmtDateTime(entry.timestamp)}
                  </td>
                  <td className="px-4 py-2 text-fg whitespace-nowrap">
                    {entry.username ?? <span className="text-fg-secondary/40 italic">system</span>}
                    {entry.user_role && (
                      <span className="ml-1.5 text-label text-fg-secondary/60">({entry.user_role})</span>
                    )}
                  </td>
                  <td className="px-4 py-2 whitespace-nowrap">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-control border text-label font-mono ${actionColor(entry.action)}`}>
                      {entry.action}
                    </span>
                  </td>
                  <td className="px-4 py-2 max-w-[220px] truncate">
                    {entry.resource_name ? (
                      <span className="text-fg/80" title={entry.resource_name}>
                        {entry.resource_name}
                      </span>
                    ) : entry.resource_id ? (
                      <span className="text-fg-secondary/60 font-mono text-label">{entry.resource_id}</span>
                    ) : (
                      <span className="text-fg-secondary/30">—</span>
                    )}
                    {entry.resource_type && (
                      <span className="ml-1.5 text-label text-fg-secondary/40">({entry.resource_type})</span>
                    )}
                  </td>
                  <td className="px-4 py-2 max-w-[180px] truncate text-fg-secondary/70">
                    {entry.case_title ?? (entry.case_id ? (
                      <span className="font-mono text-label">{entry.case_id.slice(0, 8)}…</span>
                    ) : '—')}
                  </td>
                  <td className="px-4 py-2 font-mono text-fg-secondary/60 whitespace-nowrap">
                    {entry.ip_address ?? '—'}
                  </td>
                </tr>
                {expanded === entry.id && (
                  <tr key={`${entry.id}-detail`}>
                    <td colSpan={6} className="p-0">
                      <DetailPanel entry={entry} onClose={() => setExpanded(null)} />
                    </td>
                  </tr>
                )}
              </>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {pages > 1 && (
        <div className="px-6 py-3 border-t border-hairline flex items-center justify-between shrink-0">
          <span className="text-label text-fg-secondary">
            Page {page} / {pages} - {total.toLocaleString()} entries
          </span>
          <div className="flex items-center gap-1">
            <button
              disabled={page <= 1}
              onClick={() => setFilters(prev => ({ ...prev, page: page - 1 }))}
              className="p-1.5 rounded-control text-fg-secondary disabled:opacity-30 hover:text-fg hover:bg-fg/5 transition-colors"
            >
              <ChevronLeft size={14} />
            </button>
            {/* Page numbers */}
            {Array.from({ length: Math.min(7, pages) }, (_, i) => {
              let p: number
              if (pages <= 7) {
                p = i + 1
              } else if (page <= 4) {
                p = i + 1
              } else if (page >= pages - 3) {
                p = pages - 6 + i
              } else {
                p = page - 3 + i
              }
              return (
                <button
                  key={p}
                  onClick={() => setFilters(prev => ({ ...prev, page: p }))}
                  className={`min-w-[28px] h-7 rounded-control text-label transition-colors ${ p === page
                      ? 'bg-accent/15 text-accent font-medium'
                      : 'text-fg-secondary hover:text-fg hover:bg-fg/5'
                  }`}
                >
                  {p}
                </button>
              )
            })}
            <button
              disabled={page >= pages}
              onClick={() => setFilters(prev => ({ ...prev, page: page + 1 }))}
              className="p-1.5 rounded-control text-fg-secondary disabled:opacity-30 hover:text-fg hover:bg-fg/5 transition-colors"
            >
              <ChevronRight size={14} />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
