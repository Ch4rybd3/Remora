/**
 * Right sidebar for Registry timeline selection.
 * Pinned registry entries are pushed individually or in bulk to the case timeline.
 */
import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  X, Send, Trash2, CheckCircle2, Loader2, Clock,
  ChevronRight, ChevronDown, Database,
} from 'lucide-react'
import { timelineApi } from '../../api/timeline'
import type { PinnedRegistryEntry } from '../../api/registry'

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtTs(s: string | null): string {
  if (!s) return '—'
  try { return new Date(s).toISOString().replace('T', ' ').slice(0, 19) } catch { return s }
}

function buildTitle(e: PinnedRegistryEntry): string {
  const name  = e.value_name || '(default)'
  const parts = e.key_path?.split('\\') ?? []
  const leaf  = parts[parts.length - 1] ?? ''
  return leaf ? `${leaf}\\${name}` : name
}

function buildDescription(e: PinnedRegistryEntry): string {
  const lines: string[] = [
    `Source: ${e._filename}`,
    `Type:   Registry key/value`,
    ``,
    `Key path:   ${e.key_path ?? '—'}`,
    `Value name: ${e.value_name || '(default)'}`,
    `Value type: ${e.value_type ?? '—'}`,
    `Value data: ${e.value_data ?? '—'}`,
    `Hive path:  ${e.hive_path ?? '—'}`,
    `Hive type:  ${e.hive_type ?? '—'}`,
  ]
  if (e.deleted?.toLowerCase() === 'true') {
    lines.push('', '⚠ This record was deleted / recovered')
  }
  const rawEntries = Object.entries(e.raw_data)
  if (rawEntries.length > 0) {
    lines.push('', 'Raw CSV columns:')
    rawEntries.forEach(([k, v]) => lines.push(`  ${k}: ${v}`))
  }
  return lines.join('\n')
}

function buildTags(e: PinnedRegistryEntry): string {
  const tags = ['registry', e.hive_type?.toLowerCase() ?? 'generic']
  if (e.deleted?.toLowerCase() === 'true') tags.push('deleted')
  if (e.value_type) tags.push(e.value_type.toLowerCase().replace(/^reg_/, ''))
  return tags.filter(Boolean).join(',')
}

// ── Single pinned card ────────────────────────────────────────────────────────

function PinnedCard({
  entry, caseId, isSent, isLast, onRemove, onSent,
}: {
  entry:    PinnedRegistryEntry
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
      event_ts:    entry.timestamp ?? new Date().toISOString(),
      title:       editTitle,
      description: buildDescription(entry),
      actor:       '',
      source:      `registry:${entry._filename}`,
      tags:        buildTags(entry),
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['timeline', caseId] })
      onSent()
    },
  })

  const details: [string, string][] = [
    ['Key path',   entry.key_path   ?? '—'],
    ['Value name', entry.value_name || '(default)'],
    ['Value type', entry.value_type ?? '—'],
    ['Value data', entry.value_data ?? '—'],
    ['Hive path',  entry.hive_path  ?? '—'],
    ['Hive type',  entry.hive_type  ?? '—'],
    ['Deleted',    entry.deleted ?? '—'],
  ]

  // Also show raw_data entries not already in normalized fields
  const rawExtras = Object.entries(entry.raw_data).slice(0, 6)

  return (
    <div className="relative flex gap-2.5">
      {/* Timeline spine */}
      <div className="flex flex-col items-center shrink-0">
        <div className="w-2 h-2 rounded-full mt-1.5 shrink-0 ring-2 ring-bg-secondary bg-accent-green/60" />
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
          <p className="text-[9px] font-mono text-accent-muted/40">{fmtTs(entry.timestamp)}</p>
        </div>

        {/* Title (editable) */}
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
              className="text-[11px] font-medium text-white leading-snug cursor-pointer hover:text-accent-green/90 transition-colors font-mono"
              title="Click to rename before adding to timeline"
              onClick={() => setEditingTitle(true)}
            >
              {editTitle}
            </p>
          )}
        </div>

        {/* Meta badges */}
        <div className="flex items-center gap-1.5 px-2.5 mb-2 flex-wrap">
          <span className="text-[8px] font-mono px-1 py-0.5 rounded bg-accent-green/10 text-accent-green border border-accent-green/20">
            REG
          </span>
          {entry.hive_type && (
            <span className="text-[8px] font-mono px-1 py-0.5 rounded bg-white/5 text-white/40 border border-white/10">
              {entry.hive_type}
            </span>
          )}
          {entry.value_type && (
            <span className="text-[8px] font-mono px-1 py-0.5 rounded bg-blue-500/10 text-blue-400/70 border border-blue-500/15">
              {entry.value_type.replace('REG_', '')}
            </span>
          )}
          {entry.deleted?.toLowerCase() === 'true' && (
            <span className="text-[8px] px-1 py-0.5 rounded bg-severity-critical/10 text-severity-critical border border-severity-critical/20">
              deleted
            </span>
          )}
        </div>

        {/* Source file */}
        <div className="flex items-center gap-1 px-2.5 mb-2">
          <Database size={9} className="text-accent-muted/25 shrink-0" />
          <span className="text-[9px] text-accent-muted/30 font-mono truncate">{entry._filename}</span>
        </div>

        {/* Key path preview */}
        {entry.key_path && (
          <div className="px-2.5 mb-2">
            <p className="text-[9px] font-mono text-accent-muted/35 truncate" title={entry.key_path}>
              {entry.key_path}
            </p>
          </div>
        )}

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
            {rawExtras.length > 0 && rawExtras.map(([k, v], i) => (
              <div key={`raw-${k}`} className={`flex text-[9px] font-mono min-w-0 ${(details.length + i) % 2 === 0 ? 'bg-white/[0.02]' : ''}`}>
                <span className="w-24 shrink-0 px-2 py-1 text-accent-muted/25 border-r border-white/5 italic">{k}</span>
                <span className="flex-1 px-2 py-1 text-white/30 break-all">{v}</span>
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
      </div>
    </div>
  )
}

// ── Panel ─────────────────────────────────────────────────────────────────────

interface PanelProps {
  entries:  PinnedRegistryEntry[]
  sentKeys: Set<string>
  caseId:   string
  onRemove: (key: string) => void
  onClear:  () => void
  onSent:   (key: string) => void
}

export default function RegistrySelectionPanel({
  entries, sentKeys, caseId, onRemove, onClear, onSent,
}: PanelProps) {
  const qc = useQueryClient()
  const [pushingAll, setPushingAll] = useState(false)

  const handlePushAll = async () => {
    setPushingAll(true)
    for (const e of entries) {
      if (sentKeys.has(e._key)) continue
      try {
        await timelineApi.create(caseId, {
          event_ts:    e.timestamp ?? new Date().toISOString(),
          title:       buildTitle(e),
          description: buildDescription(e),
          actor:       '',
          source:      `registry:${e._filename}`,
          tags:        buildTags(e),
        })
        onSent(e._key)
      } catch {
        // continue on error
      }
    }
    qc.invalidateQueries({ queryKey: ['timeline', caseId] })
    setPushingAll(false)
  }

  if (entries.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-4">
        <div className="text-center space-y-1.5">
          <div className="text-3xl opacity-10">📌</div>
          <p className="text-[10px] text-accent-muted/40">No entries selected</p>
          <p className="text-[9px] text-accent-muted/25">
            Click the bookmark icon on any row to pin it here
          </p>
        </div>
      </div>
    )
  }

  const unsent = entries.filter(e => !sentKeys.has(e._key))

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header actions */}
      <div className="px-3 py-2 border-b border-white/5 flex items-center gap-2 shrink-0">
        <span className="text-[9px] text-accent-muted/40 font-mono">{entries.length} selected</span>
        {unsent.length > 0 && (
          <button
            onClick={handlePushAll}
            disabled={pushingAll}
            className="ml-auto flex items-center gap-1 text-[9px] text-accent-green/70 hover:text-accent-green border border-accent-green/20 hover:border-accent-green/40 bg-accent-green/5 rounded px-2 py-0.5 transition-colors disabled:opacity-40"
          >
            {pushingAll
              ? <><Loader2 size={9} className="animate-spin" /> Adding…</>
              : <><Send size={9} /> Push all ({unsent.length})</>
            }
          </button>
        )}
        <button
          onClick={onClear}
          className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] text-accent-muted/30 hover:text-severity-critical hover:bg-severity-critical/5 transition-colors"
          title="Clear all"
        >
          <Trash2 size={10} />
        </button>
      </div>

      {/* Cards */}
      <div className="flex-1 overflow-y-auto p-3">
        {entries.map((e, i) => (
          <PinnedCard
            key={e._key}
            entry={e}
            caseId={caseId}
            isSent={sentKeys.has(e._key)}
            isLast={i === entries.length - 1}
            onRemove={() => onRemove(e._key)}
            onSent={() => onSent(e._key)}
          />
        ))}
      </div>
    </div>
  )
}
