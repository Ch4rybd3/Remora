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
import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  ExternalLink, Search, Eye, EyeOff, RefreshCw, Shield,
} from 'lucide-react'
import {
  mitreApi,
  type Technique, type SubTechnique, type Tactic,
} from '../../api/mitre'

// ── Tactic colour maps ────────────────────────────────────────────────────────

export const TACTIC_COLORS: Record<string, string> = {
  'reconnaissance':       'border-t-purple-500/60',
  'resource-development': 'border-t-purple-400/60',
  'initial-access':       'border-t-red-500/60',
  'execution':            'border-t-orange-500/60',
  'persistence':          'border-t-yellow-500/60',
  'privilege-escalation': 'border-t-amber-500/60',
  'defense-evasion':      'border-t-lime-500/60',
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
  'defense-evasion':      'text-lime-400',
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
          const techKey = `${tech.id}|${tactic.short_name}`
          const hasSubs = showSubs && tech.sub_techniques.length > 0
          const parentMatches = !q || tech.id.toLowerCase().includes(q) || tech.name.toLowerCase().includes(q)
          const visibleSubs = hasSubs
            ? (parentMatches || !q)
              ? tech.sub_techniques
              : tech.sub_techniques.filter(s =>
                  s.id.toLowerCase().includes(q) || s.name.toLowerCase().includes(q)
                )
            : []

          return (
            <div key={tech.id}>
              <TechCard
                tech={tech}
                tactic={tactic}
                isSelected={selectedKeys.has(techKey)}
                onToggle={onToggle}
              />
              {visibleSubs.length > 0 && (
                <div className="mt-0.5 ml-1 pl-1 border-l border-white/10 space-y-0.5">
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
  const [search,   setSearch]   = useState('')
  const [showSubs, setShowSubs] = useState(true)

  const { data: mitreStatus } = useQuery({
    queryKey: ['mitre-status'],
    queryFn:  mitreApi.status,
  })

  const { data: tree } = useQuery({
    queryKey:  ['mitre-techniques'],
    queryFn:   mitreApi.techniques,
    enabled:   mitreStatus?.available === true,
    staleTime: Infinity,
  })

  if (!mitreStatus?.available) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-3 text-center px-8">
        <Shield size={32} className="opacity-10" />
        <p className="text-sm text-white/40">
          ATT&amp;CK data not downloaded yet.
        </p>
        <p className="text-xs text-accent-muted/30 max-w-xs">
          Open the MITRE ATT&amp;CK tab on any case and click "Download ATT&amp;CK Enterprise" first.
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">

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
        >
          {showSubs ? <Eye size={10} /> : <EyeOff size={10} />}
          Sub-techniques
        </button>

        {tree?.version && (
          <span className="ml-auto text-[9px] text-accent-muted/30 font-mono">
            {tree.version}
          </span>
        )}
        {selectedKeys.size > 0 && (
          <span className="text-[10px] text-accent-green/70 font-mono">
            {selectedKeys.size} selected
          </span>
        )}
      </div>

      {/* Matrix */}
      <div className="flex-1 overflow-auto bg-bg-primary">
        {tree ? (
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
