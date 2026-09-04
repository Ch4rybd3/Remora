/**
 * The RQL query bar.
 *
 * A textarea sitting on top of a syntax-highlight mirror: both must wrap at
 * exactly the same width or the caret drifts away from the text under it, which
 * is why the scrollbar is hidden in index.css rather than merely styled.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react'

import { AlertCircle, HelpCircle, Play, Terminal, X } from '../../ui/icons'

export const RQL_KW_BOOL    = new Set(['AND','OR','NOT'])
export const RQL_KW_OP      = new Set(['IN','BETWEEN','CONTAINS','STARTSWITH','ENDSWITH','REGEX','CIDR','LAST'])
export const RQL_TOK_RE     = /("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|\b(?:AND|OR|NOT|IN|BETWEEN|CONTAINS|STARTSWITH|ENDSWITH|REGEX|CIDR|LAST|NULL|TRUE|FALSE)\b|>=|<=|!=|[><=~()*,.]+|\d+\.?\d*|[\w@][\w.\-@]*|\s+)/gi

export function highlightRQL(q: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = []
  let last = 0
  for (const m of q.matchAll(RQL_TOK_RE)) {
    if (m.index! > last) nodes.push(<span key={last} className="text-severity-critical">{q.slice(last, m.index)}</span>)
    const tok = m[0]; const up = tok.trim().toUpperCase()
    let cls = 'text-fg/80'
    if (/^["']/.test(tok))           cls = 'text-severity-medium'
    else if (/^\d/.test(tok))        cls = 'text-accent'
    else if (RQL_KW_BOOL.has(up))    cls = 'text-data-2 font-semibold'
    else if (RQL_KW_OP.has(up))      cls = 'text-severity-high'
    else if (up === '~')             cls = 'text-accent'
    else if (/^[><=!]+$/.test(tok))  cls = 'text-severity-low'
    else if (/^[(),.]+$/.test(tok))  cls = 'text-fg/40'
    else if (/^[\w@]/.test(tok) && tok.trim()) cls = 'text-data-5'
    nodes.push(<span key={m.index} className={cls}>{tok}</span>)
    last = m.index! + tok.length
  }
  if (last < q.length) nodes.push(<span key={last} className="text-severity-critical">{q.slice(last)}</span>)
  return nodes
}

export const RQL_EXAMPLES = [
  { label: 'Equality',       q: 'EventID = "4624"' },
  { label: 'AND / OR',       q: 'EventID = "4624" AND Channel = "Security"' },
  { label: 'Contains',       q: 'Computer contains "DC" AND CommandLine contains "powershell"' },
  { label: 'IN list',        q: 'EventID IN ("4624", "4625", "4648", "4768")' },
  { label: 'NOT IN',         q: 'EventID NOT IN ("4634", "4647")' },
  { label: 'Wildcard',       q: 'Computer = "DC-*" AND User = "adm?n"' },
  { label: 'Numeric range',  q: 'EventID BETWEEN 4600 AND 4700' },
  { label: 'Comparison',     q: 'ProcessId > 1000 AND ProcessId <= 9999' },
  { label: 'Regex',          q: 'CommandLine REGEX "powershell.*-enc.*"' },
  { label: 'CIDR',           q: 'IpAddress CIDR "10.0.0.0/8"' },
  { label: 'Last 2h',        q: '@timestamp LAST 2 h' },
  { label: 'Full-text',      q: '~ "mimikatz"' },
  { label: 'Wildcard col',  q: '* contains "mimikatz"' },
  { label: 'Wildcard REGEX',q: '* REGEX "^\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}$"' },
  { label: 'Grouped',       q: '(EventID = "4624" OR EventID = "4625") AND NOT Computer = "WORKSTATION01"' },
]

/** Tallest the query box grows before it starts scrolling (≈6 lines). */
export const RQL_MAX_HEIGHT = 120

// ── RQLBar ────────────────────────────────────────────────────────────────────

export function RQLBar({ value, onChange, onRun, dirty, error, columns, hasActiveFilters }: {
  value:            string
  onChange:         (v: string) => void
  onRun:            (v: string) => void
  /** The box has been edited since the last run - results below are stale. */
  dirty:            boolean
  error:            string | null
  columns:          string[]
  hasActiveFilters: boolean
}) {
  const [showHelp, setShowHelp] = useState(false)
  const [autocomplete, setAutocomplete] = useState<string[]>([])
  const [acIndex, setAcIndex]   = useState(-1)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const mirrorRef = useRef<HTMLDivElement>(null)

  // Keep the highlight mirror glued to the textarea on both axes — past the
  // 120 px cap the textarea scrolls, and an unsynced mirror would leave the
  // visible lines unpainted (the textarea's own text is transparent).
  const syncScroll = () => {
    if (inputRef.current && mirrorRef.current) {
      mirrorRef.current.scrollTop  = inputRef.current.scrollTop
      mirrorRef.current.scrollLeft = inputRef.current.scrollLeft
    }
  }

  // Auto-height, capped — then re-sync so the mirror matches the new box
  useEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, RQL_MAX_HEIGHT) + 'px'
    syncScroll()
  }, [value])

  // Column autocomplete — show when last word looks like an identifier start
  useEffect(() => {
    if (!columns.length) return
    const before = value.slice(0, inputRef.current?.selectionStart ?? value.length)
    const lastWord = before.match(/[\w@][\w.\-@]*$/)?.[0] ?? ''
    if (lastWord.length < 1) { setAutocomplete([]); return }
    const matches = columns.filter(c => c.toLowerCase().startsWith(lastWord.toLowerCase()) && c !== lastWord)
    setAutocomplete(matches.slice(0, 8))
    setAcIndex(-1)
  }, [value, columns])

  const applyAutocomplete = (col: string) => {
    const pos = inputRef.current?.selectionStart ?? value.length
    const lastWord = value.slice(0, pos).match(/[\w@][\w.\-@]*$/)?.[0] ?? ''
    const newVal = value.slice(0, pos - lastWord.length) + col + value.slice(pos)
    onChange(newVal)
    setAutocomplete([])
    setTimeout(() => inputRef.current?.focus(), 0)
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (autocomplete.length > 0) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setAcIndex(i => Math.min(i + 1, autocomplete.length - 1)); return }
      if (e.key === 'ArrowUp')   { e.preventDefault(); setAcIndex(i => Math.max(i - 1, 0)); return }
      if (e.key === 'Tab' || e.key === 'Enter') {
        if (acIndex >= 0) { e.preventDefault(); applyAutocomplete(autocomplete[acIndex]); return }
        if (e.key === 'Tab') { e.preventDefault(); applyAutocomplete(autocomplete[0]); return }
      }
      if (e.key === 'Escape') { setAutocomplete([]); return }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      onRun(value)
    }
  }

  const highlighted = useMemo(() => highlightRQL(value), [value])

  return (
    <div className="border-b border-hairline bg-panel/20 shrink-0">
      {/* Bar header */}
      <div className="flex items-center gap-2 px-3 pt-2 pb-1">
        <Terminal size={10} className="text-accent/60 shrink-0" />
        <span className="text-label font-semibold uppercase tracking-widest text-accent/60">RQL Query</span>
        {dirty ? (
          <button onClick={() => onRun(value)}
            className="ml-1 flex items-center gap-1 text-label text-severity-medium hover:text-severity-medium/70 transition-colors">
            <Play size={9} />
            Not applied - press Enter to run
          </button>
        ) : (
          <span className="text-label text-fg-secondary/25 ml-1">Enter to run - Tab to complete</span>
        )}
        <div className="ml-auto flex items-center gap-1">
          {value && (
            <button onClick={() => { onChange(''); onRun('') }}
              className="p-1 text-fg-secondary/30 hover:text-fg transition-colors" title="Clear query">
              <X size={10} />
            </button>
          )}
          <button onClick={() => setShowHelp(h => !h)}
            className={`p-1 transition-colors ${showHelp ? 'text-accent' : 'text-fg-secondary/40 hover:text-fg'}`}
            title="Query examples">
            <HelpCircle size={12} />
          </button>
        </div>
      </div>

      {/* Input area with syntax-highlight overlay.
          The mirror paints the colours and the textarea's own glyphs are
          transparent, so both boxes must wrap identically — same padding, same
          1 px border, same `pre-wrap`. A `whitespace-pre` mirror is exactly why
          a query wrapping onto a second line used to render invisible. */}
      <div className="relative mx-3 mb-2 rounded-control bg-white/[0.04]">
        {/* Mirror div for syntax highlighting */}
        <div ref={mirrorRef} aria-hidden
          className="absolute inset-0 px-2.5 py-1.5 font-mono text-label leading-relaxed overflow-hidden pointer-events-none select-none border border-transparent rounded-control"
          style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', overflowWrap: 'anywhere' }}>
          {value ? highlighted : null}
        </div>
        {/* Actual textarea */}
        <textarea
          ref={inputRef}
          value={value}
          onChange={e => { onChange(e.target.value); syncScroll() }}
          onKeyDown={handleKeyDown}
          onScroll={syncScroll}
          placeholder='EventID = "4624" AND Computer contains "DC" ...'
          rows={1}
          className={`rql-input relative w-full resize-none font-mono text-label leading-relaxed bg-transparent border rounded-control px-2.5 py-1.5 outline-none transition-colors placeholder:text-fg-secondary/20 overflow-y-auto overflow-x-hidden ${error ? 'border-severity-critical/40 text-transparent caret-severity-critical' : dirty ? 'border-severity-medium/40 text-transparent caret-white' : value ? 'border-accent/25 text-transparent caret-white' : 'border-hairline text-fg/80'}`}
          style={{
            minHeight:    32,
            maxHeight:    RQL_MAX_HEIGHT,
            whiteSpace:   'pre-wrap',
            wordBreak:    'break-word',
            overflowWrap: 'anywhere',
          }}
          spellCheck={false}
        />

        {/* Autocomplete dropdown */}
        {autocomplete.length > 0 && (
          <div className="absolute left-0 top-full mt-0.5 z-50 bg-panel border border-hairline shadow-xl overflow-hidden min-w-[160px]">
            {autocomplete.map((col, i) => (
              <button key={col} onClick={() => applyAutocomplete(col)}
                className={`flex items-center gap-2 w-full px-3 py-1.5 text-left text-label font-mono transition-colors ${i === acIndex ? 'bg-accent/10 text-accent' : 'text-fg/70 hover:bg-fg/5'}`}>
                <span className="text-label text-fg-secondary/30 font-sans">col</span>
                {col}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="flex items-center gap-1.5 mx-3 mb-2 px-2 py-1 rounded-control bg-severity-critical/10 border border-severity-critical/20 text-label text-severity-critical">
          <AlertCircle size={10} className="shrink-0" />
          {error}
        </div>
      )}

      {/* Warning: column filters + RQL are ANDed — can narrow OR results unexpectedly */}
      {value && hasActiveFilters && !error && (
        <div className="flex items-center gap-1.5 mx-3 mb-2 px-2 py-1 rounded-control bg-severity-medium/8 border border-severity-medium/20 text-label text-severity-medium/80">
          <AlertCircle size={10} className="shrink-0" />
          Column filters are active and apply as AND alongside the RQL query - OR results may be narrowed.
        </div>
      )}

      {/* Help / examples panel */}
      {showHelp && (
        <div className="mx-3 mb-2 border border-hairline overflow-hidden">
          <div className="px-3 py-1.5 bg-white/[0.02] border-b border-hairline">
            <p className="text-label uppercase tracking-widest text-fg-secondary/40">Query examples - click to insert</p>
          </div>
          <div className="grid grid-cols-2 gap-0 max-h-52 overflow-y-auto">
            {RQL_EXAMPLES.map(ex => (
              <button key={ex.q} onClick={() => { onChange(ex.q); onRun(ex.q); setShowHelp(false) }}
                className="flex flex-col items-start px-3 py-2 hover:bg-white/[0.04] transition-colors border-b border-r border-strong/[0.04] text-left">
                <span className="text-label text-fg-secondary/40 uppercase tracking-wider">{ex.label}</span>
                <span className="text-label font-mono text-accent/70 mt-0.5 truncate w-full">{ex.q}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
