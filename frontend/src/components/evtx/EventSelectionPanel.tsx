/**
 * Right sidebar for the Filesystem & Logs page.
 *
 * Displays pinned EVTX events in chronological order.
 * Each event can be pushed to the case timeline exactly once (dedup via sent_ids).
 * The selection is persisted to the backend so it survives page navigation.
 */
import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  X, Send, Trash2, CheckCircle2, Loader2, Clock,
  ChevronRight, ChevronDown, HardDrive,
} from 'lucide-react'
import { timelineApi } from '../../api/timeline'
import type { PinnedEvtxEvent } from '../../api/evtx'

// ── Constants ─────────────────────────────────────────────────────────────────

const EVTX_TAG = 'evtx-import'

// ── Helpers ───────────────────────────────────────────────────────────────────

import { fmtDateTime } from '../../utils/dateUtils'
function fmtTime(ts: string | null): string { return fmtDateTime(ts) }

function buildTitle(ev: PinnedEvtxEvent): string {
  const parts: string[] = []
  if (ev.event_id) parts.push(`EID ${ev.event_id}`)
  if (ev.channel)  parts.push(ev.channel.split('/').pop() ?? ev.channel)
  return parts.join(' — ') || 'Windows Event'
}

function buildDescription(ev: PinnedEvtxEvent): string {
  const lines: string[] = [`Source: ${ev._filename}`]
  if (ev.computer) lines.push(`Computer: ${ev.computer}`)
  if (ev.provider) lines.push(`Provider: ${ev.provider}`)
  if (ev.event_data) {
    Object.entries(ev.event_data).slice(0, 8).forEach(([k, v]) => {
      if (v) lines.push(`${k}: ${v}`)
    })
  }
  return lines.join('\n')
}

function buildTags(ev: PinnedEvtxEvent): string {
  const tags = [EVTX_TAG]
  if (ev.event_id) tags.push(`eid-${ev.event_id}`)
  return tags.join(',')
}

/**
 * Full record shipped to the timeline as raw_payload — the record fields plus
 * every EventData key, untruncated. The Timeline tab renders it under a
 * chevron, so the analyst can rewrite title/description freely without ever
 * losing the underlying evidence.
 */
function buildRawPayload(ev: PinnedEvtxEvent): string {
  return JSON.stringify({
    RecordId:    ev.record_id ?? '',
    TimeCreated: ev.time_created ?? '',
    EventId:     ev.event_id ?? '',
    Level:       ev.level_name ?? '',
    Channel:     ev.channel ?? '',
    Provider:    ev.provider ?? '',
    Computer:    ev.computer ?? '',
    UserId:      ev.user_id ?? '',
    SourceFile:  ev._filename,
    ...(ev.event_data ?? {}),
  })
}

/** Fields common to every push, whether sent one by one or in bulk. */
function timelinePayload(ev: PinnedEvtxEvent, title: string, description: string) {
  return {
    event_ts:    ev.time_created ?? new Date().toISOString(),
    title,
    description,
    actor:       ev.computer ?? '',
    source:      ev._filename,
    tags:        buildTags(ev),
    origin:      'artifact' as const,
    raw_payload: buildRawPayload(ev),
    raw_source:  `EVTX · ${ev._filename}`,
  }
}

// ── Level colours ─────────────────────────────────────────────────────────────

const LEVEL_DOT: Record<string, string> = {
  Critical:    'bg-severity-critical',
  Error:       'bg-orange-400',
  Warning:     'bg-yellow-400',
  Information: 'bg-blue-400',
  Verbose:     'bg-white/20',
}

const LEVEL_BADGE: Record<string, string> = {
  Critical:    'border-severity-critical/30 text-severity-critical/80',
  Error:       'border-orange-500/30 text-orange-400/80',
  Warning:     'border-yellow-500/30 text-yellow-400/80',
  Information: 'border-blue-500/20 text-blue-400/70',
  Verbose:     'border-white/10 text-white/30',
}

// ── Single pinned event card ──────────────────────────────────────────────────

interface PinnedRowProps {
  ev:       PinnedEvtxEvent
  caseId:   string
  isSent:   boolean
  isLast:   boolean
  onRemove: () => void
  onSent:   () => void   // called after successful push → parent updates sent_ids
}

function PinnedRow({ ev, caseId, isSent, isLast, onRemove, onSent }: PinnedRowProps) {
  const qc = useQueryClient()
  const [showDetails, setShowDetails] = useState(false)
  const [editTitle,   setEditTitle]   = useState(buildTitle(ev))
  const [editingTitle, setEditingTitle] = useState(false)
  const [editDesc,    setEditDesc]    = useState(buildDescription(ev))
  const [editingDesc, setEditingDesc] = useState(false)

  const push = useMutation({
    mutationFn: () => timelineApi.create(caseId, timelinePayload(ev, editTitle, editDesc)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['timeline', caseId] })
      onSent()
    },
  })

  const dotCls   = LEVEL_DOT[ev.level_name ?? '']   ?? LEVEL_DOT.Information
  const badgeCls = LEVEL_BADGE[ev.level_name ?? ''] ?? LEVEL_BADGE.Information
  const hasData  = ev.event_data && Object.keys(ev.event_data).length > 0

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
          <p className="text-[9px] font-mono text-accent-muted/40">
            {fmtTime(ev.time_created)}
          </p>
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

        {/* Description — click to edit before adding to timeline */}
        <div className="px-2.5 mb-1.5">
          {editingDesc ? (
            <textarea
              autoFocus
              rows={5}
              className="w-full bg-black/30 border border-white/10 rounded px-1.5 py-1 text-[10px] font-mono text-accent-muted resize-y focus:border-accent-green/40 focus:outline-none"
              value={editDesc}
              onChange={e => setEditDesc(e.target.value)}
              onBlur={() => setEditingDesc(false)}
              onKeyDown={e => { if (e.key === 'Escape') setEditingDesc(false) }}
            />
          ) : (
            <p
              className="text-[9px] text-accent-muted/45 leading-snug whitespace-pre-line line-clamp-3 cursor-pointer hover:text-accent-muted/70 transition-colors"
              title="Click to edit the description before sending"
              onClick={() => setEditingDesc(true)}
            >
              {editDesc || <span className="italic opacity-50">Click to add a description...</span>}
            </p>
          )}
        </div>

        {/* Meta chips */}
        <div className="flex flex-wrap gap-1 px-2.5 mb-2">
          {ev.event_id && (
            <span className="text-[9px] font-mono px-1 py-0.5 rounded bg-white/5 text-white/40">
              EID {ev.event_id}
            </span>
          )}
          {ev.level_name && (
            <span className={`text-[9px] font-mono px-1 py-0.5 rounded border ${badgeCls}`}>
              {ev.level_name}
            </span>
          )}
          {ev.computer && (
            <span className="text-[9px] font-mono px-1 py-0.5 rounded bg-white/5 text-white/35 truncate max-w-28" title={ev.computer}>
              {ev.computer}
            </span>
          )}
        </div>

        {/* Source file */}
        <div className="flex items-center gap-1 px-2.5 mb-2">
          <HardDrive size={9} className="text-accent-muted/25 shrink-0" />
          <span className="text-[9px] text-accent-muted/30 font-mono truncate" title={ev._filename}>
            {ev._filename}
          </span>
        </div>

        {/* Details toggle */}
        {hasData && (
          <button
            onClick={() => setShowDetails(v => !v)}
            className="flex items-center gap-1 px-2.5 mb-2 text-[9px] text-accent-muted/35 hover:text-accent-muted/70 transition-colors w-full"
          >
            {showDetails ? <ChevronDown size={9} /> : <ChevronRight size={9} />}
            Details
          </button>
        )}

        {/* EventData details */}
        {showDetails && hasData && (
          <div className="mx-2.5 mb-2 rounded border border-white/6 bg-black/20 overflow-hidden">
            {Object.entries(ev.event_data!).map(([k, v], i) => (
              <div key={k} className={`flex text-[9px] font-mono min-w-0 ${i % 2 === 0 ? 'bg-white/[0.02]' : ''}`}>
                <span className="w-24 shrink-0 px-2 py-1 text-accent-muted/35 border-r border-white/5 truncate" title={k}>
                  {k}
                </span>
                <span className="flex-1 px-2 py-1 text-white/45 break-all">
                  {v || <span className="opacity-30 italic">—</span>}
                </span>
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
  events:   PinnedEvtxEvent[]
  sentIds:  Set<number>
  caseId:   string
  onRemove: (id: number) => void
  onClear:  () => void
  onSent:   (id: number) => void
}

export default function EventSelectionPanel({
  events, sentIds, caseId, onRemove, onClear, onSent,
}: Props) {
  const qc = useQueryClient()
  const [pushingAll, setPushingAll] = useState(false)

  // Sort chronologically
  const sorted = [...events].sort((a, b) => {
    if (!a.time_created) return 1
    if (!b.time_created) return -1
    return new Date(a.time_created).getTime() - new Date(b.time_created).getTime()
  })

  const unsentEvents = sorted.filter(ev => !sentIds.has(ev.id))

  const pushAll = async () => {
    if (unsentEvents.length === 0) return
    setPushingAll(true)
    for (const ev of unsentEvents) {
      try {
        await timelineApi.create(caseId, timelinePayload(ev, buildTitle(ev), buildDescription(ev)))
        onSent(ev.id)
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
          Click the bookmark icon on any event row to pin it here
        </p>
      </div>
    )
  }

  const sentCount   = sorted.filter(ev => sentIds.has(ev.id)).length
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
          <PinnedRow
            key={ev.id}
            ev={ev}
            caseId={caseId}
            isSent={sentIds.has(ev.id)}
            isLast={i === sorted.length - 1}
            onRemove={() => onRemove(ev.id)}
            onSent={() => onSent(ev.id)}
          />
        ))}
      </div>
    </div>
  )
}
