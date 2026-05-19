import { useState, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useDropzone } from 'react-dropzone'
import {
  Upload, Download, Trash2, ShieldCheck, Copy, Check,
  FileArchive, FileText, Cpu, HardDrive, Wifi, Bug, File, FileSearch,
  Pencil, X,
} from 'lucide-react'
import { evidencesApi } from '../../../api/evidences'
import { casesApi } from '../../../api/cases'
import { useAuth } from '../../../context/AuthContext'
import type { Evidence } from '../../../types'
import { fmtDateTime, fmtDateTimeShort, fmtDateStamp } from '../../../utils/dateUtils'
import { fmtBytes as formatBytes } from '../../../utils/formatUtils'
import ConfirmDialog from '../../ui/ConfirmDialog'
import EmptyState from '../../ui/EmptyState'

interface Props { caseId: string }

// ── Types & labels ────────────────────────────────────────────────────────────

const EVIDENCE_TYPES = [
  { value: 'malware',          label: 'Malware Sample',     icon: Bug,         color: 'text-severity-critical bg-severity-critical/10 border-severity-critical/20' },
  { value: 'artifact',         label: 'System Artifact',    icon: FileSearch,  color: 'text-severity-medium  bg-severity-medium/10  border-severity-medium/20' },
  { value: 'log',              label: 'Log File',           icon: FileText,    color: 'text-blue-400         bg-blue-500/10         border-blue-500/20' },
  { value: 'memory_dump',      label: 'Memory Dump',        icon: Cpu,         color: 'text-purple-400       bg-purple-500/10       border-purple-500/20' },
  { value: 'disk_image',       label: 'Disk Image',         icon: HardDrive,   color: 'text-accent-muted     bg-white/5             border-white/10' },
  { value: 'network_capture',  label: 'Network Capture',    icon: Wifi,        color: 'text-cyan-400         bg-cyan-500/10         border-cyan-500/20' },
  { value: 'document',         label: 'Document',           icon: FileText,    color: 'text-accent-green     bg-accent-green/10     border-accent-green/20' },
  { value: 'report',           label: 'Report',             icon: FileArchive, color: 'text-accent-green     bg-accent-green/10     border-accent-green/20' },
  { value: 'other',            label: 'Other',              icon: File,        color: 'text-accent-muted     bg-white/5             border-white/10' },
] as const

const ACQUISITION_METHODS = [
  { value: 'manual',            label: 'Manual Collection' },
  { value: 'forensic_copy',     label: 'Forensic Copy (bit-for-bit)' },
  { value: 'live_acquisition',  label: 'Live Acquisition' },
  { value: 'logical_copy',      label: 'Logical Copy' },
  { value: 'remote_collection', label: 'Remote Collection' },
  { value: 'other',             label: 'Other' },
]

function typeInfo(value: string) {
  return EVIDENCE_TYPES.find(t => t.value === value) ?? EVIDENCE_TYPES[EVIDENCE_TYPES.length - 1]
}
function methodLabel(value: string) {
  return ACQUISITION_METHODS.find(m => m.value === value)?.label ?? value
}
function cocId(index: number) {
  return `COC-${String(index + 1).padStart(3, '0')}`
}

// ── Copy helper ───────────────────────────────────────────────────────────────

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false)
  const copy = () => {
    navigator.clipboard.writeText(value)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }
  return (
    <button onClick={copy} className="text-accent-muted hover:text-white transition-colors ml-1 shrink-0">
      {copied ? <Check size={11} className="text-accent-green" /> : <Copy size={11} />}
    </button>
  )
}

// ── Markdown export ───────────────────────────────────────────────────────────

function exportMarkdown(caseTitle: string, caseId: string, assignedTo: string, evidences: Evidence[]) {
  const now = fmtDateTime(new Date().toISOString())
  const lines: string[] = [
    '# Chain of Custody Report',
    '',
    `| Field | Value |`,
    `|-------|-------|`,
    `| **Case** | ${caseTitle} |`,
    `| **Case ID** | \`${caseId}\` |`,
    `| **Assigned To** | ${assignedTo || '—'} |`,
    `| **Generated** | ${now} |`,
    `| **Total Items** | ${evidences.length} |`,
    '',
    '---',
    '',
  ]

  evidences.forEach((e, i) => {
    const type = typeInfo(e.evidence_type ?? 'other')
    const collectedDate = e.collected_at
      ? fmtDateTime(e.collected_at)
      : `${fmtDateTime(e.created_at)} (upload date)`

    lines.push(`## ${cocId(i)} — ${e.name}`)
    lines.push('')
    lines.push('| Field | Value |')
    lines.push('|-------|-------|')
    lines.push(`| **Type** | ${type.label} |`)
    lines.push(`| **Original Filename** | \`${e.original_filename}\` |`)
    lines.push(`| **File Size** | ${formatBytes(e.file_size)} |`)
    lines.push(`| **Collected By** | ${e.collected_by || '—'} |`)
    lines.push(`| **Collection Date** | ${collectedDate} |`)
    lines.push(`| **Source Location** | ${(e as any).source_location || '—'} |`)
    lines.push(`| **Acquisition Method** | ${methodLabel((e as any).acquisition_method ?? 'manual')} |`)
    if (e.tags) lines.push(`| **Tags** | ${e.tags} |`)
    lines.push('')
    lines.push('### Integrity Verification')
    lines.push('')
    lines.push('| Algorithm | Hash Value |')
    lines.push('|-----------|------------|')
    lines.push(`| MD5 | \`${e.md5_hash}\` |`)
    lines.push(`| SHA-256 | \`${e.sha256_hash}\` |`)
    lines.push('')
    if (e.description) {
      lines.push('### Notes')
      lines.push('')
      lines.push(e.description)
      lines.push('')
    }
    if (e.chain_of_custody) {
      lines.push('### Custody History')
      lines.push('')
      lines.push(e.chain_of_custody)
      lines.push('')
    }
    lines.push('---')
    lines.push('')
  })

  lines.push(`*Document generated by Remora DFIR Platform — ${now}*`)

  const blob = new Blob([lines.join('\n')], { type: 'text/markdown' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `CoC_${caseId.slice(0, 8)}_${fmtDateStamp()}.md`
  a.click()
  URL.revokeObjectURL(url)
}

// ── Main component ────────────────────────────────────────────────────────────

export default function EvidencesTab({ caseId }: Props) {
  const qc = useQueryClient()
  const { user: me } = useAuth()

  const { data: evidences = [] } = useQuery({
    queryKey: ['evidences', caseId],
    queryFn: () => evidencesApi.list(caseId),
  })
  const { data: case_ } = useQuery({
    queryKey: ['case', caseId],
    queryFn: () => casesApi.get(caseId),
  })

  const [uploadOpen, setUploadOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)
  const [editTarget, setEditTarget] = useState<string | null>(null)
  const [editForm, setEditForm] = useState<{
    name: string; evidence_type: string; source_location: string
    acquisition_method: string; collected_by: string; collected_at: string
    description: string; tags: string; note: string
  }>({ name: '', evidence_type: 'other', source_location: '', acquisition_method: 'manual', collected_by: '', collected_at: '', description: '', tags: '', note: '' })
  const [meta, setMeta] = useState({
    name: '', evidence_type: 'other', source_location: '',
    acquisition_method: 'manual', collected_by: '', collected_at: '',
    description: '', tags: '',
  })
  const [pendingFile, setPendingFile] = useState<File | null>(null)

  const upload = useMutation({
    mutationFn: (fd: FormData) => evidencesApi.upload(caseId, fd),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['evidences', caseId] })
      qc.invalidateQueries({ queryKey: ['cases'] })
      setPendingFile(null)
      setMeta({ name: '', evidence_type: 'other', source_location: '', acquisition_method: 'manual', collected_by: '', collected_at: '', description: '', tags: '' })
      setUploadOpen(false)
    },
  })

  const remove = useMutation({
    mutationFn: (id: string) => evidencesApi.delete(caseId, id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['evidences', caseId] })
      qc.invalidateQueries({ queryKey: ['cases'] })
    },
  })

  const update = useMutation({
    mutationFn: ({ id, data }: { id: string; data: typeof editForm }) =>
      evidencesApi.update(caseId, id, {
        name:               data.name               || undefined,
        description:        data.description        ?? undefined,
        evidence_type:      (data.evidence_type     as any) || undefined,
        source_location:    data.source_location    ?? undefined,
        acquisition_method: (data.acquisition_method as any) || undefined,
        collected_by:       data.collected_by       ?? undefined,
        collected_at:       data.collected_at ? (data.collected_at as any) : undefined,
        tags:               data.tags               ?? undefined,
        note:               data.note,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['evidences', caseId] })
      setEditTarget(null)
    },
  })

  const openEdit = (e: Evidence) => {
    setEditForm({
      name:               e.name,
      evidence_type:      (e as any).evidence_type      ?? 'other',
      source_location:    (e as any).source_location    ?? '',
      acquisition_method: (e as any).acquisition_method ?? 'manual',
      collected_by:       e.collected_by   ?? '',
      collected_at:       e.collected_at
        ? new Date(e.collected_at).toISOString().slice(0, 16)
        : '',
      description:        e.description ?? '',
      tags:               e.tags        ?? '',
      note:               '',
    })
    setEditTarget(e.id)
  }

  const onDrop = useCallback((accepted: File[]) => {
    if (!accepted[0]) return
    setPendingFile(accepted[0])
    setMeta(m => ({
      ...m,
      name: accepted[0].name,
      collected_by: m.collected_by || me?.username || '',
      collected_at: m.collected_at || new Date().toISOString().slice(0, 16),
    }))
  }, [me])

  const { getRootProps, getInputProps, isDragActive } = useDropzone({ onDrop, multiple: false })

  const doUpload = () => {
    if (!pendingFile) return
    const fd = new FormData()
    fd.append('file', pendingFile)
    fd.append('name', meta.name || pendingFile.name)
    fd.append('evidence_type', meta.evidence_type)
    fd.append('source_location', meta.source_location)
    fd.append('acquisition_method', meta.acquisition_method)
    fd.append('collected_by', meta.collected_by)
    fd.append('collected_at', meta.collected_at)
    fd.append('description', meta.description)
    fd.append('tags', meta.tags)
    upload.mutate(fd)
  }

  const openUpload = () => {
    setMeta(m => ({ ...m, collected_by: me?.username || '' }))
    setUploadOpen(true)
  }

  return (
    <div className="space-y-5">

      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-accent-green font-semibold text-sm uppercase tracking-wide flex items-center gap-2">
          <ShieldCheck size={15} /> Chain of Custody
          <span className="text-accent-muted font-normal normal-case ml-1">({evidences.length})</span>
        </h3>
        <div className="flex gap-2">
          {evidences.length > 0 && (
            <button
              className="btn-secondary text-xs flex items-center gap-1.5"
              onClick={() => exportMarkdown(case_?.title ?? caseId, caseId, case_?.assigned_to ?? '', evidences)}
            >
              <FileText size={12} /> Export CoC
            </button>
          )}
          <button className="btn-primary text-xs flex items-center gap-1.5" onClick={openUpload}>
            <Upload size={12} /> Add Evidence
          </button>
        </div>
      </div>

      {/* Upload panel */}
      {uploadOpen && (
        <div className="card p-5 space-y-4 border-accent-green/20">
          <p className="text-xs font-semibold text-accent-green uppercase tracking-wide">New Evidence Item</p>

          {/* Dropzone */}
          <div
            {...getRootProps()}
            className={`border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors ${
              isDragActive ? 'border-accent-green bg-accent-green/5' : 'border-white/10 hover:border-white/20'
            }`}
          >
            <input {...getInputProps()} />
            <Upload size={20} className="mx-auto mb-2 text-accent-muted" />
            {pendingFile
              ? <p className="text-sm text-white font-mono">{pendingFile.name} <span className="text-accent-muted">({formatBytes(pendingFile.size)})</span></p>
              : <p className="text-sm text-accent-muted">Drop a file here, or click to browse</p>}
          </div>

          {pendingFile && (
            <>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="label">Evidence Name *</label>
                  <input className="input" value={meta.name} onChange={e => setMeta(m => ({ ...m, name: e.target.value }))} />
                </div>
                <div>
                  <label className="label">Type</label>
                  <select className="input" value={meta.evidence_type} onChange={e => setMeta(m => ({ ...m, evidence_type: e.target.value }))}>
                    {EVIDENCE_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label">Collected By</label>
                  <input className="input" placeholder="username" value={meta.collected_by} onChange={e => setMeta(m => ({ ...m, collected_by: e.target.value }))} />
                </div>
                <div>
                  <label className="label">Collection Date</label>
                  <input className="input" type="datetime-local" value={meta.collected_at} onChange={e => setMeta(m => ({ ...m, collected_at: e.target.value }))} />
                </div>
                <div>
                  <label className="label">Source Location</label>
                  <input className="input" placeholder="C:\Users\victim\AppData\Temp\" value={meta.source_location} onChange={e => setMeta(m => ({ ...m, source_location: e.target.value }))} />
                </div>
                <div>
                  <label className="label">Acquisition Method</label>
                  <select className="input" value={meta.acquisition_method} onChange={e => setMeta(m => ({ ...m, acquisition_method: e.target.value }))}>
                    {ACQUISITION_METHODS.map(a => <option key={a.value} value={a.value}>{a.label}</option>)}
                  </select>
                </div>
                <div className="col-span-2">
                  <label className="label">Notes / Description</label>
                  <textarea className="input resize-none h-16" value={meta.description} onChange={e => setMeta(m => ({ ...m, description: e.target.value }))} />
                </div>
              </div>
              <div className="flex justify-end gap-3">
                <button className="btn-secondary text-xs" onClick={() => { setUploadOpen(false); setPendingFile(null) }}>Cancel</button>
                <button className="btn-primary text-xs" onClick={doUpload} disabled={!meta.name || upload.isPending}>
                  {upload.isPending ? 'Uploading…' : 'Add to Chain of Custody'}
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* Evidence list */}
      {evidences.length === 0 ? (
        <EmptyState icon={ShieldCheck} message="No evidence in chain of custody" />
      ) : (
        <div className="space-y-3">
          {evidences.map((e, i) => {
            const type = typeInfo((e as any).evidence_type ?? 'other')
            const TypeIcon = type.icon
            const collectedDate = e.collected_at
              ? fmtDateTimeShort(e.collected_at)
              : null

            return (
              <div key={e.id} className="card overflow-hidden">
                {/* Card header */}
                <div className="flex items-center gap-3 px-4 py-3 border-b border-white/5 bg-white/[0.02]">
                  <span className="text-[11px] font-mono font-bold text-accent-muted/60 shrink-0 w-14">{cocId(i)}</span>
                  <span className={`inline-flex items-center gap-1 text-[10px] font-mono px-2 py-0.5 rounded border shrink-0 ${type.color}`}>
                    <TypeIcon size={10} />
                    {type.label}
                  </span>
                  <p className="font-semibold text-sm text-white truncate flex-1">{e.name}</p>
                  <div className="flex items-center gap-2 shrink-0">
                    <a
                      href={evidencesApi.downloadUrl(caseId, e.id)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-accent-muted hover:text-accent-green transition-colors"
                      title="Download"
                    >
                      <Download size={14} />
                    </a>
                    <button
                      onClick={() => editTarget === e.id ? setEditTarget(null) : openEdit(e)}
                      className={`transition-colors ${editTarget === e.id ? 'text-accent-green' : 'text-accent-muted hover:text-white'}`}
                      title="Edit evidence"
                    >
                      {editTarget === e.id ? <X size={14} /> : <Pencil size={14} />}
                    </button>
                    <button onClick={() => setDeleteTarget(e.id)} className="text-accent-muted hover:text-severity-critical transition-colors" title="Delete">
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>

                {/* Card body */}
                <div className="px-4 py-3 grid grid-cols-2 gap-x-8 gap-y-2 text-xs">
                  {/* Left column */}
                  <div className="space-y-1.5">
                    <Row label="Original file" value={<span className="font-mono">{e.original_filename}</span>} />
                    <Row label="File size" value={formatBytes(e.file_size)} />
                    <Row label="Collected by" value={e.collected_by || '—'} />
                    {collectedDate && <Row label="Collection date" value={collectedDate} />}
                    {(e as any).source_location && <Row label="Source location" value={<span className="font-mono break-all">{(e as any).source_location}</span>} />}
                    {(e as any).acquisition_method && <Row label="Method" value={methodLabel((e as any).acquisition_method)} />}
                    {e.tags && <Row label="Tags" value={e.tags} />}
                  </div>
                  {/* Right column — hashes */}
                  <div className="space-y-1.5">
                    <p className="text-accent-muted/50 uppercase tracking-widest text-[9px] mb-2">Integrity</p>
                    <HashRow label="MD5" hash={e.md5_hash} />
                    <HashRow label="SHA-256" hash={e.sha256_hash} />
                    {e.description && (
                      <div className="mt-3 pt-3 border-t border-white/5">
                        <p className="text-accent-muted/50 uppercase tracking-widest text-[9px] mb-1">Notes</p>
                        <p className="text-accent-muted leading-relaxed">{e.description}</p>
                      </div>
                    )}
                  </div>
                </div>

                {/* Custody history */}
                {e.chain_of_custody && (
                  <div className="px-4 py-2 border-t border-white/5 bg-white/[0.01]">
                    <p className="text-[9px] uppercase tracking-widest text-accent-muted/40 mb-1">Custody History</p>
                    <p className="text-xs text-accent-muted/70 whitespace-pre-wrap font-mono leading-relaxed">{e.chain_of_custody}</p>
                  </div>
                )}

                {/* Edit form */}
                {editTarget === e.id && (
                  <div className="px-4 py-4 border-t border-accent-green/20 bg-accent-green/[0.02] space-y-4">
                    <p className="text-[10px] font-semibold text-accent-green uppercase tracking-widest">Edit Evidence Record</p>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="label">Name</label>
                        <input className="input" value={editForm.name} onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))} />
                      </div>
                      <div>
                        <label className="label">Type</label>
                        <select className="input" value={editForm.evidence_type} onChange={e => setEditForm(f => ({ ...f, evidence_type: e.target.value }))}>
                          {EVIDENCE_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="label">Collected By</label>
                        <input className="input" value={editForm.collected_by} onChange={e => setEditForm(f => ({ ...f, collected_by: e.target.value }))} />
                      </div>
                      <div>
                        <label className="label">Collection Date</label>
                        <input className="input" type="datetime-local" value={editForm.collected_at} onChange={e => setEditForm(f => ({ ...f, collected_at: e.target.value }))} />
                      </div>
                      <div>
                        <label className="label">Source Location</label>
                        <input className="input font-mono text-xs" value={editForm.source_location} onChange={e => setEditForm(f => ({ ...f, source_location: e.target.value }))} />
                      </div>
                      <div>
                        <label className="label">Acquisition Method</label>
                        <select className="input" value={editForm.acquisition_method} onChange={e => setEditForm(f => ({ ...f, acquisition_method: e.target.value }))}>
                          {ACQUISITION_METHODS.map(a => <option key={a.value} value={a.value}>{a.label}</option>)}
                        </select>
                      </div>
                      <div className="col-span-2">
                        <label className="label">Tags</label>
                        <input className="input" placeholder="comma, separated, tags" value={editForm.tags} onChange={e => setEditForm(f => ({ ...f, tags: e.target.value }))} />
                      </div>
                      <div className="col-span-2">
                        <label className="label">Notes / Description</label>
                        <textarea className="input resize-none h-14" value={editForm.description} onChange={e => setEditForm(f => ({ ...f, description: e.target.value }))} />
                      </div>
                    </div>

                    {/* Mandatory change note */}
                    <div>
                      <label className="label flex items-center gap-1">
                        Change Note <span className="text-severity-critical text-[9px]">required</span>
                      </label>
                      <textarea
                        className={`input resize-none h-16 ${!editForm.note.trim() ? 'border-yellow-500/40' : 'border-accent-green/30'}`}
                        placeholder="Explain why this record is being modified — will be appended to the custody history…"
                        value={editForm.note}
                        onChange={e => setEditForm(f => ({ ...f, note: e.target.value }))}
                      />
                      {!editForm.note.trim() && (
                        <p className="text-[10px] text-yellow-400/60 mt-1">A change note is required to maintain chain of custody integrity.</p>
                      )}
                    </div>

                    <div className="flex justify-end gap-2">
                      <button className="btn-secondary text-xs" onClick={() => setEditTarget(null)}>Cancel</button>
                      <button
                        className="btn-primary text-xs"
                        onClick={() => update.mutate({ id: e.id, data: editForm })}
                        disabled={!editForm.note.trim() || update.isPending}
                      >
                        {update.isPending ? 'Saving…' : 'Save & Log Change'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => deleteTarget && remove.mutate(deleteTarget)}
        title="Remove from Chain of Custody"
        message="This evidence file will be permanently deleted. This action cannot be undone."
      />
    </div>
  )
}

// ── Sub-components ────────────────────────────────────────────────────────────

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex gap-2">
      <span className="text-accent-muted/50 shrink-0 w-28">{label}</span>
      <span className="text-white/80 min-w-0">{value}</span>
    </div>
  )
}

function HashRow({ label, hash }: { label: string; hash: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-accent-muted/50 shrink-0 w-14">{label}</span>
      <span className="font-mono text-[10px] text-white/60 truncate flex-1">{hash || '—'}</span>
      {hash && <CopyButton value={hash} />}
    </div>
  )
}
