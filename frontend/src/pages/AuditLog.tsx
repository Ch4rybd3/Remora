import { useState, useCallback, useEffect, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { auditApi, type AuditFilters, type AuditLogEntry } from '../api/audit'
import {
  Search, ChevronLeft, ChevronRight, ChevronDown, ChevronUp,
  Filter, X, RefreshCw, Shield,
} from 'lucide-react'

// ── Action badge colours ─────────────────────────────────────────────────────

const ACTION_COLORS: Record<string, string> = {
  'auth':      'bg-blue-500/10 text-blue-400 border-blue-500/20',
  'case':      'bg-accent-green/10 text-accent-green border-accent-green/20',
  'ioc':       'bg-purple-500/10 text-purple-400 border-purple-500/20',
  'asset':     'bg-yellow-500/10 text-yellow-400 border-yellow-500/20',
  'evidence':  'bg-orange-500/10 text-orange-400 border-orange-500/20',
  'timeline':  'bg-cyan-500/10 text-cyan-400 border-cyan-500/20',
  'user':      'bg-red-500/10 text-red-400 border-red-500/20',
  'template':  'bg-indigo-500/10 text-indigo-400 border-indigo-500/20',
  'playbook':  'bg-pink-500/10 text-pink-400 border-pink-500/20',
  'evtx':      'bg-teal-500/10 text-teal-400 border-teal-500/20',
  'knowledge': 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
}

function actionColor(action: string): string {
  const prefix = action.split('.')[0]
  return ACTION_COLORS[prefix] ?? 'bg-white/5 text-accent-muted border-white/10'
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString('fr-FR', {
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    })
  } catch {
    return iso
  }
}

// ── Row detail panel ─────────────────────────────────────────────────────────

function DetailPanel({ entry, onClose }: { entry: AuditLogEntry; onClose: () => void }) {
  return (
    <div className="border-t border-white/5 bg-bg-secondary/50 px-6 py-4 text-xs space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-accent-muted font-medium uppercase tracking-wider text-[10px]">
          Détail de l'événement #{entry.id}
        </span>
        <button onClick={onClose} className="text-accent-muted hover:text-white transition-colors">
          <X size={13} />
        </button>
      </div>
      <div className="grid grid-cols-2 gap-x-8 gap-y-1.5">
        {[
          ['Timestamp',      fmtDate(entry.timestamp)],
          ['Utilisateur',    entry.username ?? '—'],
          ['Rôle',           entry.user_role ?? '—'],
          ['Action',         entry.action],
          ['Type ressource', entry.resource_type ?? '—'],
          ['ID ressource',   entry.resource_id ?? '—'],
          ['Nom ressource',  entry.resource_name ?? '—'],
          ['Case ID',        entry.case_id ?? '—'],
          ['Case titre',     entry.case_title ?? '—'],
          ['IP',             entry.ip_address ?? '—'],
        ].map(([k, v]) => (
          <div key={k} className="flex gap-2">
            <span className="text-accent-muted/60 shrink-0 w-28">{k}</span>
            <span className="text-white/80 font-mono break-all">{v}</span>
          </div>
        ))}
      </div>
      {entry.details && (
        <div>
          <p className="text-accent-muted/60 mb-1">Détails JSON</p>
          <pre className="bg-bg-primary rounded p-3 text-[11px] text-white/70 overflow-x-auto leading-relaxed">
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
    <div className="h-full flex flex-col bg-bg-primary overflow-hidden">

      {/* Header */}
      <div className="px-6 py-5 border-b border-white/5 flex items-center gap-3 shrink-0">
        <Shield size={18} className="text-accent-green" />
        <div>
          <h1 className="text-white font-semibold text-base">Journal d'audit</h1>
          <p className="text-accent-muted text-xs mt-0.5">
            Toutes les actions administratives de la plateforme
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {isFetching && (
            <RefreshCw size={13} className="text-accent-muted animate-spin" />
          )}
          <button
            onClick={() => refetch()}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md bg-white/5 text-accent-muted hover:text-white transition-colors"
          >
            <RefreshCw size={12} />
            Actualiser
          </button>
        </div>
      </div>

      {/* Toolbar */}
      <div className="px-6 py-3 border-b border-white/5 space-y-2 shrink-0">
        <div className="flex items-center gap-2">
          {/* Global search */}
          <div className="relative flex-1 max-w-sm">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-accent-muted pointer-events-none" />
            <input
              type="text"
              placeholder="Rechercher utilisateur, action, ressource…"
              value={search}
              onChange={e => handleSearch(e.target.value)}
              className="w-full bg-bg-secondary border border-white/10 rounded-md pl-9 pr-3 py-1.5 text-xs text-white placeholder:text-accent-muted/50 focus:outline-none focus:border-accent-green/50"
            />
            {search && (
              <button
                onClick={() => handleSearch('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-accent-muted hover:text-white"
              >
                <X size={12} />
              </button>
            )}
          </div>

          {/* Advanced toggle */}
          <button
            onClick={() => setShowAdvanced(v => !v)}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md border transition-colors ${
              showAdvanced || hasActiveFilters
                ? 'bg-accent-green/10 text-accent-green border-accent-green/30'
                : 'bg-white/5 text-accent-muted border-white/10 hover:text-white'
            }`}
          >
            <Filter size={12} />
            Filtres
            {hasActiveFilters && (
              <span className="bg-accent-green text-black rounded-full px-1 text-[9px] font-bold leading-none py-0.5">
                ✓
              </span>
            )}
            {showAdvanced ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          </button>

          {hasActiveFilters && (
            <button
              onClick={clearFilters}
              className="px-2 py-1.5 text-xs text-accent-muted hover:text-white transition-colors"
            >
              Réinitialiser
            </button>
          )}

          {/* Page size */}
          <div className="ml-auto flex items-center gap-2">
            <span className="text-accent-muted text-xs">{total.toLocaleString()} entrées</span>
            <select
              value={filters.page_size}
              onChange={e => setFilters(prev => ({ ...prev, page_size: Number(e.target.value), page: 1 }))}
              className="bg-bg-secondary border border-white/10 rounded px-2 py-1 text-xs text-white focus:outline-none"
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
              <label className="text-[10px] text-accent-muted uppercase tracking-wider">Utilisateur</label>
              <select
                value={filters.username ?? ''}
                onChange={e => setFilter('username', e.target.value)}
                className="bg-bg-secondary border border-white/10 rounded px-2 py-1.5 text-xs text-white focus:outline-none focus:border-accent-green/50"
              >
                <option value="">Tous</option>
                {meta?.usernames.map(u => <option key={u} value={u}>{u}</option>)}
              </select>
            </div>

            {/* Action prefix */}
            <div className="flex flex-col gap-1">
              <label className="text-[10px] text-accent-muted uppercase tracking-wider">Catégorie action</label>
              <select
                value={filters.action ?? ''}
                onChange={e => setFilter('action', e.target.value)}
                className="bg-bg-secondary border border-white/10 rounded px-2 py-1.5 text-xs text-white focus:outline-none focus:border-accent-green/50"
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
              <label className="text-[10px] text-accent-muted uppercase tracking-wider">Type ressource</label>
              <select
                value={filters.resource_type ?? ''}
                onChange={e => setFilter('resource_type', e.target.value)}
                className="bg-bg-secondary border border-white/10 rounded px-2 py-1.5 text-xs text-white focus:outline-none focus:border-accent-green/50"
              >
                <option value="">Tous</option>
                {meta?.resource_types.map(rt => <option key={rt} value={rt}>{rt}</option>)}
              </select>
            </div>

            {/* Case ID */}
            <div className="flex flex-col gap-1">
              <label className="text-[10px] text-accent-muted uppercase tracking-wider">Case ID</label>
              <input
                type="text"
                placeholder="UUID du case…"
                value={filters.case_id ?? ''}
                onChange={e => setFilter('case_id', e.target.value)}
                className="bg-bg-secondary border border-white/10 rounded px-2 py-1.5 text-xs text-white placeholder:text-accent-muted/40 focus:outline-none focus:border-accent-green/50"
              />
            </div>

            {/* Date from */}
            <div className="flex flex-col gap-1">
              <label className="text-[10px] text-accent-muted uppercase tracking-wider">Date début</label>
              <input
                type="datetime-local"
                value={filters.date_from ?? ''}
                onChange={e => setFilter('date_from', e.target.value)}
                className="bg-bg-secondary border border-white/10 rounded px-2 py-1.5 text-xs text-white focus:outline-none focus:border-accent-green/50 [color-scheme:dark]"
              />
            </div>

            {/* Date to */}
            <div className="flex flex-col gap-1">
              <label className="text-[10px] text-accent-muted uppercase tracking-wider">Date fin</label>
              <input
                type="datetime-local"
                value={filters.date_to ?? ''}
                onChange={e => setFilter('date_to', e.target.value)}
                className="bg-bg-secondary border border-white/10 rounded px-2 py-1.5 text-xs text-white focus:outline-none focus:border-accent-green/50 [color-scheme:dark]"
              />
            </div>
          </div>
        )}
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        <table className="w-full text-xs border-collapse">
          <thead className="sticky top-0 z-10 bg-bg-secondary">
            <tr className="border-b border-white/5">
              <th className="text-left px-4 py-2.5 text-accent-muted font-medium whitespace-nowrap w-40">
                Timestamp
              </th>
              <th className="text-left px-4 py-2.5 text-accent-muted font-medium whitespace-nowrap w-28">
                Utilisateur
              </th>
              <th className="text-left px-4 py-2.5 text-accent-muted font-medium whitespace-nowrap w-36">
                Action
              </th>
              <th className="text-left px-4 py-2.5 text-accent-muted font-medium">
                Ressource
              </th>
              <th className="text-left px-4 py-2.5 text-accent-muted font-medium">
                Case
              </th>
              <th className="text-left px-4 py-2.5 text-accent-muted font-medium w-32">
                IP
              </th>
            </tr>
          </thead>
          <tbody>
            {!data?.items.length && (
              <tr>
                <td colSpan={6} className="text-center py-16 text-accent-muted/50">
                  {isFetching ? 'Chargement…' : 'Aucune entrée'}
                </td>
              </tr>
            )}
            {data?.items.map(entry => (
              <>
                <tr
                  key={entry.id}
                  onClick={() => setExpanded(expanded === entry.id ? null : entry.id)}
                  className={`border-b border-white/5 cursor-pointer transition-colors ${
                    expanded === entry.id
                      ? 'bg-accent-green/5'
                      : 'hover:bg-white/5'
                  }`}
                >
                  <td className="px-4 py-2 font-mono text-accent-muted whitespace-nowrap">
                    {fmtDate(entry.timestamp)}
                  </td>
                  <td className="px-4 py-2 text-white whitespace-nowrap">
                    {entry.username ?? <span className="text-accent-muted/40 italic">système</span>}
                    {entry.user_role && (
                      <span className="ml-1.5 text-[10px] text-accent-muted/60">({entry.user_role})</span>
                    )}
                  </td>
                  <td className="px-4 py-2 whitespace-nowrap">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded border text-[11px] font-mono ${actionColor(entry.action)}`}>
                      {entry.action}
                    </span>
                  </td>
                  <td className="px-4 py-2 max-w-[220px] truncate">
                    {entry.resource_name ? (
                      <span className="text-white/80" title={entry.resource_name}>
                        {entry.resource_name}
                      </span>
                    ) : entry.resource_id ? (
                      <span className="text-accent-muted/60 font-mono text-[11px]">{entry.resource_id}</span>
                    ) : (
                      <span className="text-accent-muted/30">—</span>
                    )}
                    {entry.resource_type && (
                      <span className="ml-1.5 text-[10px] text-accent-muted/40">({entry.resource_type})</span>
                    )}
                  </td>
                  <td className="px-4 py-2 max-w-[180px] truncate text-accent-muted/70">
                    {entry.case_title ?? (entry.case_id ? (
                      <span className="font-mono text-[11px]">{entry.case_id.slice(0, 8)}…</span>
                    ) : '—')}
                  </td>
                  <td className="px-4 py-2 font-mono text-accent-muted/60 whitespace-nowrap">
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
        <div className="px-6 py-3 border-t border-white/5 flex items-center justify-between shrink-0">
          <span className="text-xs text-accent-muted">
            Page {page} / {pages} — {total.toLocaleString()} entrées
          </span>
          <div className="flex items-center gap-1">
            <button
              disabled={page <= 1}
              onClick={() => setFilters(prev => ({ ...prev, page: page - 1 }))}
              className="p-1.5 rounded text-accent-muted disabled:opacity-30 hover:text-white hover:bg-white/5 transition-colors"
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
                  className={`min-w-[28px] h-7 rounded text-xs transition-colors ${
                    p === page
                      ? 'bg-accent-green/15 text-accent-green font-medium'
                      : 'text-accent-muted hover:text-white hover:bg-white/5'
                  }`}
                >
                  {p}
                </button>
              )
            })}
            <button
              disabled={page >= pages}
              onClick={() => setFilters(prev => ({ ...prev, page: page + 1 }))}
              className="p-1.5 rounded text-accent-muted disabled:opacity-30 hover:text-white hover:bg-white/5 transition-colors"
            >
              <ChevronRight size={14} />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
