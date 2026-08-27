import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { Building2, Plus, FileStack, Star, FolderOpen, FileText, Trash2, Check } from '../ui/icons'
import { clientsApi } from '../api/clients'
import type { ClientSummary, ClientDocTemplate, DocSlot } from '../types'
import Modal from '../components/ui/Modal'
import EmptyState from '../components/ui/EmptyState'

// ── New client modal ─────────────────────────────────────────────────────────

function NewClientModal({ open, onClose, templates }: {
  open: boolean; onClose: () => void; templates: ClientDocTemplate[]
}) {
  const qc = useQueryClient()
  const [name, setName] = useState('')
  const [industry, setIndustry] = useState('')
  const [docTemplateId, setDocTemplateId] = useState('')

  const create = useMutation({
    mutationFn: () => clientsApi.create({
      name: name.trim(), industry: industry.trim(),
      doc_template_id: docTemplateId || null,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['clients'] })
      setName(''); setIndustry(''); setDocTemplateId('')
      onClose()
    },
  })

  return (
    <Modal open={open} onClose={onClose} title="New client" size="sm">
      <div className="space-y-4">
        <div>
          <label className="label">Name *</label>
          <input className="input" autoFocus value={name} onChange={e => setName(e.target.value)}
                 placeholder="Ex: Acme Corp" />
        </div>
        <div>
          <label className="label">Secteur</label>
          <input className="input" value={industry} onChange={e => setIndustry(e.target.value)}
                 placeholder="Finance, Healthcare, Industry..." />
        </div>
        <div>
          <label className="label">Template de documentation</label>
          <select className="input" value={docTemplateId} onChange={e => setDocTemplateId(e.target.value)}>
            <option value="">None - free-form base</option>
            {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
        <div className="flex justify-end gap-3 pt-2">
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn-primary" disabled={!name.trim() || create.isPending} onClick={() => create.mutate()}>
            {create.isPending ? 'Creating...' : 'Create'}
          </button>
        </div>
      </div>
    </Modal>
  )
}

// ── Doc template manager ──────────────────────────────────────────────────────

function emptySlot(): DocSlot {
  return { slug: '', label: '', description: '' }
}

function TemplateEditor({ tpl, onSaved, onCancel }: {
  tpl: ClientDocTemplate | null
  onSaved: () => void
  onCancel: () => void
}) {
  const qc = useQueryClient()
  const [name, setName] = useState(tpl?.name ?? '')
  const [description, setDescription] = useState(tpl?.description ?? '')
  const [slots, setSlots] = useState<DocSlot[]>(tpl?.slots?.length ? tpl.slots : [emptySlot()])

  const slugify = (label: string) => label.toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')

  const save = useMutation({
    mutationFn: () => {
      const cleanSlots = slots
        .filter(s => s.label.trim())
        .map(s => ({ ...s, slug: s.slug || slugify(s.label) }))
      const payload = { name: name.trim(), description: description.trim(), slots: cleanSlots }
      return tpl
        ? clientsApi.updateDocTemplate(tpl.id, payload)
        : clientsApi.createDocTemplate(payload)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['clientDocTemplates'] })
      onSaved()
    },
  })

  return (
    <div className="card p-5 space-y-4 border-accent-green/20">
      <div>
        <label className="label">Template name *</label>
        <input className="input" autoFocus value={name} onChange={e => setName(e.target.value)}
               placeholder="e.g. Enterprise Client - standard folder" />
      </div>
      <div>
        <label className="label">Description</label>
        <input className="input" value={description} onChange={e => setDescription(e.target.value)}
               placeholder="Contexte / usage de ce template" />
      </div>
      <div>
        <label className="label">Emplacements de documents</label>
        <div className="space-y-2">
          {slots.map((s, i) => (
            <div key={i} className="flex items-start gap-2">
              <input
                className="input text-sm flex-1"
                placeholder="Label - e.g. Network diagram"
                value={s.label}
                onChange={e => setSlots(prev => prev.map((p, pi) => pi === i ? { ...p, label: e.target.value } : p))}
              />
              <input
                className="input text-sm flex-1"
                placeholder="Description (optional)"
                value={s.description}
                onChange={e => setSlots(prev => prev.map((p, pi) => pi === i ? { ...p, description: e.target.value } : p))}
              />
              <button
                onClick={() => setSlots(prev => prev.filter((_, pi) => pi !== i))}
                className="p-2 text-accent-muted/40 hover:text-severity-critical transition-colors shrink-0"
                title="Retirer"
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
        <button
          onClick={() => setSlots(prev => [...prev, emptySlot()])}
          className="mt-2 text-xs text-accent-green hover:underline flex items-center gap-1"
        >
          <Plus size={12} /> Ajouter un emplacement
        </button>
        <p className="text-[11px] text-accent-muted/40 mt-1">
          e.g. Network diagram, RACI, Machine inventory, Country contacts...
        </p>
      </div>
      <div className="flex justify-end gap-2 pt-1">
        <button className="btn-secondary text-xs" onClick={onCancel}>Cancel</button>
        <button
          className="btn-primary text-xs flex items-center gap-1.5"
          disabled={!name.trim() || save.isPending}
          onClick={() => save.mutate()}
        >
          <Check size={12} /> {save.isPending ? 'Saving...' : 'Save'}
        </button>
      </div>
    </div>
  )
}

function TemplatesPanel({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient()
  const { data: templates = [] } = useQuery({ queryKey: ['clientDocTemplates'], queryFn: clientsApi.listDocTemplates })
  const [editing, setEditing] = useState<ClientDocTemplate | null | 'new'>(null)

  const remove = useMutation({
    mutationFn: (id: string) => clientsApi.deleteDocTemplate(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['clientDocTemplates'] }),
  })

  return (
    <Modal open onClose={onClose} title="Templates de documentation client" size="lg">
      <div className="space-y-4">
        {editing ? (
          <TemplateEditor
            tpl={editing === 'new' ? null : editing}
            onSaved={() => setEditing(null)}
            onCancel={() => setEditing(null)}
          />
        ) : (
          <>
            <button
              className="btn-secondary text-xs flex items-center gap-1.5"
              onClick={() => setEditing('new')}
            >
              <Plus size={12} /> New template
            </button>
            {templates.length === 0 ? (
              <p className="text-sm text-accent-muted/50 py-6 text-center">No template defined.</p>
            ) : (
              <div className="space-y-2">
                {templates.map(t => (
                  <div key={t.id} className="card p-3 flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-white">{t.name}</p>
                      {t.description && <p className="text-xs text-accent-muted/60 mt-0.5">{t.description}</p>}
                      <div className="flex flex-wrap gap-1 mt-1.5">
                        {t.slots.map(s => (
                          <span key={s.slug} className="text-[10px] px-1.5 py-0.5 rounded border border-white/10 text-accent-muted/60">
                            {s.label}
                          </span>
                        ))}
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        onClick={() => setEditing(t)}
                        className="text-xs text-accent-muted/50 hover:text-accent-green transition-colors px-2 py-1"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => confirm(`Delete the template "${t.name}"?`) && remove.mutate(t.id)}
                        className="p-1.5 text-accent-muted/40 hover:text-severity-critical transition-colors"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </Modal>
  )
}

// ── Client card ────────────────────────────────────────────────────────────────

function ClientCard({ client, onClick }: { client: ClientSummary; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="card p-5 text-left hover:bg-bg-hover hover:border-accent-green/20 transition-colors group"
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="p-2 rounded-lg bg-accent-green/10 text-accent-green shrink-0">
          <Building2 size={16} />
        </div>
        {client.is_default && (
          <span className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border border-amber-500/30 bg-amber-500/10 text-amber-400">
            <Star size={9} /> Default
          </span>
        )}
      </div>
      <p className="font-semibold text-white group-hover:text-accent-green transition-colors truncate">{client.name}</p>
      {client.industry && <p className="text-xs text-accent-muted/60 mt-0.5">{client.industry}</p>}
      <div className="flex items-center gap-3 mt-3 pt-3 border-t border-white/5 text-[11px] text-accent-muted/50">
        <span className="flex items-center gap-1"><FolderOpen size={11} /> {client.case_count} case{client.case_count !== 1 ? 's' : ''}</span>
        <span className="flex items-center gap-1"><FileText size={11} /> {client.document_count} doc{client.document_count !== 1 ? 's' : ''}</span>
      </div>
    </button>
  )
}

// ── Page ───────────────────────────────────────────────────────────────────────

export default function Clients() {
  const navigate = useNavigate()
  const [showNew, setShowNew] = useState(false)
  const [showTemplates, setShowTemplates] = useState(false)

  const { data: clients = [], isLoading } = useQuery({ queryKey: ['clients'], queryFn: clientsApi.list })
  const { data: templates = [] } = useQuery({ queryKey: ['clientDocTemplates'], queryFn: clientsApi.listDocTemplates })

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-accent-green flex items-center gap-2">
            <Building2 size={22} />
            Clients
          </h1>
          <p className="text-accent-muted text-sm mt-1">
            Organisations selectable when creating a case, each with its own document knowledge base.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button className="btn-secondary flex items-center gap-2 text-sm" onClick={() => setShowTemplates(true)}>
            <FileStack size={14} /> Templates
          </button>
          <button className="btn-primary flex items-center gap-2 text-sm" onClick={() => setShowNew(true)}>
            <Plus size={14} /> New client
          </button>
        </div>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map(i => <div key={i} className="card p-5 h-32 animate-pulse" />)}
        </div>
      ) : clients.length === 0 ? (
        <EmptyState icon={Building2} message="No client configured"
                    action={{ label: '+ New client', onClick: () => setShowNew(true) }} />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {clients.map(c => (
            <ClientCard key={c.id} client={c} onClick={() => navigate(`/config/clients/${c.id}`)} />
          ))}
        </div>
      )}

      <NewClientModal open={showNew} onClose={() => setShowNew(false)} templates={templates} />
      {showTemplates && <TemplatesPanel onClose={() => setShowTemplates(false)} />}
    </div>
  )
}
