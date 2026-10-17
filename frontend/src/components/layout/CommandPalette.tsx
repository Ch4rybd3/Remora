/**
 * Cmd+K / Ctrl+K global search palette.
 *
 * Searches across four sources simultaneously:
 *   1. Cases        — client-side filter on the cached case list
 *   2. IOCs         — client-side filter on the current case's IOC list
 *   3. Timeline     — client-side filter on the current case's timeline
 *   4. Artifacts    — server-side omni-search across all CSV artifacts (≥3 chars, debounced)
 *
 * Results are grouped and keyboard-navigable. Selecting a result navigates to
 * the most relevant destination and closes the palette.
 */
import { useEffect, useRef, useState, useMemo, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  AlertTriangle, ArrowRight, Clock, FolderOpen, Loader2, Search, Table2, Target, X,
} from '../../ui/icons'
import { useCurrentCase } from '../../context/CurrentCaseContext'
import { casesApi } from '../../api/cases'
import { iocsApi } from '../../api/iocs'
import { timelineApi } from '../../api/timeline'
import { csvArtifactsApi, type OmniSearchFile } from '../../api/csvArtifacts'
import type { CaseSummary, IOC, TimelineEvent } from '../../types'

// ── Types ────────────────────────────────────────────────────────────────────

type ResultKind = 'case' | 'ioc' | 'timeline' | 'artifact'

interface PaletteResult {
  id:       string
  kind:     ResultKind
  primary:  string
  secondary?: string
  href:     string
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function matches(text: string, q: string): boolean {
  return text.toLowerCase().includes(q.toLowerCase())
}

const KIND_META: Record<ResultKind, { label: string; Icon: React.ElementType; color: string }> = {
  case:     { label: 'Case',     Icon: FolderOpen,    color: 'text-accent' },
  ioc:      { label: 'IOC',      Icon: Target,        color: 'text-severity-critical' },
  timeline: { label: 'Timeline', Icon: Clock,         color: 'text-severity-medium' },
  artifact: { label: 'Artifact', Icon: Table2,        color: 'text-fg-secondary/60' },
}

// ── Result row ────────────────────────────────────────────────────────────────

function ResultRow({
  result, selected, onClick,
}: { result: PaletteResult; selected: boolean; onClick: () => void }) {
  const { Icon, label, color } = KIND_META[result.kind]
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${
        selected ? 'bg-accent/10' : 'hover:bg-accent/5'
      }`}
    >
      <Icon size={13} className={`${color} shrink-0`} />
      <div className="flex-1 min-w-0">
        <span className="text-ui text-fg truncate block">{result.primary}</span>
        {result.secondary && (
          <span className="text-label text-fg-secondary/50 truncate block">{result.secondary}</span>
        )}
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        <span className="text-label text-fg-secondary/35 uppercase tracking-wider">{label}</span>
        {selected && <ArrowRight size={11} className="text-accent" />}
      </div>
    </button>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function CommandPalette() {
  const { currentCase, setCurrentCase } = useCurrentCase()
  const navigate  = useNavigate()

  const [open,    setOpen]    = useState(false)
  const [query,   setQuery]   = useState('')
  const [debouncedQ, setDebouncedQ] = useState('')
  const [selected, setSelected] = useState(0)
  const inputRef  = useRef<HTMLInputElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const caseId = currentCase?.id ?? ''

  // ── Keyboard shortcut ──────────────────────────────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setOpen(prev => !prev)
      }
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  useEffect(() => {
    if (open) {
      setQuery('')
      setDebouncedQ('')
      setSelected(0)
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [open])

  // ── Debounce for artifact search ───────────────────────────────────────────
  const handleQueryChange = (v: string) => {
    setQuery(v)
    setSelected(0)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => setDebouncedQ(v), 300)
  }

  // ── Data fetches ───────────────────────────────────────────────────────────
  const { data: cases = [] } = useQuery({
    queryKey: ['cases'],
    queryFn:  casesApi.list,
    staleTime: 30_000,
    enabled:   open,
  })

  const { data: iocs = [] } = useQuery({
    queryKey: ['iocs', caseId],
    queryFn:  () => iocsApi.list(caseId),
    staleTime: 10_000,
    enabled:   open && !!caseId,
  })

  const { data: timeline = [] } = useQuery({
    queryKey: ['timeline', caseId],
    queryFn:  () => timelineApi.list(caseId),
    staleTime: 10_000,
    enabled:   open && !!caseId,
  })

  const { data: artifactHits, isFetching: artifactLoading } = useQuery({
    queryKey: ['cmd-palette-artifacts', caseId, debouncedQ],
    queryFn:  () => csvArtifactsApi.search(caseId, debouncedQ, 8),
    staleTime: 10_000,
    enabled:   open && !!caseId && debouncedQ.length >= 3,
  })

  // ── Build result list ──────────────────────────────────────────────────────
  const results: PaletteResult[] = useMemo(() => {
    const q = query.trim()
    if (!q) return []

    const out: PaletteResult[] = []

    // Cases
    ;(cases as CaseSummary[])
      .filter(c => matches(c.title, q))
      .slice(0, 4)
      .forEach(c => out.push({
        id:        c.id,
        kind:      'case',
        primary:   c.title,
        secondary: c.client_name || undefined,
        href:      `/cases/${c.id}`,
      }))

    // IOCs (current case only)
    if (caseId) {
      ;(iocs as IOC[])
        .filter(i => matches(i.value, q) || matches(i.description ?? '', q))
        .slice(0, 4)
        .forEach(i => out.push({
          id:        i.id,
          kind:      'ioc',
          primary:   i.value,
          secondary: i.type,
          href:      `/cases/${caseId}`,
        }))
    }

    // Timeline events (current case only)
    if (caseId) {
      ;(timeline as TimelineEvent[])
        .filter(e => matches(e.title ?? '', q) || matches(e.description ?? '', q))
        .slice(0, 4)
        .forEach(e => out.push({
          id:        e.id,
          kind:      'timeline',
          primary:   e.title ?? '(untitled)',
          secondary: e.event_ts ? new Date(e.event_ts).toLocaleString() : undefined,
          href:      `/cases/${caseId}`,
        }))
    }

    // Artifact rows (from server omni-search)
    if (caseId && artifactHits && debouncedQ.length >= 3) {
      artifactHits.files?.slice(0, 5).forEach((file: OmniSearchFile) => {
        if (!file.rows?.length) return
        const row = file.rows[0]
        const preview = Object.values(row).filter(Boolean).slice(0, 3).join(' · ')
        out.push({
          id:        `${file.id}-${out.length}`,
          kind:      'artifact',
          primary:   file.original_name,
          secondary: preview,
          href:      `/artifacts/explorer?open=${file.id}`,
        })
      })
    }

    return out
  }, [query, debouncedQ, cases, iocs, timeline, artifactHits, caseId])

  // ── Keyboard navigation in results ────────────────────────────────────────
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelected(s => Math.min(s + 1, results.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelected(s => Math.max(s - 1, 0))
    } else if (e.key === 'Enter' && results[selected]) {
      e.preventDefault()
      go(results[selected])
    }
  }, [results, selected])

  const go = useCallback((result: PaletteResult) => {
    // If the result is for a case that isn't the current one, switch context.
    if (result.kind === 'case') {
      const target = (cases as CaseSummary[]).find(c => c.id === result.id)
      if (target) {
        setCurrentCase({ id: target.id, title: target.title, client_id: target.client_id })
      }
    }
    navigate(result.href)
    setOpen(false)
  }, [cases, navigate, setCurrentCase])

  if (!open) return null

  const isSearching = query.length >= 3 && artifactLoading

  return (
    <div
      className="fixed inset-0 z-[200] flex items-start justify-center pt-[15vh] bg-black/50 backdrop-blur-sm"
      onClick={() => setOpen(false)}
    >
      <div
        className="w-full max-w-xl bg-panel border border-hairline shadow-2xl flex flex-col overflow-hidden"
        style={{ maxHeight: '70vh' }}
        onClick={e => e.stopPropagation()}
      >
        {/* ── Input ── */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-hairline shrink-0">
          <Search size={14} className="text-fg-secondary/50 shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={e => handleQueryChange(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search cases, IOCs, timeline, artifacts…"
            className="flex-1 bg-transparent text-ui text-fg placeholder-fg-muted focus:outline-none"
          />
          <div className="flex items-center gap-1.5 shrink-0">
            {isSearching && <Loader2 size={12} className="animate-spin text-fg-secondary/40" />}
            <kbd className="text-label text-fg-secondary/30 border border-hairline px-1.5 py-0.5 rounded-control font-mono">
              Esc
            </kbd>
            <button onClick={() => setOpen(false)} className="text-fg-secondary/30 hover:text-fg-secondary transition-colors">
              <X size={13} />
            </button>
          </div>
        </div>

        {/* ── Results ── */}
        <div className="flex-1 overflow-y-auto">
          {query.trim() === '' && (
            <div className="px-4 py-8 text-center">
              <p className="text-ui text-fg-secondary/40">
                {currentCase
                  ? `Searching in case "${currentCase.title}" and all cases`
                  : 'Search across all cases'}
              </p>
              {query.length < 3 && query.length > 0 && (
                <p className="text-label text-fg-secondary/30 mt-1">
                  Artifact search activates after 3 characters
                </p>
              )}
            </div>
          )}

          {query.trim() !== '' && results.length === 0 && !isSearching && (
            <div className="flex flex-col items-center gap-2 py-8 text-fg-secondary/40">
              <AlertTriangle size={18} className="opacity-40" />
              <p className="text-ui">No results for "{query}"</p>
              {query.length < 3 && (
                <p className="text-label">
                  Type {3 - query.length} more character{3 - query.length > 1 ? 's' : ''} to search artifacts
                </p>
              )}
            </div>
          )}

          {results.map((r, i) => (
            <ResultRow
              key={r.id}
              result={r}
              selected={i === selected}
              onClick={() => go(r)}
            />
          ))}
        </div>

        {/* ── Footer hint ── */}
        {results.length > 0 && (
          <div className="shrink-0 flex items-center gap-3 px-4 py-2 border-t border-hairline text-label text-fg-secondary/30">
            <span>↑↓ navigate</span>
            <span>↵ open</span>
            <span>Esc close</span>
          </div>
        )}
      </div>
    </div>
  )
}
