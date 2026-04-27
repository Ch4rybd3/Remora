/**
 * Right sidebar — selected browser events for case timeline export.
 * Pattern mirrors EventSelectionPanel (EVTX) but is client-side only (no backend persistence).
 */
import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { X, Send, Trash2, CheckCircle2, Loader2, Clock, ChevronRight, ChevronDown, Globe } from 'lucide-react'
import { timelineApi } from '../../api/timeline'
import type { PinnedBrowserEntry } from '../../api/browser'

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtTs(s: string | null): string {
  if (!s) return '—'
  try { return new Date(s).toISOString().replace('T', ' ').slice(0, 19) } catch { return s }
}

function domain(url: string | null): string {
  if (!url) return ''
  try { return new URL(url).hostname.replace(/^www\./, '') } catch { return '' }
}

function buildTitle(e: PinnedBrowserEntry): string {
  const rd = e.raw_data ?? {}
  switch (e.artifact_type) {
    case 'history':
      return e.title || domain(e.url) || e.url || 'Browser visit'
    case 'downloads': {
      const target = findRaw(rd, 'Target Path', 'TargetPath', 'target_path') ?? e.url ?? ''
      return target.split(/[\\/]/).pop() || 'Download'
    }
    case 'extensions':
      return `Extension: ${e.title || findRaw(rd, 'Name', 'Extension Name') || '?'}`
    case 'cookies': {
      const name = findRaw(rd, 'Cookie Name', 'Name', 'cookie_name') ?? ''
      return `Cookie: ${name || domain(e.url) || '?'}`
    }
    case 'searches':
      return `Search: ${e.title || e.url || '?'}`
    case 'bookmarks':
      return `Bookmark: ${e.title || domain(e.url) || '?'}`
    default:
      return e.title || e.url || `Browser event (${e.artifact_type})`
  }
}

/** Case-insensitive lookup across raw_data column names. */
function findRaw(rd: Record<string, string>, ...keys: string[]): string | null {
  for (const k of keys) {
    const entry = Object.entries(rd).find(([col]) => col.toLowerCase() === k.toLowerCase())
    if (entry && entry[1]) return entry[1]
  }
  return null
}

function buildDescription(e: PinnedBrowserEntry): string {
  const lines: string[] = [`Source: ${e._filename}`, `Type: ${e.artifact_type}`]
  if (e.url)      lines.push(`URL: ${e.url}`)
  if (e.browser)  lines.push(`Browser: ${e.browser}`)
  if (e.profile)  lines.push(`Profile: ${e.profile}`)
  if (e.username) lines.push(`User: ${e.username}`)
  // Append all raw CSV columns
  const rd = e.raw_data ?? {}
  for (const [col, val] of Object.entries(rd)) {
    if (val) lines.push(`${col}: ${val}`)
  }
  return lines.join('\n')
}

function buildTags(e: PinnedBrowserEntry): string {
  const tags = ['browser', e.artifact_type]
  if (e.browser) tags.push(e.browser.toLowerCase().replace(/\s+/g, '-'))
  return tags.filter(Boolean).join(',')
}

// ── Single pinned card ────────────────────────────────────────────────────────

interface PinnedRowProps {
  ev:       PinnedBrowserEntry
  caseId:   string
  isSent:   boolean
  isLast:   boolean
  onRemove: () => void
  onSent:   () => void
}

const TYPE_DOT: Record<string, string> = {
  history:    'bg-blue-400',
  downloads:  'bg-accent-green',
  extensions: 'bg-purple-400',
  cookies:    'bg-orange-400',
  autofill:   'bg-yellow-400',
  searches:   'bg-teal-400',
  bookmarks:  'bg-pink-400',
}

function PinnedCard({ ev, caseId, isSent, isLast, onRemove, onSent }: PinnedRowProps) {
  const qc = useQueryClient()
  const [showDetails,  setShowDetails]  = useState(false)
  const [editTitle,    setEditTitle]    = useState(() => buildTitle(ev))
  const [editingTitle, setEditingTitle] = useState(false)

  const rd = ev.raw_data ?? {}

  const push = useMutation({
    mutationFn: () => timelineApi.create(caseId, {
      event_ts:    ev.event_timestamp ?? new Date().toISOString(),
      title:       editTitle,
      description: buildDescription(ev),
      actor:       ev.username || ev.browser || '',
      source:      `browser:${ev._filename}`,
      tags:        buildTags(ev),
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['timeline', caseId] })
      onSent()
    },
  })

  const dotCls = TYPE_DOT[ev.artifact_type] ?? 'bg-white/20'

  return (
    <div className="relative flex gap-2.5">
      {/* Timeline spine */}
      <div className="flex flex-col items-center shrink-0">
        <div className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ring-2 ring-bg-secondary ${dotCls}`} />
        {!isLast && <div className="w-px flex-1 bg-white/8 mt-1" />}
      </div>

      {/* Card */}
      <div className={`flex-1 min-w-0 mb-3 rounded-lg border transition-colors ${
        isSent
          ? 'border-accent-green/20 bg-accent-green/4'
          : 'border-white/8 bg-white/[0.02]'
      }`}>

        {/* Timestamp */}
        <div className="flex items-center gap-1.5 px-2.5 pt-2 mb-1">
          <Clock size={9} className="text-accent-muted/30 shrink-0" />
          <p className="text-[9px] font-mono text-accent-muted/40">{fmtTs(ev.event_timestamp)}</p>
        </div>

        {/* Title — click to rename */}
        <div className="px-2.5 mb-1.5">
          {editingTitle ? (
            <input
              autoFocus
              className="input text-[11px] py-0.5 w-full"
              value={editTitle}
              onChange={e => setEditTitle(e.target.value)}
              onBlur={() => setEditingTitle(false)}
              onKeyDown={e => { if (e.key === 'Enter' || e.key === 'Escape') setEditingTitle(false) }}
            />
          ) : (
            <p
              className="text-[11px] font-medium text-white leading-snug cursor-pointer hover:text-accent-green/90 transition-colors"
              title="Click to rename before adding to timeline"
              onClick={() => setEditingTitle(true)}
            >
              {editTitle}
            </p>
          )}
        </div>

        {/* Meta chips */}
        <div className="flex flex-wrap gap-1 px-2.5 mb-2">
          <span className="text-[9px] font-mono px-1 py-0.5 rounded bg-white/5 text-white/40">
            {ev.artifact_type}
          </span>
          {ev.browser && (
            <span className="text-[9px] font-mono px-1 py-0.5 rounded bg-white/5 text-white/35">
              {ev.browser}
            </span>
          )}
          {ev.profile && (
            <span className="text-[9px] font-mono px-1 py-0.5 rounded bg-white/5 text-white/25 truncate max-w-24" title={ev.profile}>
              {ev.profile}
            </span>
          )}
        </div>

        {/* Source file */}
        <div className="flex items-center gap-1 px-2.5 mb-2">
          <Globe size={9} className="text-accent-muted/25 shrink-0" />
          <span className="text-[9px] text-accent-muted/30 font-mono truncate" title={ev._filename}>
            {ev._filename}
          </span>
        </div>

        {/* Raw details toggle */}
        {Object.keys(rd).length > 0 && (
          <button
            onClick={() => setShowDetails(v => !v)}
            className="flex items-center gap-1 px-2.5 mb-2 text-[9px] text-accent-muted/35 hover:text-accent-muted/70 transition-colors w-full"
          >
            {showDetails ? <ChevronDown size={9} /> : <ChevronRight size={9} />}
            Details ({Object.keys(rd).length} columns)
          </button>
        )}

        {showDetails && (
          <div className="mx-2.5 mb-2 rounded border border-white/6 bg-black/20 overflow-hidden">
            {Object.entries(rd).map(([col, val], i) => (
              <div key={col} className={`flex text-[9px] font-mono min-w-0 ${i % 2 === 0 ? 'bg-white/[0.02]' : ''}`}>
                <span className="w-24 shrink-0 px-2 py-1 text-accent-muted/35 border-r border-white/5 truncate" title={col}>
                  {col}
                </span>
                <span className="flex-1 px-2 py-1 text-white/45 break-all">{val}</span>
              </div>
            ))}
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center gap-1.5 px-2.5 pb-2">
          {isSent ? (
            <span className="flex items-center gap-1 text-[9px] text-accent-green/60">
              <CheckCircle2 size={9} /> In timeline
            </span>
          ) : (
            <button
              onClick={() => push.mutate()}
              disabled={push.isPending}
              className="flex items-center gap-1 text-[9px] text-accent-green/70 hover:text-accent-green border border-accent-green/20 hover:border-accent-green/40 bg-accent-green/5 hover:bg-accent-green/10 rounded px-1.5 py-0.5 transition-colors disabled:opacity-40"
            >
              {push.isPending
                ? <><Loader2 size={9} className="animate-spin" /> Adding…</>
                : <><Send size={9} /> → Timeline</>
              }
            </button>
          )}
          <button
            onClick={onRemove}
            className="ml-auto p-0.5 rounded text-accent-muted/20 hover:text-severity-critical transition-colors"
            title="Remove from selection"
          >
            <X size={10} />
          </button>
        </div>

        {push.isError && (
          <p className="text-[9px] text-severity-critical px-2.5 pb-2">
            {(push.error as Error)?.message ?? 'Failed to add'}
          </p>
        )}
      </div>
    </div>
  )
}

// ── Main panel ────────────────────────────────────────────────────────────────

interface Props {
  events:   PinnedBrowserEntry[]
  sentKeys: Set<string>
  caseId:   string
  onRemove: (key: string) => void
  onClear:  () => void
  onSent:   (key: string) => void
}

export default function BrowserSelectionPanel({ events, sentKeys, caseId, onRemove, onClear, onSent }: Props) {
  const qc = useQueryClient()
  const [pushingAll, setPushingAll] = useState(false)

  const sorted = [...events].sort((a, b) => {
    if (!a.event_timestamp) return 1
    if (!b.event_timestamp) return -1
    return new Date(a.event_timestamp).getTime() - new Date(b.event_timestamp).getTime()
  })

  const unsent = sorted.filter(e => !sentKeys.has(e._key))

  const pushAll = async () => {
    if (!unsent.length) return
    setPushingAll(true)
    for (const ev of unsent) {
      try {
        await timelineApi.create(caseId, {
          event_ts:    ev.event_timestamp ?? new Date().toISOString(),
          title:       buildTitle(ev),
          description: buildDescription(ev),
          actor:       ev.username || ev.browser || '',
          source:      `browser:${ev._filename}`,
          tags:        buildTags(ev),
        })
        onSent(ev._key)
      } catch { /* continue on error */ }
    }
    qc.invalidateQueries({ queryKey: ['timeline', caseId] })
    setPushingAll(false)
  }

  if (events.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 text-center px-4">
        <Clock size={20} className="text-accent-muted/20" />
        <p className="text-[11px] text-accent-muted/40">No events selected</p>
        <p className="text-[9px] text-accent-muted/25 leading-relaxed">
          Click the bookmark icon on any row to add it to the selection
        </p>
      </div>
    )
  }

  const sentCount   = sorted.filter(e => sentKeys.has(e._key)).length
  const unsentCount = sorted.length - sentCount

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="shrink-0 px-3 py-2.5 border-b border-white/5 flex items-center gap-2">
        <div className="flex-1 min-w-0">
          <span className="text-[10px] font-semibold tracking-widest uppercase text-accent-muted/50">
            Selection
          </span>
          <span className="ml-1.5 text-[10px] text-accent-muted/30">
            {sorted.length} event{sorted.length > 1 ? 's' : ''}
            {sentCount > 0 && (
              <span className="text-accent-green/50 ml-1">· {sentCount} sent</span>
            )}
          </span>
        </div>

        {unsentCount > 1 && (
          <button
            onClick={pushAll}
            disabled={pushingAll}
            className="flex items-center gap-1 text-[9px] px-2 py-1 rounded border border-accent-green/25 text-accent-green/70 hover:bg-accent-green/10 hover:border-accent-green/40 transition-colors disabled:opacity-40 shrink-0"
            title="Push all unsent events to case timeline"
          >
            {pushingAll
              ? <><Loader2 size={9} className="animate-spin" /> Sending…</>
              : <><Send size={9} /> All ({unsentCount})</>
            }
          </button>
        )}

        <button
          onClick={onClear}
          className="p-1 rounded text-accent-muted/25 hover:text-severity-critical transition-colors shrink-0"
          title="Clear selection"
        >
          <Trash2 size={11} />
        </button>
      </div>

      {/* Scrollable timeline */}
      <div className="flex-1 overflow-y-auto px-3 pt-3">
        {sorted.map((ev, i) => (
          <PinnedCard
            key={ev._key}
            ev={ev}
            caseId={caseId}
            isSent={sentKeys.has(ev._key)}
            isLast={i === sorted.length - 1}
            onRemove={() => onRemove(ev._key)}
            onSent={() => onSent(ev._key)}
          />
        ))}
      </div>
    </div>
  )
}
