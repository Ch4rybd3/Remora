/**
 * Right sidebar for MFT / USN timeline selection.
 * Accepts a mixed list of pinned MFT and USN entries and lets the analyst
 * push them individually or all at once to the case timeline.
 */
import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  X, Send, Trash2, CheckCircle2, Loader2, Clock,
  ChevronRight, ChevronDown, Database,
} from 'lucide-react'
import { timelineApi } from '../../api/timeline'
import type { PinnedMftEntry } from '../../api/mft'
import type { PinnedUsnEntry } from '../../api/usn'
import { fmtDateTime } from '../../utils/dateUtils'
import { fmtBytes } from '../../utils/formatUtils'

export type PinnedFsEntry = PinnedMftEntry | PinnedUsnEntry

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtTs(s: string | null): string { return fmtDateTime(s) }


function buildTitle(entry: PinnedFsEntry): string {
  if (entry._sourceType === 'mft') {
    const e = entry as PinnedMftEntry
    return e.filename || '(unnamed)'
  } else {
    const e = entry as PinnedUsnEntry
    const reason = e.reason?.split('|')[0].trim() ?? ''
    return `${e.filename || '(unnamed)'}${reason ? ` — ${reason}` : ''}`
  }
}

function buildDescription(entry: PinnedFsEntry): string {
  if (entry._sourceType === 'mft') {
    const e = entry as PinnedMftEntry
    const lines: string[] = [
      `Source: ${e._filename}`,
      `Type: $MFT entry`,
      `Path: ${e.parent_path ?? '—'}`,
      `Entry #: ${e.entry_number}`,
      `Size: ${fmtBytes(e.file_size)}`,
      `Status: ${e.is_deleted ? 'Deleted' : e.is_in_use ? 'Active' : 'Unused'}`,
      '',
      '$STANDARD_INFORMATION:',
      `  Created:     ${fmtTs(e.si_created)}`,
      `  Modified:    ${fmtTs(e.si_modified)}`,
      `  Accessed:    ${fmtTs(e.si_accessed)}`,
      `  MFT Changed: ${fmtTs(e.si_mft_changed)}`,
    ]
    if (e.has_ts_anomaly) lines.push('\n⚠ Timestamp anomaly: $SI < $FN (possible timestomping)')
    return lines.join('\n')
  } else {
    const e = entry as PinnedUsnEntry
    const lines: string[] = [
      `Source: ${e._filename}`,
      `Type: $J USN journal entry`,
      `Reason: ${e.reason ?? '—'}`,
      `Path: ${e.full_path ?? '—'}`,
      `File Ref: ${e.file_ref ?? '—'}`,
      `Parent Ref: ${e.parent_ref ?? '—'}`,
      `USN: ${e.usn ?? '—'}`,
    ]
    return lines.join('\n')
  }
}

function buildTags(entry: PinnedFsEntry): string {
  if (entry._sourceType === 'mft') {
    const e = entry as PinnedMftEntry
    const tags = ['mft', 'filesystem']
    if (e.is_deleted) tags.push('deleted')
    if (e.has_ts_anomaly) tags.push('timestomping')
    if (e.extension) tags.push(e.extension.toLowerCase().replace(/^\./, ''))
    return tags.join(',')
  } else {
    const e = entry as PinnedUsnEntry
    const tags = ['usn', 'filesystem']
    if (e.reason) {
      e.reason.split('|').forEach(r => {
        const t = r.trim().toLowerCase().replace(/\s+/g, '_')
        if (t) tags.push(t)
      })
    }
    return tags.join(',')
  }
}

function getTimestamp(entry: PinnedFsEntry): string {
  if (entry._sourceType === 'mft') {
    const e = entry as PinnedMftEntry
    return e.si_created ?? e.si_modified ?? new Date().toISOString()
  } else {
    const e = entry as PinnedUsnEntry
    return e.update_timestamp ?? new Date().toISOString()
  }
}

// ── Source badge ──────────────────────────────────────────────────────────────

function SourceBadge({ type }: { type: 'mft' | 'usn' }) {
  return type === 'mft'
    ? <span className="text-[8px] font-mono px-1 py-0.5 rounded bg-blue-500/10 text-blue-400 border border-blue-500/20">$MFT</span>
    : <span className="text-[8px] font-mono px-1 py-0.5 rounded bg-purple-500/10 text-purple-400 border border-purple-500/20">$J USN</span>
}

// ── Single pinned card ────────────────────────────────────────────────────────

function PinnedCard({
  entry, caseId, isSent, isLast, onRemove, onSent,
}: {
  entry:    PinnedFsEntry
  caseId:   string
  isSent:   boolean
  isLast:   boolean
  onRemove: () => void
  onSent:   () => void
}) {
  const qc = useQueryClient()
  const [showDetails,  setShowDetails]  = useState(false)
  const [editTitle,    setEditTitle]    = useState(() => buildTitle(entry))
  const [editingTitle, setEditingTitle] = useState(false)

  const push = useMutation({
    mutationFn: () => timelineApi.create(caseId, {
      event_ts:    getTimestamp(entry),
      title:       editTitle,
      description: buildDescription(entry),
      actor:       '',
      source:      `${entry._sourceType}:${entry._filename}`,
      tags:        buildTags(entry),
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['timeline', caseId] })
      onSent()
    },
  })

  const dotCls = entry._sourceType === 'mft' ? 'bg-blue-400' : 'bg-purple-400'

  // Extra detail rows vary by type
  const details =
    entry._sourceType === 'mft'
      ? (() => {
          const e = entry as PinnedMftEntry
          return [
            ['Path',     e.parent_path ?? '—'],
            ['Entry #',  String(e.entry_number)],
            ['Size',     fmtBytes(e.file_size)],
            ['SI Created',  fmtTs(e.si_created)],
            ['SI Modified', fmtTs(e.si_modified)],
            ['Status',   e.is_deleted ? '🗑 Deleted' : 'Active'],
          ]
        })()
      : (() => {
          const e = entry as PinnedUsnEntry
          return [
            ['Reason',     e.reason ?? '—'],
            ['Full Path',  e.full_path ?? '—'],
            ['File Ref',   e.file_ref ?? '—'],
            ['Parent Ref', e.parent_ref ?? '—'],
            ['USN',        e.usn != null ? e.usn.toLocaleString() : '—'],
          ]
        })()

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
          <p className="text-[9px] font-mono text-accent-muted/40">{fmtTs(getTimestamp(entry))}</p>
        </div>

        {/* Title */}
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

        {/* Meta */}
        <div className="flex items-center gap-1.5 px-2.5 mb-2">
          <SourceBadge type={entry._sourceType} />
          {entry._sourceType === 'mft' && (entry as PinnedMftEntry).has_ts_anomaly && (
            <span className="text-[8px] px-1 py-0.5 rounded bg-yellow-400/10 text-yellow-400 border border-yellow-400/20">⚠ TS anomaly</span>
          )}
          {entry._sourceType === 'mft' && (entry as PinnedMftEntry).is_deleted && (
            <span className="text-[8px] px-1 py-0.5 rounded bg-severity-critical/10 text-severity-critical border border-severity-critical/20">deleted</span>
          )}
        </div>

        {/* Source file */}
        <div className="flex items-center gap-1 px-2.5 mb-2">
          <Database size={9} className="text-accent-muted/25 shrink-0" />
          <span className="text-[9px] text-accent-muted/30 font-mono truncate">{entry._filename}</span>
        </div>

        {/* Details toggle */}
        <button
          onClick={() => setShowDetails(v => !v)}
          className="flex items-center gap-1 px-2.5 mb-2 text-[9px] text-accent-muted/35 hover:text-accent-muted/70 transition-colors w-full"
        >
          {showDetails ? <ChevronDown size={9} /> : <ChevronRight size={9} />}
          Details
        </button>

        {showDetails && (
          <div className="mx-2.5 mb-2 rounded border border-white/6 bg-black/20 overflow-hidden">
            {details.map(([k, v], i) => (
              <div key={k} className={`flex text-[9px] font-mono min-w-0 ${i % 2 === 0 ? 'bg-white/[0.02]' : ''}`}>
                <span className="w-24 shrink-0 px-2 py-1 text-accent-muted/35 border-r border-white/5">{k}</span>
                <span className="flex-1 px-2 py-1 text-white/45 break-all">{v}</span>
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
  entries:  PinnedFsEntry[]
  sentKeys: Set<string>
  caseId:   string
  onRemove: (key: string) => void
  onClear:  () => void
  onSent:   (key: string) => void
}

export default function FsSelectionPanel({ entries, sentKeys, caseId, onRemove, onClear, onSent }: Props) {
  const qc = useQueryClient()
  const [pushingAll, setPushingAll] = useState(false)

  const sorted = [...entries].sort((a, b) => {
    const ta = getTimestamp(a)
    const tb = getTimestamp(b)
    return new Date(ta).getTime() - new Date(tb).getTime()
  })

  const unsent     = sorted.filter(e => !sentKeys.has(e._key))
  const sentCount  = sorted.length - unsent.length
  const unsentCount = unsent.length

  const pushAll = async () => {
    if (!unsent.length) return
    setPushingAll(true)
    for (const entry of unsent) {
      try {
        await timelineApi.create(caseId, {
          event_ts:    getTimestamp(entry),
          title:       buildTitle(entry),
          description: buildDescription(entry),
          actor:       '',
          source:      `${entry._sourceType}:${entry._filename}`,
          tags:        buildTags(entry),
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
        <Clock size={20} className="text-accent-muted/20" />
        <p className="text-[11px] text-accent-muted/40">No entries selected</p>
        <p className="text-[9px] text-accent-muted/25 leading-relaxed">
          Click the bookmark icon on any row to add it to the selection
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
            {sorted.length} entr{sorted.length > 1 ? 'ies' : 'y'}
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

      {/* Scrollable list */}
      <div className="flex-1 overflow-y-auto px-3 pt-3">
        {sorted.map((entry, i) => (
          <PinnedCard
            key={entry._key}
            entry={entry}
            caseId={caseId}
            isSent={sentKeys.has(entry._key)}
            isLast={i === sorted.length - 1}
            onRemove={() => onRemove(entry._key)}
            onSent={() => onSent(entry._key)}
          />
        ))}
      </div>
    </div>
  )
}
