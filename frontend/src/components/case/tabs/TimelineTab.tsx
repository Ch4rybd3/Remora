import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2, Clock, Pencil, ChevronRight, Copy } from 'lucide-react'
import { timelineApi } from '../../../api/timeline'
import { iocsApi } from '../../../api/iocs'
import { assetsApi } from '../../../api/assets'
import type { TimelineEvent, TimelineOrigin, IOC, Asset } from '../../../types'
import type { Suggestion } from '../../ui/SuggestInput'
import type { InputTag } from '../../ui/TagInput'
import { fmtDateTime } from '../../../utils/dateUtils'
import Modal from '../../ui/Modal'
import ConfirmDialog from '../../ui/ConfirmDialog'
import EmptyState from '../../ui/EmptyState'
import SuggestInput from '../../ui/SuggestInput'
import TagInput from '../../ui/TagInput'

interface Props { caseId: string }

const empty = (): Partial<TimelineEvent> => ({
  event_ts: new Date().toISOString().slice(0, 16),
  title: '', description: '', actor: '', source: '', tags: '',
})

// ── Colors ──────────────────────────────────────────────────────────────────

const IOC_COLORS: Record<string, string> = {
  ip:          'bg-red-500/10 text-red-400 border-red-500/20',
  domain:      'bg-orange-500/10 text-orange-400 border-orange-500/20',
  url:         'bg-orange-400/10 text-orange-300 border-orange-400/20',
  hash_md5:    'bg-purple-500/10 text-purple-400 border-purple-500/20',
  hash_sha1:   'bg-purple-500/10 text-purple-400 border-purple-500/20',
  hash_sha256: 'bg-purple-500/10 text-purple-400 border-purple-500/20',
  email:       'bg-blue-500/10 text-blue-400 border-blue-500/20',
  filename:    'bg-yellow-500/10 text-yellow-400 border-yellow-500/20',
  registry:    'bg-pink-500/10 text-pink-400 border-pink-500/20',
  user_agent:  'bg-cyan-500/10 text-cyan-400 border-cyan-500/20',
  other:       'bg-white/5 text-accent-muted border-white/10',
}

const ASSET_COLOR = (asset: Asset) =>
  asset.compromised
    ? 'bg-severity-critical/10 text-severity-critical border-severity-critical/20'
    : 'bg-accent-green/10 text-accent-green/80 border-accent-green/20'

const CUSTOM_COLOR = 'bg-white/5 text-accent-muted border-white/10'

/** Provenance badge — tells at a glance where an event came from. */
const ORIGIN_META: Record<TimelineOrigin, { label: string; cls: string }> = {
  manual:       { label: 'Manuel',       cls: 'bg-white/5 text-accent-muted border-white/10' },
  incident_log: { label: 'Incident log', cls: 'bg-blue-500/10 text-blue-400 border-blue-500/20' },
  artifact:     { label: 'Artefact',     cls: 'bg-accent-green/10 text-accent-green/80 border-accent-green/20' },
  ioc:          { label: 'IOC',          cls: 'bg-purple-500/10 text-purple-400 border-purple-500/20' },
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Parse the stored raw_payload JSON into ordered key/value pairs. */
function parseRawPayload(raw: string | null): [string, string][] | null {
  if (!raw) return null
  try {
    const obj = JSON.parse(raw)
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null
    const entries = Object.entries(obj).map(
      ([k, v]) => [k, v == null ? '' : String(v)] as [string, string]
    )
    return entries.length ? entries : null
  } catch {
    return null
  }
}

/**
 * Full source record, collapsed behind a chevron so it never competes with the
 * analyst-authored title/description above it.
 */
function RawPayloadPanel({ entries, source }: { entries: [string, string][]; source: string }) {
  const [open, setOpen] = useState(false)

  return (
    <div className="mt-2">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1 text-[11px] text-accent-muted/60 hover:text-accent-green transition-colors"
      >
        <ChevronRight size={11} className={`transition-transform ${open ? 'rotate-90' : ''}`} />
        Event brut
        <span className="text-accent-muted/40">({entries.length} champs{source ? ` · ${source}` : ''})</span>
      </button>

      {open && (
        <div className="mt-1.5 rounded border border-white/5 bg-black/20 overflow-hidden">
          <div className="flex justify-end px-2 pt-1.5">
            <button
              onClick={() => navigator.clipboard.writeText(
                entries.map(([k, v]) => `${k}: ${v}`).join('\n')
              )}
              className="flex items-center gap-1 text-[10px] text-accent-muted/50 hover:text-accent-green transition-colors"
              title="Copier l'event brut"
            >
              <Copy size={10} /> Copier
            </button>
          </div>
          <div className="max-h-72 overflow-auto">
            <table className="w-full text-[11px] font-mono">
              <tbody>
                {entries.map(([k, v]) => (
                  <tr key={k} className="border-t border-white/5 align-top">
                    <td className="px-2 py-1 text-accent-muted/70 whitespace-nowrap w-px">{k}</td>
                    <td className="px-2 py-1 text-accent-muted break-all">{v || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

function buildSuggestions(iocs: IOC[], assets: Asset[]): Suggestion[] {
  const iocSugg: Suggestion[] = iocs.map(ioc => ({
    value: ioc.value,
    label: ioc.value,
    sublabel: ioc.description || ioc.type,
    badge: ioc.type.replace('hash_', '').toUpperCase(),
    badgeColor: IOC_COLORS[ioc.type] ?? CUSTOM_COLOR,
  }))

  const assetSugg: Suggestion[] = assets.map(asset => ({
    value: asset.name,
    label: asset.name,
    sublabel: [asset.ip_address, asset.hostname].filter(Boolean).join(' · ') || asset.type,
    badge: asset.type.replace('_', ' '),
    badgeColor: ASSET_COLOR(asset),
  }))

  return [...iocSugg, ...assetSugg]
}

/** Serialize tags → comma-separated string for the backend */
function tagsToString(tags: InputTag[]): string {
  return tags.map(t => t.value).join(', ')
}

/** Deserialize stored actor string → InputTag[] with color lookup */
function stringToTags(actor: string, iocs: IOC[], assets: Asset[]): InputTag[] {
  if (!actor) return []
  return actor.split(',').map(v => {
    const val = v.trim()
    const ioc = iocs.find(i => i.value === val)
    if (ioc) return { value: val, badgeColor: IOC_COLORS[ioc.type] ?? CUSTOM_COLOR }
    const asset = assets.find(a => a.name === val)
    if (asset) return { value: val, badgeColor: ASSET_COLOR(asset) }
    return { value: val, badgeColor: CUSTOM_COLOR }
  }).filter(t => t.value)
}

// ── Component ────────────────────────────────────────────────────────────────

export default function TimelineTab({ caseId }: Props) {
  const qc = useQueryClient()

  const { data: events = [] } = useQuery({
    queryKey: ['timeline', caseId],
    queryFn: () => timelineApi.list(caseId),
  })
  const { data: iocs = [] } = useQuery({
    queryKey: ['iocs', caseId],
    queryFn: () => iocsApi.list(caseId),
  })
  const { data: assets = [] } = useQuery({
    queryKey: ['assets', caseId],
    queryFn: () => assetsApi.list(caseId),
  })

  const suggestions = useMemo(() => buildSuggestions(iocs, assets), [iocs, assets])

  const [modalOpen,   setModalOpen]   = useState(false)
  const [editingId,   setEditingId]   = useState<string | null>(null)
  const [form,        setForm]        = useState<Partial<TimelineEvent>>(empty())
  const [actorTags,   setActorTags]   = useState<InputTag[]>([])
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)

  const isEditing = editingId !== null

  const openCreate = () => {
    setEditingId(null)
    setForm(empty())
    setActorTags([])
    setModalOpen(true)
  }

  const openEdit = (ev: TimelineEvent) => {
    setEditingId(ev.id)
    setForm({
      event_ts:    ev.event_ts?.slice(0, 16),
      title:       ev.title,
      description: ev.description,
      source:      ev.source,
      actor:       ev.actor,
      tags:        ev.tags,
    })
    setActorTags(stringToTags(ev.actor, iocs, assets))
    setModalOpen(true)
  }

  const closeModal = () => {
    setModalOpen(false)
    setEditingId(null)
  }

  const create = useMutation({
    mutationFn: () =>
      timelineApi.create(caseId, {
        ...form,
        actor:    tagsToString(actorTags),
        event_ts: new Date(form.event_ts!).toISOString(),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['timeline', caseId] })
      qc.invalidateQueries({ queryKey: ['cases'] })
      closeModal()
      setForm(empty())
      setActorTags([])
    },
  })

  const update = useMutation({
    mutationFn: () =>
      timelineApi.update(caseId, editingId!, {
        ...form,
        actor:    tagsToString(actorTags),
        event_ts: new Date(form.event_ts!).toISOString(),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['timeline', caseId] })
      closeModal()
    },
  })

  const remove = useMutation({
    mutationFn: (id: string) => timelineApi.delete(caseId, id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['timeline', caseId] })
      qc.invalidateQueries({ queryKey: ['cases'] })
    },
  })

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-accent-green font-semibold text-sm uppercase tracking-wide">
          Timeline
          <span className="ml-2 text-accent-muted font-normal normal-case">({events.length})</span>
        </h3>
        <button className="btn-primary text-xs flex items-center gap-1.5" onClick={openCreate}>
          <Plus size={13} /> Add Event
        </button>
      </div>

      {events.length === 0 ? (
        <EmptyState
          icon={Clock}
          message="No timeline events recorded"
          action={{ label: '+ Add Event', onClick: openCreate }}
        />
      ) : (
        <div className="relative">
          <div className="absolute left-[7px] top-0 bottom-0 w-px bg-white/5" />
          <div className="space-y-0">
            {events.map(ev => {
              const actors = stringToTags(ev.actor, iocs, assets)
              const raw    = parseRawPayload(ev.raw_payload)
              const origin = ORIGIN_META[ev.origin] ?? ORIGIN_META.manual
              return (
                <div key={ev.id} className="relative pl-8 pb-6 group">
                  <div className="absolute left-0 top-1 w-3.5 h-3.5 rounded-full border-2 border-accent-green bg-bg-primary" />
                  <div className="card p-4 hover:bg-bg-hover transition-colors">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap mb-1">
                          <span className="text-xs font-mono text-accent-green shrink-0">
                            {fmtDateTime(ev.event_ts)}
                          </span>
                          <span className={`text-[10px] px-1.5 py-0.5 rounded border shrink-0 ${origin.cls}`}>
                            {origin.label}
                          </span>
                          {ev.source && (
                            <span className="text-xs text-accent-muted/60 shrink-0">via {ev.source}</span>
                          )}
                        </div>

                        <p className="text-sm font-medium text-white mb-1.5">{ev.title}</p>

                        {actors.length > 0 && (
                          <div className="flex flex-wrap gap-1.5 mb-1.5">
                            {actors.map((tag, i) => (
                              <span
                                key={tag.value + i}
                                className={`text-xs font-mono px-2 py-0.5 rounded border ${tag.badgeColor}`}
                              >
                                {tag.value}
                              </span>
                            ))}
                          </div>
                        )}

                        {ev.description && (
                          <p className="text-xs text-accent-muted mt-1 leading-relaxed whitespace-pre-wrap">{ev.description}</p>
                        )}

                        {raw && <RawPayloadPanel entries={raw} source={ev.raw_source} />}
                      </div>
                      <div className="flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                        <button
                          onClick={() => openEdit(ev)}
                          className="text-accent-muted/30 hover:text-accent-green transition-colors"
                          title="Edit event"
                        >
                          <Pencil size={12} />
                        </button>
                        <button
                          onClick={() => setDeleteTarget(ev.id)}
                          className="text-accent-muted/30 hover:text-severity-critical transition-colors"
                          title="Delete event"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      <Modal open={modalOpen} onClose={closeModal} title={isEditing ? 'Edit Timeline Event' : 'Add Timeline Event'} size="md">
        <div className="space-y-4">
          <div>
            <label className="label">Timestamp</label>
            <input
              type="datetime-local"
              className="input font-mono"
              value={typeof form.event_ts === 'string' ? form.event_ts.slice(0, 16) : ''}
              onChange={e => setForm(f => ({ ...f, event_ts: e.target.value }))}
            />
          </div>

          <div>
            <label className="label">Event Title</label>
            <SuggestInput
              value={form.title ?? ''}
              onChange={v => setForm(f => ({ ...f, title: v }))}
              suggestions={suggestions}
              placeholder="Describe the event, or type an IOC / asset…"
            />
          </div>

          <div>
            <label className="label">Actor(s)</label>
            <TagInput
              tags={actorTags}
              onChange={setActorTags}
              suggestions={suggestions}
              placeholder="Type an IOC, asset, or custom actor…"
            />
          </div>

          <div>
            <label className="label">Source</label>
            <input
              className="input"
              placeholder="SIEM, EDR, logs, memory dump…"
              value={form.source}
              onChange={e => setForm(f => ({ ...f, source: e.target.value }))}
            />
          </div>

          <div>
            <label className="label">Description</label>
            <textarea
              className="input resize-none h-24"
              placeholder="Detailed description of the event…"
              value={form.description}
              onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
            />
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button className="btn-secondary" onClick={closeModal}>Cancel</button>
            <button
              className="btn-primary"
              onClick={() => isEditing ? update.mutate() : create.mutate()}
              disabled={!form.title || !form.event_ts || create.isPending || update.isPending}
            >
              {create.isPending || update.isPending
                ? (isEditing ? 'Saving…' : 'Adding…')
                : (isEditing ? 'Save Changes' : 'Add Event')
              }
            </button>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => deleteTarget && remove.mutate(deleteTarget)}
        title="Delete Event"
        message="This timeline event will be permanently removed."
      />
    </div>
  )
}
