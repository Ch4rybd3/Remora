import { useRef, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  ArrowLeft, Building2, Star, Pencil, Upload, FileText, FileSpreadsheet,
  Image as ImageIcon, FileArchive, File as FileIcon, Trash2, Eye, FolderOpen,
} from '../ui/icons'
import { clientsApi } from '../api/clients'
import type { Client, ClientDocument, DocSlot } from '../types'
import { fmtDateTimeShort } from '../utils/dateUtils'
import { fmtBytes } from '../utils/formatUtils'
import Modal from '../components/ui/Modal'
import ConfirmDialog from '../components/ui/ConfirmDialog'
import DocumentPreview from '../components/clients/DocumentPreview'

// ── Helpers ──────────────────────────────────────────────────────────────────

function ext(name: string): string {
  const parts = name.split('.')
  return parts.length > 1 ? parts[parts.length - 1].toLowerCase() : ''
}

function DocIcon({ name, className = '' }: { name: string; className?: string }) {
  const e = ext(name)
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'].includes(e)) return <ImageIcon size={16} className={className} />
  if (['csv', 'xlsx', 'xls'].includes(e)) return <FileSpreadsheet size={16} className={className} />
  if (['zip', 'tar', 'gz', '7z', 'rar'].includes(e)) return <FileArchive size={16} className={className} />
  if (['pdf', 'doc', 'docx'].includes(e)) return <FileText size={16} className={className} />
  return <FileIcon size={16} className={className} />
}

// ── Edit metadata modal ─────────────────────────────────────────────────────

function EditClientModal({ client, docTemplates, onClose }: {
  client: Client
  docTemplates: { id: string; name: string }[]
  onClose: () => void
}) {
  const qc = useQueryClient()
  const [form, setForm] = useState({
    name: client.name,
    industry: client.industry,
    description: client.description,
    contact_name: client.contact_name,
    contact_email: client.contact_email,
    contact_phone: client.contact_phone,
    address: client.address,
    notes: client.notes,
    doc_template_id: client.doc_template_id ?? '',
  })

  const save = useMutation({
    mutationFn: () => clientsApi.update(client.id, { ...form, doc_template_id: form.doc_template_id || null }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['client', client.id] })
      qc.invalidateQueries({ queryKey: ['clients'] })
      onClose()
    },
  })

  return (
    <Modal open onClose={onClose} title="Edit the client" size="lg">
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="label">Name *</label>
            <input className="input" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
          </div>
          <div>
            <label className="label">Secteur</label>
            <input className="input" value={form.industry} onChange={e => setForm(f => ({ ...f, industry: e.target.value }))} />
          </div>
        </div>
        <div>
          <label className="label">Description</label>
          <textarea className="input resize-none h-16" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
        </div>
        <div className="grid grid-cols-3 gap-4">
          <div>
            <label className="label">Contact</label>
            <input className="input" value={form.contact_name} onChange={e => setForm(f => ({ ...f, contact_name: e.target.value }))} />
          </div>
          <div>
            <label className="label">Email</label>
            <input className="input" value={form.contact_email} onChange={e => setForm(f => ({ ...f, contact_email: e.target.value }))} />
          </div>
          <div>
            <label className="label">Phone</label>
            <input className="input" value={form.contact_phone} onChange={e => setForm(f => ({ ...f, contact_phone: e.target.value }))} />
          </div>
        </div>
        <div>
          <label className="label">Adresse</label>
          <input className="input" value={form.address} onChange={e => setForm(f => ({ ...f, address: e.target.value }))} />
        </div>
        <div>
          <label className="label">Notes</label>
          <textarea className="input resize-none h-20" value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
        </div>
        <div>
          <label className="label">Template de documentation</label>
          <select className="input" value={form.doc_template_id} onChange={e => setForm(f => ({ ...f, doc_template_id: e.target.value }))}>
            <option value="">None - free-form base</option>
            {docTemplates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
        <div className="flex justify-end gap-3 pt-2">
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn-primary" disabled={!form.name.trim() || save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    </Modal>
  )
}

// ── Upload dropzone (used per-slot and for freeform docs) ──────────────────

function UploadZone({ label, onUpload, uploading }: {
  label: string
  onUpload: (file: File) => void
  uploading: boolean
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)

  return (
    <div
      onDragOver={e => { e.preventDefault(); setDragging(true) }}
      onDragLeave={() => setDragging(false)}
      onDrop={e => {
        e.preventDefault(); setDragging(false)
        const f = e.dataTransfer.files[0]
        if (f) onUpload(f)
      }}
      onClick={() => inputRef.current?.click()}
      className={`border-2 border-dashed py-4 px-3 text-center cursor-pointer transition-colors ${
        dragging ? 'border-accent/60 bg-accent/5' : 'border-hairline hover:border-strong'
      }`}
    >
      {uploading ? (
        <p className="text-label text-fg-secondary/60">Envoi…</p>
      ) : (
        <>
          <Upload size={16} className="mx-auto mb-1 text-fg-secondary/30" />
          <p className="text-label text-fg-secondary/50">{label}</p>
        </>
      )}
      <input
        ref={inputRef}
        type="file"
        className="sr-only"
        onChange={e => { const f = e.target.files?.[0]; if (f) onUpload(f) }}
      />
    </div>
  )
}

// ── Document row ─────────────────────────────────────────────────────────────

function DocRow({ doc, onPreview, onDelete }: {
  doc: ClientDocument
  onPreview: () => void
  onDelete: () => void
}) {
  return (
    <div className="flex items-center gap-3 py-2 px-3 hover:bg-white/[0.03] transition-colors group">
      <DocIcon name={doc.file_name} className="text-accent/70 shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-ui text-fg truncate">{doc.name}</p>
        <p className="text-label text-fg-secondary/40">
          {fmtBytes(doc.file_size)} · {fmtDateTimeShort(doc.uploaded_at)}
          {doc.uploaded_by ? ` · ${doc.uploaded_by}` : ''}
        </p>
      </div>
      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
        <button onClick={onPreview} className="p-1.5 rounded-control text-fg-secondary/40 hover:text-accent hover:bg-accent/5" title="Preview">
          <Eye size={13} />
        </button>
        <button onClick={onDelete} className="p-1.5 rounded-control text-fg-secondary/40 hover:text-severity-critical hover:bg-severity-critical/5" title="Delete">
          <Trash2 size={13} />
        </button>
      </div>
    </div>
  )
}

// ── Slot card ──────────────────────────────────────────────────────────────────

function SlotCard({ slot, doc, uploading, onUpload, onPreview, onDelete }: {
  slot: DocSlot
  doc: ClientDocument | undefined
  uploading: boolean
  onUpload: (file: File) => void
  onPreview: () => void
  onDelete: () => void
}) {
  return (
    <div className="card p-4">
      <p className="text-ui font-medium text-fg">{slot.label}</p>
      {slot.description && <p className="text-label text-fg-secondary/50 mt-0.5 mb-2">{slot.description}</p>}
      <div className="mt-2">
        {doc ? (
          <DocRow doc={doc} onPreview={onPreview} onDelete={onDelete} />
        ) : (
          <UploadZone label="Drop a file here" onUpload={onUpload} uploading={uploading} />
        )}
      </div>
    </div>
  )
}

// ── Page ───────────────────────────────────────────────────────────────────────

export default function ClientDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [editing, setEditing] = useState(false)
  const [previewDoc, setPreviewDoc] = useState<ClientDocument | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<ClientDocument | null>(null)
  const [uploadingSlot, setUploadingSlot] = useState<string | null>(null)

  const { data: client, isLoading } = useQuery({
    queryKey: ['client', id],
    queryFn: () => clientsApi.get(id!),
    enabled: !!id,
  })
  const { data: docTemplates = [] } = useQuery({ queryKey: ['clientDocTemplates'], queryFn: clientsApi.listDocTemplates })
  const { data: documents = [] } = useQuery({
    queryKey: ['clientDocuments', id],
    queryFn: () => clientsApi.listDocuments(id!),
    enabled: !!id,
  })

  const template = docTemplates.find(t => t.id === client?.doc_template_id)
  const docsBySlot = new Map(documents.filter(d => d.slot).map(d => [d.slot!, d]))
  const freeformDocs = documents.filter(d => !d.slot)

  const invalidateDocs = () => qc.invalidateQueries({ queryKey: ['clientDocuments', id] })

  const upload = useMutation({
    mutationFn: (params: { file: File; slot: string | null }) =>
      clientsApi.uploadDocument(id!, { file: params.file, slot: params.slot }),
    onMutate: (params) => setUploadingSlot(params.slot ?? 'freeform'),
    onSuccess: () => { invalidateDocs(); qc.invalidateQueries({ queryKey: ['clients'] }) },
    onSettled: () => setUploadingSlot(null),
  })

  const remove = useMutation({
    mutationFn: (doc: ClientDocument) => clientsApi.deleteDocument(id!, doc.id),
    onSuccess: () => { invalidateDocs(); qc.invalidateQueries({ queryKey: ['clients'] }) },
  })

  if (isLoading || !client) {
    return <div className="p-6 text-center text-fg-secondary text-ui">Loading...</div>
  }

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-start gap-3">
        <button onClick={() => navigate('/config/clients')} className="p-2 text-fg-secondary/50 hover:text-fg hover:bg-fg/5 transition-colors shrink-0 mt-0.5">
          <ArrowLeft size={18} />
        </button>
        <div className="p-2.5 bg-accent/10 text-accent shrink-0">
          <Building2 size={20} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-title font-bold text-fg">{client.name}</h1>
            {client.is_default && (
              <span className="flex items-center gap-1 text-label px-1.5 py-0.5 rounded-control border border-severity-medium/30 bg-severity-medium/10 text-severity-medium">
                <Star size={9} /> Default
              </span>
            )}
          </div>
          {client.industry && <p className="text-ui text-fg-secondary mt-0.5">{client.industry}</p>}
          {client.description && <p className="text-label text-fg-secondary/60 mt-1 max-w-2xl">{client.description}</p>}
        </div>
        <button className="btn-secondary text-label flex items-center gap-1.5 shrink-0" onClick={() => setEditing(true)}>
          <Pencil size={12} /> Edit
        </button>
      </div>

      {/* Contact + meta */}
      {(client.contact_name || client.contact_email || client.contact_phone || client.address || client.notes) && (
        <div className="card p-4 grid grid-cols-2 sm:grid-cols-4 gap-4 text-label">
          {client.contact_name && <div><p className="text-fg-secondary/40 uppercase text-label mb-0.5">Contact</p><p className="text-fg">{client.contact_name}</p></div>}
          {client.contact_email && <div><p className="text-fg-secondary/40 uppercase text-label mb-0.5">Email</p><p className="text-fg">{client.contact_email}</p></div>}
          {client.contact_phone && <div><p className="text-fg-secondary/40 uppercase text-label mb-0.5">Phone</p><p className="text-fg">{client.contact_phone}</p></div>}
          {client.address && <div><p className="text-fg-secondary/40 uppercase text-label mb-0.5">Adresse</p><p className="text-fg">{client.address}</p></div>}
          {client.notes && (
            <div className="col-span-2 sm:col-span-4 pt-2 border-t border-hairline">
              <p className="text-fg-secondary/40 uppercase text-label mb-0.5">Notes</p>
              <p className="text-fg whitespace-pre-line">{client.notes}</p>
            </div>
          )}
        </div>
      )}

      {/* Cases link */}
      <button
        onClick={() => navigate('/cases')}
        className="flex items-center gap-2 text-label text-fg-secondary/60 hover:text-accent transition-colors"
      >
        <FolderOpen size={13} /> Voir les cases de ce client
      </button>

      {/* Knowledge base */}
      <div>
        <h2 className="text-accent font-semibold text-ui uppercase tracking-wide mb-3">
          Base de connaissance
        </h2>

        {template && template.slots.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
            {template.slots.map(slot => (
              <SlotCard
                key={slot.slug}
                slot={slot}
                doc={docsBySlot.get(slot.slug)}
                uploading={uploadingSlot === slot.slug}
                onUpload={file => upload.mutate({ file, slot: slot.slug })}
                onPreview={() => setPreviewDoc(docsBySlot.get(slot.slug)!)}
                onDelete={() => setDeleteTarget(docsBySlot.get(slot.slug)!)}
              />
            ))}
          </div>
        )}

        <div className="card p-4">
          <p className="text-ui font-medium text-fg mb-2">
            {template ? 'Autres documents' : 'Documents'}
          </p>
          <UploadZone
            label="Drag and drop a file, or click to browse"
            onUpload={file => upload.mutate({ file, slot: null })}
            uploading={uploadingSlot === 'freeform'}
          />
          {freeformDocs.length > 0 && (
            <div className="mt-2 divide-y divide-hairline">
              {freeformDocs.map(doc => (
                <DocRow key={doc.id} doc={doc} onPreview={() => setPreviewDoc(doc)} onDelete={() => setDeleteTarget(doc)} />
              ))}
            </div>
          )}
        </div>
      </div>

      {editing && (
        <EditClientModal client={client} docTemplates={docTemplates} onClose={() => setEditing(false)} />
      )}
      {previewDoc && (
        <DocumentPreview clientId={client.id} doc={previewDoc} onClose={() => setPreviewDoc(null)} />
      )}
      <ConfirmDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => deleteTarget && remove.mutate(deleteTarget)}
        title="Delete the document"
        message={`"${deleteTarget?.name}" will be permanently deleted.`}
      />
    </div>
  )
}
