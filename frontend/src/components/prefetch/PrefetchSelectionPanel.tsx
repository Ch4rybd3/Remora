/**
 * Right sidebar — selected prefetch entries for case timeline export.
 */
import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { X, Send, Trash2, CheckCircle2, Loader2, Clock, Activity } from 'lucide-react'
import { timelineApi } from '../../api/timeline'
import type { PinnedPrefetchEntry } from '../../api/prefetch'
import { fmtDateTime } from '../../utils/dateUtils'
import { useTimezone } from '../../context/TimezoneContext'

// ── Builders ──────────────────────────────────────────────────────────────────

function buildTitle(e: PinnedPrefetchEntry): string {
  return e.executable_name ? `Execution: ${e.executable_name}` : 'Prefetch execution'
}

function buildDescription(e: PinnedPrefetchEntry): string {
  const lines: string[] = [`Source: ${e._filename}`]
  if (e.executable_name) lines.push(`Executable: ${e.executable_name}`)
  if (e.run_count != null) lines.push(`Run count: ${e.run_count}`)
  if (e.hash)            lines.push(`Hash: ${e.hash}`)
  if (e.version)         lines.push(`Windows version: ${e.version}`)
  if (e.volume0_name)    lines.push(`Volume: ${e.volume0_name}`)
  if (e.source_filename) lines.push(`PF file: ${e.source_filename}`)

  // All run timestamps
  const prevRuns = [e.prev_run_0, e.prev_run_1, e.prev_run_2, e.prev_run_3,
                    e.prev_run_4, e.prev_run_5, e.prev_run_6].filter(Boolean)
  if (prevRuns.length) lines.push(`Previous runs: ${prevRuns.join(', ')}`)

  return lines.join('\n')
}

// ── Single pinned card ────────────────────────────────────────────────────────

interface PinnedCardProps {
  entry:    PinnedPrefetchEntry
  caseId:   string
  isSent:   boolean
  isLast:   boolean
  tz:       string
  onRemove: () => void
  onSent:   () => void
}

function PinnedCard({ entry, caseId, isSent, isLast, tz, onRemove, onSent }: PinnedCardProps) {
  const qc         = useQueryClient()
  const [editTitle, setEditTitle]    = useState(() => buildTitle(entry))
  const [editing,   setEditing]      = useState(false)

  const push = useMutation({
    mutationFn: () => timelineApi.create(caseId, {
      event_ts:    entry.last_run ?? new Date().toISOString(),
      title:       editTitle,
      description: buildDescription(entry),
      actor:       '',
      source:      `prefetch:${entry._filename}`,
      tags:        `prefetch,execution`,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['timeline', caseId] })
      onSent()
    },
  })

  return (
    <div className="relative flex gap-2.5">
      {/* Timeline spine */}
      <div className="flex flex-col items-center shrink-0">
        <div className="w-2 h-2 rounded-full mt-1.5 shrink-0 ring-2 ring-bg-secondary bg-accent-green/70" />
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
            {entry.last_run ? fmtDateTime(entry.last_run) : '—'}
          </p>
        </div>

        {/* Title */}
        <div className="px-2.5 mb-1.5">
          {editing ? (
            <input
              autoFocus
              className="input text-[11px] py-0.5 w-full"
              value={editTitle}
              onChange={e => setEditTitle(e.target.value)}
              onBlur={() => setEditing(false)}
              onKeyDown={e => { if (e.key === 'Enter' || e.key === 'Escape') setEditing(false) }}
            />
          ) : (
            <p
              className="text-[11px] font-medium text-white leading-snug cursor-pointer hover:text-accent-green/90 transition-colors font-mono"
              onClick={() => setEditing(true)}
              title="Click to rename"
            >
              {editTitle}
            </p>
          )}
        </div>

        {/* Meta chips */}
        <div className="flex flex-wrap gap-1 px-2.5 mb-2">
          {entry.run_count != null && (
            <span className="text-[9px] font-mono px-1 py-0.5 rounded bg-accent-green/10 text-accent-green border border-accent-green/20">
              {entry.run_count}× runs
            </span>
          )}
          {entry.version && (
            <span className="text-[9px] font-mono px-1 py-0.5 rounded bg-white/5 text-white/40">
              {entry.version}
            </span>
          )}
          {entry.volume0_name && (
            <span className="text-[9px] font-mono px-1 py-0.5 rounded bg-white/5 text-white/30 truncate max-w-24" title={entry.volume0_name}>
              {entry.volume0_name}
            </span>
          )}
        </div>

        {/* Source file */}
        <div className="flex items-center gap-1 px-2.5 mb-2">
          <Activity size={9} className="text-accent-muted/25 shrink-0" />
          <span className="text-[9px] text-accent-muted/30 font-mono truncate" title={entry._filename}>
            {entry._filename}
          </span>
        </div>

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
  entries:  PinnedPrefetchEntry[]
  sentKeys: Set<string>
  caseId:   string
  onRemove: (key: string) => void
  onClear:  () => void
  onSent:   (key: string) => void
}

export default function PrefetchSelectionPanel({ entries, sentKeys, caseId, onRemove, onClear, onSent }: Props) {
  const { timezone } = useTimezone()
  const qc = useQueryClient()
  const [pushingAll, setPushingAll] = useState(false)

  const sorted = [...entries].sort((a, b) => {
    if (!a.last_run) return 1
    if (!b.last_run) return -1
    return new Date(a.last_run).getTime() - new Date(b.last_run).getTime()
  })

  const unsent    = sorted.filter(e => !sentKeys.has(e._key))
  const sentCount = sorted.length - unsent.length

  const pushAll = async () => {
    if (!unsent.length) return
    setPushingAll(true)
    for (const entry of unsent) {
      try {
        await timelineApi.create(caseId, {
          event_ts:    entry.last_run ?? new Date().toISOString(),
          title:       buildTitle(entry),
          description: buildDescription(entry),
          actor:       '',
          source:      `prefetch:${entry._filename}`,
          tags:        `prefetch,execution`,
        })
        onSent(entry._key)
      } catch { /* continue */ }
    }
    qc.invalidateQueries({ queryKey: ['timeline', caseId] })
    setPushingAll(false)
  }

  if (entries.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 text-center px-4">
        <Activity size={20} className="text-accent-muted/20" />
        <p className="text-[11px] text-accent-muted/40">No entries selected</p>
        <p className="text-[9px] text-accent-muted/25 leading-relaxed">
          Click the bookmark icon on any row to add an execution to the selection
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="shrink-0 px-3 py-2.5 border-b border-white/5 flex items-center gap-2">
        <div className="flex-1 min-w-0">
          <span className="text-[10px] font-semibold tracking-widest uppercase text-accent-muted/50">
            Selection
          </span>
          <span className="ml-1.5 text-[10px] text-accent-muted/30">
            {sorted.length} entry{sorted.length > 1 ? 's' : ''}
            {sentCount > 0 && (
              <span className="text-accent-green/50 ml-1">· {sentCount} sent</span>
            )}
          </span>
        </div>

        {unsent.length > 1 && (
          <button
            onClick={pushAll}
            disabled={pushingAll}
            className="flex items-center gap-1 text-[9px] px-2 py-1 rounded border border-accent-green/25 text-accent-green/70 hover:bg-accent-green/10 hover:border-accent-green/40 transition-colors disabled:opacity-40 shrink-0"
          >
            {pushingAll
              ? <><Loader2 size={9} className="animate-spin" /> Sending…</>
              : <><Send size={9} /> All ({unsent.length})</>
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
        {sorted.map((entry, i) => (
          <PinnedCard
            key={entry._key}
            entry={entry}
            caseId={caseId}
            isSent={sentKeys.has(entry._key)}
            isLast={i === sorted.length - 1}
            tz={timezone}
            onRemove={() => onRemove(entry._key)}
            onSent={() => onSent(entry._key)}
          />
        ))}
      </div>
    </div>
  )
}
