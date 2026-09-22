import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2, Pencil, ScrollText, Download } from '../../../ui/icons'
import { incidentLogApi } from '../../../api/incidentLog'
import { assetsApi } from '../../../api/assets'
import type { IncidentLogEntry, IncidentLogCategory } from '../../../types'
import type { Suggestion } from '../../ui/SuggestInput'
import type { InputTag } from '../../ui/TagInput'
import { useAuth } from '../../../context/AuthContext'
import { fmtDateTime } from '../../../utils/dateUtils'
import { CUSTOM_TAG_COLOR, stringToTags, tagsToString } from '../actorTags'
import Modal from '../../ui/Modal'
import TagInput from '../../ui/TagInput'
import ConfirmDialog from '../../ui/ConfirmDialog'
import EmptyState from '../../ui/EmptyState'

interface Props { caseId: string; caseTitle: string }

const CATEGORY_META: Record<IncidentLogCategory, { label: string; color: string }> = {
  remediation:   { label: 'Remediation',          color: 'bg-accent/10 text-accent border-accent/20' },
  handover:      { label: 'Handover',             color: 'bg-severity-low/10 text-severity-low border-severity-low/20' },
  communication: { label: 'Client communication', color: 'bg-data-2/10 text-data-2 border-data-2/20' },
  investigation: { label: 'Investigation',        color: 'bg-severity-high/10 text-severity-high border-severity-high/20' },
  other:         { label: 'Other',                color: 'bg-fg/5 text-fg-secondary border-hairline' },
}

const YOU_COLOR   = 'bg-accent/10 text-accent/80 border-accent/20'
const ASSET_COLOR = 'bg-data-5/10 text-data-5 border-data-5/20'

const empty = (): Partial<IncidentLogEntry> => ({
  event_ts: new Date().toISOString().slice(0, 16),
  category: 'remediation',
  title: '', description: '', actor: '',
})

export default function IncidentLogTab({ caseId, caseTitle }: Props) {
  const qc = useQueryClient()
  const { user } = useAuth()

  const { data: entries = [] } = useQuery({
    queryKey: ['incidentLog', caseId],
    queryFn: () => incidentLogApi.list(caseId),
  })
  const { data: assets = [] } = useQuery({
    queryKey: ['assets', caseId],
    queryFn: () => assetsApi.list(caseId),
  })

  /**
   * Who can plausibly be the actor of an entry, most likely first.
   *
   * Drawn from what this case already contains rather than from the account
   * directory, which an analyst without the admin permission cannot read.
   * Offering back the names the log already uses is also what keeps one
   * responder from appearing as three spellings across a handover document.
   */
  const actorSuggestions = useMemo<Suggestion[]>(() => {
    const seen  = new Set<string>()
    const out: Suggestion[] = []

    const push = (value: string, sublabel: string, badge: string, badgeColor: string) => {
      const key = value.trim().toLowerCase()
      if (!key || seen.has(key)) return
      seen.add(key)
      out.push({ value: value.trim(), label: value.trim(), sublabel, badge, badgeColor })
    }

    if (user) push(user.username, 'Signed in as you', 'you', YOU_COLOR)

    for (const e of entries) {
      for (const value of e.actor.split(',')) {
        push(value, 'Already used in this log', 'log', CUSTOM_TAG_COLOR)
      }
    }

    for (const asset of assets) {
      const detail = [asset.ip_address, asset.hostname].filter(Boolean).join(' - ')
      push(asset.name, detail || 'Case asset', asset.type.replace('_', ' '), ASSET_COLOR)
    }

    return out
  }, [user, entries, assets])

  const actorColor = (value: string) =>
    actorSuggestions.find(s => s.value.toLowerCase() === value.toLowerCase())?.badgeColor
      ?? CUSTOM_TAG_COLOR

  const [modalOpen, setModalOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<Partial<IncidentLogEntry>>(empty())
  const [actorTags, setActorTags] = useState<InputTag[]>([])
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)

  const isEditing = editingId !== null

  const openCreate = () => {
    setEditingId(null)
    setForm(empty())
    setActorTags([])
    setModalOpen(true)
  }

  const openEdit = (e: IncidentLogEntry) => {
    setEditingId(e.id)
    setForm({
      event_ts:    e.event_ts?.slice(0, 16),
      category:    e.category,
      title:       e.title,
      description: e.description,
      actor:       e.actor,
    })
    setActorTags(stringToTags(e.actor, actorColor))
    setModalOpen(true)
  }

  const closeModal = () => {
    setModalOpen(false)
    setEditingId(null)
  }

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['incidentLog', caseId] })
    qc.invalidateQueries({ queryKey: ['timeline', caseId] })
  }

  const create = useMutation({
    mutationFn: () => incidentLogApi.create(caseId, {
      ...form,
      actor:    tagsToString(actorTags),
      event_ts: new Date(form.event_ts!).toISOString(),
    }),
    onSuccess: () => { invalidate(); closeModal(); setForm(empty()); setActorTags([]) },
  })

  const update = useMutation({
    mutationFn: () => incidentLogApi.update(caseId, editingId!, {
      ...form,
      actor:    tagsToString(actorTags),
      event_ts: new Date(form.event_ts!).toISOString(),
    }),
    onSuccess: () => { invalidate(); closeModal() },
  })

  const remove = useMutation({
    mutationFn: (id: string) => incidentLogApi.delete(caseId, id),
    onSuccess: invalidate,
  })

  const handleExport = async () => {
    setExporting(true)
    try {
      const blob = await incidentLogApi.exportMarkdown(caseId)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${caseTitle.replace(/\s+/g, '_')}_incident_log.md`
      a.click()
      URL.revokeObjectURL(url)
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-accent font-semibold text-ui uppercase tracking-wide">
          Incident log
          <span className="ml-2 text-fg-secondary font-normal normal-case">({entries.length})</span>
        </h3>
        <div className="flex items-center gap-2">
          <button
            className="btn-secondary text-label flex items-center gap-1.5 disabled:opacity-50"
            onClick={handleExport}
            disabled={exporting || entries.length === 0}
            title="Download the log as Markdown, ready to hand to the client"
          >
            <Download size={13} /> {exporting ? 'Exporting...' : 'Download (.md)'}
          </button>
          <button className="btn-primary text-label flex items-center gap-1.5" onClick={openCreate}>
            <Plus size={13} /> Add an entry
          </button>
        </div>
      </div>

      <p className="text-label text-fg-secondary/70 leading-relaxed">
        Every entry is added both to the case's consolidated timeline and to this log,
        exportable as Markdown for progress updates with the client.
      </p>

      {entries.length === 0 ? (
        <EmptyState
          icon={ScrollText}
          message="No entry in the incident log"
          action={{ label: '+ Add an entry', onClick: openCreate }}
        />
      ) : (
        <div className="relative">
          <div className="absolute left-[7px] top-0 bottom-0 w-px bg-fg/5" />
          <div className="space-y-0">
            {entries.map(e => {
              const meta = CATEGORY_META[e.category] ?? CATEGORY_META.other
              return (
                <div key={e.id} className="relative pl-8 pb-6 group">
                  <div className="absolute left-0 top-1 w-3.5 h-3.5 rounded-pill border-2 border-accent bg-canvas" />
                  <div className="card p-4 hover:bg-hover transition-colors">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap mb-1">
                          <span className="text-label font-mono text-accent shrink-0">
                            {fmtDateTime(e.event_ts)}
                          </span>
                          <span className={`text-label font-medium px-2 py-0.5 rounded-control border ${meta.color}`}>
                            {meta.label}
                          </span>
                          {e.actor && (
                            <span className="text-label text-fg-secondary/60 shrink-0">by {e.actor}</span>
                          )}
                        </div>

                        <p className="text-ui font-medium text-fg mb-1.5">{e.title}</p>

                        {e.description && (
                          <p className="text-label text-fg-secondary mt-1 leading-relaxed whitespace-pre-line">
                            {e.description}
                          </p>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                        <button
                          onClick={() => openEdit(e)}
                          className="text-fg-secondary/30 hover:text-accent transition-colors"
                          title="Edit the entry"
                        >
                          <Pencil size={12} />
                        </button>
                        <button
                          onClick={() => setDeleteTarget(e.id)}
                          className="text-fg-secondary/30 hover:text-severity-critical transition-colors"
                          title="Delete the entry"
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

      <Modal open={modalOpen} onClose={closeModal} title={isEditing ? "Edit the entry" : "Add to the incident log"} size="md">
        <div className="space-y-4">
          <div>
            <label className="label">Category</label>
            <div className="flex flex-wrap gap-1.5">
              {(Object.keys(CATEGORY_META) as IncidentLogCategory[]).map(cat => (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setForm(f => ({ ...f, category: cat }))}
                  className={`text-label px-2.5 py-1 rounded-pill border transition-colors ${ form.category === cat
                      ? CATEGORY_META[cat].color
                      : 'border-hairline text-fg-secondary/60 hover:text-fg hover:border-strong'
                  }`}
                >
                  {CATEGORY_META[cat].label}
                </button>
              ))}
            </div>
          </div>

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
            <label className="label">Title</label>
            <input
              className="input"
              placeholder="e.g. Compromised account reset"
              value={form.title ?? ''}
              onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
            />
          </div>

          <div>
            <label className="label">Actor(s) <span className="text-fg-secondary/50">(optional)</span></label>
            <TagInput
              tags={actorTags}
              onChange={setActorTags}
              suggestions={actorSuggestions}
              placeholder="You, a colleague, the client, an asset…"
            />
          </div>

          <div>
            <label className="label">Description</label>
            <textarea
              className="input resize-none h-24"
              placeholder="Details of the action..."
              value={form.description ?? ''}
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
                ? (isEditing ? 'Saving...' : 'Adding...')
                : (isEditing ? 'Save' : 'Add')
              }
            </button>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => deleteTarget && remove.mutate(deleteTarget)}
        title="Delete the entry"
        message="This entry will be removed from the incident log and from the consolidated timeline."
      />
    </div>
  )
}
