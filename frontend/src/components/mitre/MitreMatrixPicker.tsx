/**
 * MitreMatrixPicker — shared MITRE ATT&CK matrix component.
 *
 * Used in:
 *  - MitreTab (per-case TTP selection)
 *  - TemplateTTPModal (per-template TTP configuration)
 *
 * The component handles its own data-fetching (technique tree + status).
 * Callers provide `selectedKeys` and `onToggle` to control selection.
 */
import { useState, useMemo, useRef, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  ExternalLink, Search, Eye, EyeOff, RefreshCw, Shield,
  ChevronRight, ChevronDown, RotateCcw, AlertTriangle,
} from 'lucide-react'
import {
  mitreApi,
  type Technique, type SubTechnique, type Tactic,
} from '../../api/mitre'

// ── Tactic colour maps ────────────────────────────────────────────────────────

// ATT&CK v19: defense-evasion split into stealth (TA0005) + defense-impairment (TA0112)
export const TACTIC_COLORS: Record<string, string> = {
  'reconnaissance':       'border-t-purple-500/60',
  'resource-development': 'border-t-purple-400/60',
  'initial-access':       'border-t-red-500/60',
  'execution':            'border-t-orange-500/60',
  'persistence':          'border-t-yellow-500/60',
  'privilege-escalation': 'border-t-amber-500/60',
  'stealth':              'border-t-lime-500/60',      // was defense-evasion
  'defense-impairment':   'border-t-fuchsia-500/60',  // new in v19
  'credential-access':    'border-t-green-500/60',
  'discovery':            'border-t-teal-500/60',
  'lateral-movement':     'border-t-cyan-500/60',
  'collection':           'border-t-blue-500/60',
  'command-and-control':  'border-t-indigo-500/60',
  'exfiltration':         'border-t-violet-500/60',
  'impact':               'border-t-rose-500/60',
}

export const TACTIC_HEADER_COLORS: Record<string, string> = {
  'reconnaissance':       'text-purple-400',
  'resource-development': 'text-purple-300',
  'initial-access':       'text-red-400',
  'execution':            'text-orange-400',
  'persistence':          'text-yellow-400',
  'privilege-escalation': 'text-amber-400',
  'stealth':              'text-lime-400',       // was defense-evasion
  'defense-impairment':   'text-fuchsia-400',   // new in v19
  'credential-access':    'text-green-400',
  'discovery':            'text-teal-400',
  'lateral-movement':     'text-cyan-400',
  'collection':           'text-blue-400',
  'command-and-control':  'text-indigo-400',
  'exfiltration':         'text-violet-400',
  'impact':               'text-rose-400',
}

// ── TechCard ──────────────────────────────────────────────────────────────────

export function TechCard({
  tech,
  tactic,
  isSelected,
  onToggle,
  isSubtech = false,
}: {
  tech:       Technique | SubTechnique
  tactic:     Tactic
  isSelected: boolean
  onToggle:   (tech: Technique | SubTechnique, tactic: Tactic) => void
  isSubtech?: boolean
}) {
  return (
    <div
      onClick={() => onToggle(tech, tactic)}
      className={`group relative flex items-center gap-1 px-1.5 py-[3px] rounded cursor-pointer transition-all select-none ${
        isSubtech ? 'ml-2 pl-2 border-l border-white/10' : ''
      } ${
        isSelected
          ? 'bg-accent-green/15 border border-accent-green/40 text-white/90'
          : 'bg-white/[0.03] border border-white/8 text-white/40 hover:bg-white/[0.06] hover:border-white/20 hover:text-white/70'
      }`}
    >
      <span className={`font-mono shrink-0 ${isSubtech ? 'text-[7px]' : 'text-[8px]'} ${isSelected ? 'text-accent-green/80' : 'text-white/30'}`}>
        {tech.id}
      </span>
      <span className={`truncate flex-1 leading-tight ${isSubtech ? 'text-[8px]' : 'text-[9px]'}`}>
        {tech.name}
      </span>
      <a
        href={tech.url}
        target="_blank"
        rel="noopener noreferrer"
        onClick={e => e.stopPropagation()}
        title="Open on MITRE ATT&CK"
        className="opacity-0 group-hover:opacity-60 hover:!opacity-100 shrink-0 transition-opacity"
      >
        <ExternalLink size={7} />
      </a>
    </div>
  )
}

// ── TacticColumn ──────────────────────────────────────────────────────────────

export function TacticColumn({
  tactic,
  selectedKeys,
  onToggle,
  search,
  showSubs,
}: {
  tactic:       Tactic
  selectedKeys: Set<string>
  onToggle:     (tech: Technique | SubTechnique, tactic: Tactic) => void
  search:       string
  showSubs:     boolean
}) {
  const q = search.toLowerCase()

  // Per-technique expand override: undefined = auto (expand if has selected sub or search match),
  // true/false = user-forced open/closed.
  const [expandOverrides, setExpandOverrides] = useState<Map<string, boolean>>(new Map())

  const toggleExpand = (techId: string, currentExpanded: boolean) => {
    setExpandOverrides(prev => {
      const next = new Map(prev)
      next.set(techId, !currentExpanded)
      return next
    })
  }

  const visibleTechs = useMemo(() => {
    if (!q) return tactic.techniques
    return tactic.techniques.filter(t =>
      t.id.toLowerCase().includes(q) ||
      t.name.toLowerCase().includes(q) ||
      t.sub_techniques.some(s =>
        s.id.toLowerCase().includes(q) || s.name.toLowerCase().includes(q)
      )
    )
  }, [tactic.techniques, q])

  const selectedCount = useMemo(() =>
    tactic.techniques.filter(t =>
      selectedKeys.has(`${t.id}|${tactic.short_name}`) ||
      t.sub_techniques.some(s => selectedKeys.has(`${s.id}|${tactic.short_name}`))
    ).length,
    [tactic, selectedKeys]
  )

  const accentColor = TACTIC_HEADER_COLORS[tactic.short_name] ?? 'text-white/60'
  const borderColor = TACTIC_COLORS[tactic.short_name] ?? 'border-t-white/20'

  return (
    <div className={`w-[148px] shrink-0 flex flex-col border-r border-white/5 border-t-2 ${borderColor}`}>
      {/* Sticky header */}
      <div className="sticky top-0 z-10 bg-bg-primary px-1.5 py-1.5 border-b border-white/8">
        <p className={`text-[9px] font-bold uppercase tracking-wide leading-tight truncate ${accentColor}`}>
          {tactic.name}
        </p>
        <p className="text-[8px] text-white/20 font-mono mt-0.5">
          {tactic.id} · {tactic.techniques.length}t
          {selectedCount > 0 && (
            <span className="ml-1 text-accent-green/70">· {selectedCount}✓</span>
          )}
        </p>
      </div>

      {/* Techniques */}
      <div className="flex-1 overflow-y-auto px-1 py-1 space-y-0.5">
        {visibleTechs.length === 0 && (
          <p className="text-[8px] text-white/20 italic px-1 py-2">No match</p>
        )}
        {visibleTechs.map(tech => {
          const techKey   = `${tech.id}|${tactic.short_name}`
          const hasSubs   = showSubs && tech.sub_techniques.length > 0

          // Sub-techniques visible in the current search
          const parentMatches = !q || tech.id.toLowerCase().includes(q) || tech.name.toLowerCase().includes(q)
          const visibleSubs = hasSubs
            ? (parentMatches || !q)
              ? tech.sub_techniques
              : tech.sub_techniques.filter(s =>
                  s.id.toLowerCase().includes(q) || s.name.toLowerCase().includes(q)
                )
            : []

          // Expand logic:
          // - user override takes priority
          // - default: expanded only when at least one sub is selected, or search is active
          const hasSelectedSub = hasSubs && tech.sub_techniques.some(
            s => selectedKeys.has(`${s.id}|${tactic.short_name}`)
          )
          const autoExpand = hasSelectedSub || (!!q && visibleSubs.length > 0)
          const isExpanded = expandOverrides.has(tech.id)
            ? expandOverrides.get(tech.id)!
            : autoExpand

          return (
            <div key={tech.id} className="space-y-0.5">
              {/* Parent row: chevron + card */}
              <div className="flex items-center gap-0.5">
                {/* Expand toggle — only shown when sub-techniques exist */}
                {hasSubs ? (
                  <button
                    onClick={e => { e.stopPropagation(); toggleExpand(tech.id, isExpanded) }}
                    className="shrink-0 w-4 h-full flex items-center justify-center text-white/20 hover:text-white/60 transition-colors"
                    title={isExpanded ? 'Collapse sub-techniques' : 'Expand sub-techniques'}
                  >
                    {isExpanded
                      ? <ChevronDown  size={8} />
                      : <ChevronRight size={8} />
                    }
                  </button>
                ) : (
                  <span className="w-4 shrink-0" />
                )}
                <div className="flex-1 min-w-0">
                  <TechCard
                    tech={tech}
                    tactic={tactic}
                    isSelected={selectedKeys.has(techKey)}
                    onToggle={onToggle}
                  />
                </div>
              </div>

              {/* Sub-techniques — only when expanded */}
              {isExpanded && visibleSubs.length > 0 && (
                <div className="ml-4 pl-1 border-l border-white/10 space-y-0.5">
                  {visibleSubs.map(sub => (
                    <TechCard
                      key={sub.id}
                      tech={sub}
                      tactic={tactic}
                      isSelected={selectedKeys.has(`${sub.id}|${tactic.short_name}`)}
                      onToggle={onToggle}
                      isSubtech
                    />
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── MitreMatrixPicker ─────────────────────────────────────────────────────────

interface MitreMatrixPickerProps {
  selectedKeys: Set<string>            // "T1234.001|initial-access"
  onToggle:     (tech: Technique | SubTechnique, tactic: Tactic) => void
}

export default function MitreMatrixPicker({
  selectedKeys,
  onToggle,
}: MitreMatrixPickerProps) {
  const qc = useQueryClient()
  const [search,   setSearch]   = useState('')
  const [showSubs, setShowSubs] = useState(true)

  // Track how long we have been in the 'downloading' state so we can surface
  // a "Reset stuck download" button if things take too long.
  const [downloadingFor, setDownloadingFor] = useState(0) // seconds
  const downloadTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // ── Status polling ────────────────────────────────────────────────────────
  // refetchInterval handles all polling — no manual setInterval needed.
  const prevStateRef = useRef<string | undefined>(undefined)

  const { data: mitreStatus, refetch: refetchStatus } = useQuery({
    queryKey:        ['mitre-status'],
    queryFn:         mitreApi.status,
    // Poll every 3 s while a download is in progress; stop when done.
    refetchInterval: (q) =>
      q.state.data?.state === 'downloading' ? 3000 : false,
  })

  // When state transitions from 'downloading' → 'ready', flush the technique
  // tree cache so the fresh data is fetched immediately.
  useEffect(() => {
    const prev    = prevStateRef.current
    const current = mitreStatus?.state
    if (prev === 'downloading' && current === 'ready') {
      qc.removeQueries({ queryKey: ['mitre-techniques'] })
    }
    prevStateRef.current = current
  }, [mitreStatus?.state, qc])

  // Count seconds in the downloading state.
  useEffect(() => {
    const isDownloading = mitreStatus?.state === 'downloading'
    if (isDownloading) {
      if (!downloadTimerRef.current) {
        setDownloadingFor(0)
        downloadTimerRef.current = setInterval(() => {
          setDownloadingFor(s => s + 1)
        }, 1000)
      }
    } else {
      if (downloadTimerRef.current) {
        clearInterval(downloadTimerRef.current)
        downloadTimerRef.current = null
      }
      setDownloadingFor(0)
    }
    return () => {
      if (downloadTimerRef.current) {
        clearInterval(downloadTimerRef.current)
        downloadTimerRef.current = null
      }
    }
  }, [mitreStatus?.state])

  // ── Technique tree ────────────────────────────────────────────────────────
  const { data: tree } = useQuery({
    queryKey:  ['mitre-techniques'],
    queryFn:   mitreApi.techniques,
    enabled:   mitreStatus?.available === true,
    staleTime: Infinity,
  })

  // ── Mutations ─────────────────────────────────────────────────────────────
  // Download: rely entirely on refetchInterval for polling — no manual setInterval.
  const downloadMut = useMutation({
    mutationFn: mitreApi.download,
    onSuccess:  () => refetchStatus(),
  })

  // Reset: clear cache files on the server, then re-check status.
  const resetMut = useMutation({
    mutationFn: mitreApi.resetCache,
    onSuccess: () => {
      qc.removeQueries({ queryKey: ['mitre-techniques'] })
      refetchStatus()
    },
  })

  const isDownloading = mitreStatus?.state === 'downloading' || downloadMut.isPending

  // Detect stale cache: tree is available but has no sub-techniques anywhere.
  const hasSubTechniques = tree
    ? tree.tactics.some(t => t.techniques.some(tech => (tech.sub_techniques?.length ?? 0) > 0))
    : true  // assume ok while loading

  // ── Not-available screen ──────────────────────────────────────────────────
  if (!mitreStatus?.available) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-3 text-center px-8">
        <Shield size={32} className="opacity-10" />

        {isDownloading ? (
          <>
            <p className="text-sm text-white/40">Downloading ATT&CK data…</p>
            <RefreshCw size={18} className="animate-spin text-accent-muted/30" />
            <p className="text-xs text-accent-muted/30">
              {downloadingFor > 0 ? `${downloadingFor}s elapsed` : 'Starting download…'}
            </p>
            {/* Show reset button after 60 s — likely stuck */}
            {downloadingFor >= 60 && (
              <div className="flex flex-col items-center gap-2 mt-2">
                <div className="flex items-center gap-1.5 text-amber-400/70 text-xs">
                  <AlertTriangle size={12} />
                  Download appears stuck
                </div>
                <button
                  onClick={() => resetMut.mutate()}
                  disabled={resetMut.isPending}
                  className="flex items-center gap-2 px-3 py-1.5 rounded border border-amber-500/40 text-amber-400 text-xs hover:bg-amber-500/10 transition-colors disabled:opacity-40"
                >
                  <RotateCcw size={12} className={resetMut.isPending ? 'animate-spin' : ''} />
                  Reset and retry
                </button>
              </div>
            )}
          </>
        ) : mitreStatus?.state === 'error' ? (
          <>
            <p className="text-sm text-severity-critical/70">Download failed</p>
            <p className="text-xs text-accent-muted/40 max-w-xs font-mono">{mitreStatus.error}</p>
            <div className="flex gap-2 mt-1">
              <button
                onClick={() => downloadMut.mutate()}
                className="flex items-center gap-2 px-3 py-1.5 rounded border border-accent-green/40 text-accent-green text-xs hover:bg-accent-green/10 transition-colors"
              >
                <RefreshCw size={12} /> Retry download
              </button>
              <button
                onClick={() => resetMut.mutate()}
                disabled={resetMut.isPending}
                className="flex items-center gap-2 px-3 py-1.5 rounded border border-white/10 text-white/40 text-xs hover:text-white hover:border-white/20 transition-colors disabled:opacity-40"
              >
                <RotateCcw size={12} className={resetMut.isPending ? 'animate-spin' : ''} />
                Reset cache
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="text-sm text-white/40">ATT&CK data not downloaded yet.</p>
            <p className="text-xs text-accent-muted/30 max-w-xs">
              The Enterprise ATT&CK dataset (~50 MB) will be downloaded once and cached locally.
            </p>
            <button
              onClick={() => downloadMut.mutate()}
              className="flex items-center gap-2 px-4 py-2 rounded border border-accent-green/40 text-accent-green text-sm hover:bg-accent-green/10 transition-colors"
            >
              <RefreshCw size={14} />
              Download ATT&CK Enterprise
            </button>
          </>
        )}
      </div>
    )
  }

  // ── Main matrix view ──────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full overflow-hidden">

      {/* Stale/incomplete cache warning */}
      {tree && !hasSubTechniques && (
        <div className="shrink-0 flex items-center gap-2 px-3 py-1.5 bg-amber-500/10 border-b border-amber-500/20 text-[10px] text-amber-400">
          <AlertTriangle size={10} className="shrink-0" />
          <span className="flex-1">
            Le cache ATT&CK ne contient pas de sub-techniques — il date probablement d'avant la mise à jour.
            Cliquez "Refresh" pour le régénérer.
          </span>
          <button
            onClick={() => downloadMut.mutate()}
            disabled={isDownloading}
            className="flex items-center gap-1 px-2 py-0.5 rounded border border-amber-500/40 hover:bg-amber-500/10 transition-colors disabled:opacity-40"
          >
            <RotateCcw size={9} className={isDownloading ? 'animate-spin' : ''} />
            Refresh
          </button>
        </div>
      )}

      {/* Toolbar */}
      <div className="shrink-0 flex items-center gap-2 px-3 py-2 border-b border-white/5 bg-bg-secondary/50">
        <div className="relative">
          <Search size={10} className="absolute left-2 top-1/2 -translate-y-1/2 text-accent-muted/30 pointer-events-none" />
          <input
            className="input text-xs h-6 pl-6 w-44"
            placeholder="Filter techniques…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>

        <button
          onClick={() => setShowSubs(v => !v)}
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded border text-[10px] transition-colors ${
            showSubs
              ? 'border-accent-green/30 text-accent-green bg-accent-green/5'
              : 'border-white/8 text-accent-muted/40 hover:text-white hover:border-white/20'
          }`}
          title={showSubs ? 'Hide sub-techniques' : 'Show sub-techniques'}
        >
          {showSubs ? <Eye size={10} /> : <EyeOff size={10} />}
          Sub-tech
        </button>

        {tree?.version && (
          <span className="ml-auto text-[9px] text-accent-muted/30 font-mono">
            {tree.version}
          </span>
        )}

        {/* Re-download button */}
        <button
          onClick={() => downloadMut.mutate()}
          disabled={isDownloading}
          title="Re-download ATT&CK data"
          className="text-accent-muted/30 hover:text-white/60 transition-colors disabled:opacity-30"
        >
          <RotateCcw size={10} className={isDownloading ? 'animate-spin' : ''} />
        </button>

        {selectedKeys.size > 0 && (
          <span className="text-[10px] text-accent-green/70 font-mono">
            {selectedKeys.size} selected
          </span>
        )}
      </div>

      {/* Matrix */}
      <div className="flex-1 overflow-auto bg-bg-primary">
        {isDownloading ? (
          <div className="h-full flex flex-col items-center justify-center gap-3">
            <RefreshCw size={18} className="animate-spin text-accent-muted/30" />
            <p className="text-xs text-accent-muted/30">Rebuilding ATT&CK cache…</p>
          </div>
        ) : tree ? (
          <div className="flex min-w-max h-full">
            {tree.tactics.map(tactic => (
              <TacticColumn
                key={tactic.id}
                tactic={tactic}
                selectedKeys={selectedKeys}
                onToggle={onToggle}
                search={search}
                showSubs={showSubs}
              />
            ))}
          </div>
        ) : (
          <div className="h-full flex items-center justify-center">
            <RefreshCw size={16} className="animate-spin text-accent-muted/30" />
          </div>
        )}
      </div>
    </div>
  )
}
