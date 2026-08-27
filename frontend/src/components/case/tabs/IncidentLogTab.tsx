import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2, Pencil, ScrollText, Download } from 'lucide-react'
import { incidentLogApi } from '../../../api/incidentLog'
import type { IncidentLogEntry, IncidentLogCategory } from '../../../types'
import { fmtDateTime } from '../../../utils/dateUtils'
import Modal from '../../ui/Modal'
import ConfirmDialog from '../../ui/ConfirmDialog'
import EmptyState from '../../ui/EmptyState'

interface Props { caseId: string; caseTitle: string }

const CATEGORY_META: Record<IncidentLogCategory, { label: string; color: string }> = {
  remediation:   { label: 'Remediation',           color: 'bg-accent-green/10 text-accent-green border-accent-green/20' },
  handover:      { label: 'Passation',             color: 'bg-blue-500/10 text-blue-400 border-blue-500/20' },
  communication: { label: 'Communication client',  color: 'bg-purple-500/10 text-purple-400 border-purple-500/20' },
  investigation: { label: 'Investigation',         color: 'bg-orange-500/10 text-orange-400 border-orange-500/20' },
  other:         { label: 'Autre',                 color: 'bg-white/5 text-accent-muted border-white/10' },
}

const empty = (): Partial<IncidentLogEntry> => ({
  event_ts: new Date().toISOString().slice(0, 16),
  category: 'remediation',
  title: '', description: '', actor: '',
})

export default function IncidentLogTab({ caseId, caseTitle }: Props) {
  const qc = useQueryClient()

  const { data: entries = [] } = useQuery({
    queryKey: ['incidentLog', caseId],
    queryFn: () => incidentLogApi.list(caseId),
  })

  const [modalOpen, setModalOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<Partial<IncidentLogEntry>>(empty())
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)

  const isEditing = editingId !== null

  const openCreate = () => {
    setEditingId(null)
    setForm(empty())
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
      event_ts: new Date(form.event_ts!).toISOString(),
    }),
    onSuccess: () => { invalidate(); closeModal(); setForm(empty()) },
  })

  const update = useMutation({
    mutationFn: () => incidentLogApi.update(caseId, editingId!, {
      ...form,
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
        <h3 className="text-accent-green font-semibold text-sm uppercase tracking-wide">
          Incident log
          <span className="ml-2 text-accent-muted font-normal normal-case">({entries.length})</span>
        </h3>
        <div className="flex items-center gap-2">
          <button
            className="btn-secondary text-xs flex items-center gap-1.5 disabled:opacity-50"
            onClick={handleExport}
            disabled={exporting || entries.length === 0}
            title="Download the log as Markdown, ready to hand to the client"
          >
            <Download size={13} /> {exporting ? 'Exporting...' : 'Download (.md)'}
          </button>
          <button className="btn-primary text-xs flex items-center gap-1.5" onClick={openCreate}>
            <Plus size={13} /> Add an entry
          </button>
        </div>
      </div>

      <p className="text-xs text-accent-muted/70 leading-relaxed">
        Every entry is added both to the case's consolidated timeline and to this log,
        exportable en Markdown pour les points d'avancement avec le client.
      </p>

      {entries.length === 0 ? (
        <EmptyState
          icon={ScrollText}
          message="No entry in the incident log"
          action={{ label: '+ Add an entry', onClick: openCreate }}
        />
      ) : (
        <div className="relative">
          <div className="absolute left-[7px] top-0 bottom-0 w-px bg-white/5" />
          <div className="space-y-0">
            {entries.map(e => {
              const meta = CATEGORY_META[e.category] ?? CATEGORY_META.other
              return (
                <div key={e.id} className="relative pl-8 pb-6 group">
                  <div className="absolute left-0 top-1 w-3.5 h-3.5 rounded-full border-2 border-accent-green bg-bg-primary" />
                  <div className="card p-4 hover:bg-bg-hover transition-colors">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap mb-1">
                          <span className="text-xs font-mono text-accent-green shrink-0">
                            {fmtDateTime(e.event_ts)}
                          </span>
                          <span className={`text-[10px] font-medium px-2 py-0.5 rounded border ${meta.color}`}>
                            {meta.label}
                          </span>
                          {e.actor && (
                            <span className="text-xs text-accent-muted/60 shrink-0">par {e.actor}</span>
                          )}
                        </div>

                        <p className="text-sm font-medium text-white mb-1.5">{e.title}</p>

                        {e.description && (
                          <p className="text-xs text-accent-muted mt-1 leading-relaxed whitespace-pre-line">
                            {e.description}
                          </p>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                        <button
                          onClick={() => openEdit(e)}
                          className="text-accent-muted/30 hover:text-accent-green transition-colors"
                          title="Edit the entry"
                        >
                          <Pencil size={12} />
                        </button>
                        <button
                          onClick={() => setDeleteTarget(e.id)}
                          className="text-accent-muted/30 hover:text-severity-critical transition-colors"
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
                  className={`text-[11px] px-2.5 py-1 rounded-full border transition-colors ${
                    form.category === cat
                      ? CATEGORY_META[cat].color
                      : 'border-white/10 text-accent-muted/60 hover:text-white hover:border-white/20'
                  }`}
                >
                  {CATEGORY_META[cat].label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="label">Horodatage</label>
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
            <label className="label">Acteur <span className="text-accent-muted/50">(optionnel)</span></label>
            <input
              className="input"
              placeholder="Analyste, client, tiers…"
              value={form.actor ?? ''}
              onChange={e => setForm(f => ({ ...f, actor: e.target.value }))}
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
