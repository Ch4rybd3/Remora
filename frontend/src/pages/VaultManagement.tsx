import { useState, useRef, useCallback } from 'react'
import { PageShell } from '../ui/PageShell'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Archive, Upload, Trash2, Download, Pencil, X, Check,
  FileText, FileArchive, FileSpreadsheet, File, Code2,
  AlertCircle, Tag, Package,
} from '../ui/icons'
import { vaultApi, type VaultEntry, type VaultPatch } from '../api/vault'
import { fmtDateTimeShort } from '../utils/dateUtils'
import { fmtBytes as fmtSize } from '../utils/formatUtils'

// ── Helpers ────────────────────────────────────────────────────────────────────

function parseTags(raw: string): string[] {
  return raw.split(',').map(t => t.trim()).filter(Boolean)
}

// ── File type icon + badge ─────────────────────────────────────────────────────

function fileExt(name: string): string {
  const parts = name.split('.')
  return parts.length > 1 ? parts[parts.length - 1].toLowerCase() : ''
}

function FileIcon({ name, className = '' }: { name: string; className?: string }) {
  const ext = fileExt(name)
  if (['zip', 'tar', 'gz', '7z', 'rar', 'bz2'].includes(ext))
    return <Archive size={18} className={className} />
  if (['pdf'].includes(ext))
    return <FileText size={18} className={className} />
  if (['docx', 'doc', 'odt', 'rtf'].includes(ext))
    return <FileText size={18} className={className} />
  if (['csv', 'xlsx', 'xls', 'ods'].includes(ext))
    return <FileSpreadsheet size={18} className={className} />
  if (['py', 'js', 'ts', 'sh', 'ps1', 'yaml', 'yml', 'json', 'xml', 'toml'].includes(ext))
    return <Code2 size={18} className={className} />
  if (['md', 'txt', 'rst', 'log'].includes(ext))
    return <FileText size={18} className={className} />
  if (['tar', 'pkg'].includes(ext))
    return <Package size={18} className={className} />
  return <File size={18} className={className} />
}

function ExtBadge({ name }: { name: string }) {
  const ext = fileExt(name)
  if (!ext) return null

  const color =
    ['zip', 'tar', 'gz', '7z', 'rar'].includes(ext) ? 'bg-severity-medium/10 text-severity-medium border-severity-medium/20' :
    ['pdf'].includes(ext)                             ? 'bg-severity-critical/10 text-severity-critical border-severity-critical/20' :
    ['docx', 'doc'].includes(ext)                     ? 'bg-severity-low/10 text-severity-low border-severity-low/20' :
    ['csv', 'xlsx', 'xls'].includes(ext)              ? 'bg-accent/10 text-accent border-accent/20' :
    ['py', 'sh', 'ps1', 'js', 'ts'].includes(ext)    ? 'bg-data-2/10 text-data-2 border-data-2/20' :
    ['md', 'txt'].includes(ext)                       ? 'bg-fg-muted/10 text-fg-muted border-fg-muted/20' :
    'bg-fg/5 text-fg-secondary border-hairline'

  return (
    <span className={`text-label font-mono font-bold px-1.5 py-0.5 rounded-control border uppercase ${color}`}>
      .{ext}
    </span>
  )
}

// ── Tag chip ───────────────────────────────────────────────────────────────────

function TagChip({ label }: { label: string }) {
  return (
    <span className="text-label font-mono px-1.5 py-0.5 rounded-control bg-accent/10 text-accent/80 border border-accent/20">
      {label}
    </span>
  )
}

// ── Vault card ─────────────────────────────────────────────────────────────────

function VaultCard({
  vault,
  onDelete,
  onSave,
}: {
  vault:    VaultEntry
  onDelete: (id: number) => void
  onSave:   (id: number, patch: VaultPatch) => void
}) {
  const [editing, setEditing]       = useState(false)
  const [editName, setEditName]     = useState(vault.name)
  const [editDesc, setEditDesc]     = useState(vault.description)
  const [editTags, setEditTags]     = useState(vault.tags)

  const handleSave = () => {
    onSave(vault.id, { name: editName, description: editDesc, tags: editTags })
    setEditing(false)
  }

  const handleCancel = () => {
    setEditName(vault.name)
    setEditDesc(vault.description)
    setEditTags(vault.tags)
    setEditing(false)
  }

  const tags = parseTags(vault.tags)

  return (
    <div className="card p-5 space-y-3 group">
      {/* Header row */}
      <div className="flex items-start gap-3">
        {/* File icon */}
        <div className="shrink-0 mt-0.5 p-2 bg-fg/5 border border-hairline">
          <FileIcon name={vault.file_name} className="text-accent/70" />
        </div>

        {/* Meta */}
        <div className="flex-1 min-w-0">
          {editing ? (
            <input
              className="input text-ui font-semibold mb-1 py-1"
              value={editName}
              onChange={e => setEditName(e.target.value)}
              placeholder="Vault name"
              autoFocus
            />
          ) : (
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-semibold text-fg">{vault.name}</span>
              <ExtBadge name={vault.file_name} />
              <span className="text-label text-fg-secondary/40 font-mono">{fmtSize(vault.file_size)}</span>
            </div>
          )}

          {editing ? (
            <textarea
              className="input text-label mt-1 resize-none"
              rows={2}
              value={editDesc}
              onChange={e => setEditDesc(e.target.value)}
              placeholder="Description (optional)"
            />
          ) : (
            vault.description
              ? <p className="text-label text-fg-secondary mt-0.5">{vault.description}</p>
              : <p className="text-label text-fg-secondary/30 italic mt-0.5">Pas de description</p>
          )}

          <p className="text-label text-fg-secondary/30 mt-1">
            {vault.file_name}
            {' · '}
            Imported on {fmtDateTimeShort(vault.created_at)}
            {vault.created_by ? ` par ${vault.created_by}` : ''}
          </p>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1 shrink-0">
          {editing ? (
            <>
              <button
                onClick={handleSave}
                disabled={!editName.trim()}
                className="p-1.5 rounded-control text-accent hover:bg-accent/10 transition-colors disabled:opacity-40"
                title="Save"
              >
                <Check size={14} />
              </button>
              <button
                onClick={handleCancel}
                className="p-1.5 rounded-control text-fg-secondary/60 hover:text-fg hover:bg-fg/5 transition-colors"
                title="Cancel"
              >
                <X size={14} />
              </button>
            </>
          ) : (
            <>
              <a
                href={vaultApi.downloadUrl(vault.id)}
                download={vault.file_name}
                className="p-1.5 rounded-control text-fg-secondary/40 hover:text-accent hover:bg-accent/5 transition-colors"
                title="Download"
              >
                <Download size={14} />
              </a>
              <button
                onClick={() => setEditing(true)}
                className="p-1.5 rounded-control text-fg-secondary/40 hover:text-fg hover:bg-fg/5 transition-colors opacity-0 group-hover:opacity-100 transition-opacity"
                title="Edit"
              >
                <Pencil size={13} />
              </button>
              <button
                onClick={() => onDelete(vault.id)}
                className="p-1.5 rounded-control text-fg-secondary/40 hover:text-severity-critical hover:bg-severity-critical/5 transition-colors"
                title="Delete"
              >
                <Trash2 size={14} />
              </button>
            </>
          )}
        </div>
      </div>

      {/* Tags row */}
      {editing ? (
        <div>
          <label className="label text-label flex items-center gap-1">
            <Tag size={10} />
            Tags <span className="text-fg-secondary/40">(comma-separated)</span>
          </label>
          <input
            className="input text-label"
            value={editTags}
            onChange={e => setEditTags(e.target.value)}
            placeholder="ex: malware, tools, reference"
          />
        </div>
      ) : tags.length > 0 ? (
        <div className="flex flex-wrap gap-1.5 pt-1 border-t border-hairline">
          {tags.map(t => <TagChip key={t} label={t} />)}
        </div>
      ) : null}
    </div>
  )
}

// ── Upload form ────────────────────────────────────────────────────────────────

function UploadForm({ onDone }: { onDone: () => void }) {
  const qc = useQueryClient()
  const [name, setName]           = useState('')
  const [description, setDesc]    = useState('')
  const [tags, setTags]           = useState('')
  const [file, setFile]           = useState<File | null>(null)
  const [dragging, setDragging]   = useState(false)
  const [error, setError]         = useState<string | null>(null)
  const inputRef                  = useRef<HTMLInputElement>(null)

  const upload = useMutation({
    mutationFn: () => vaultApi.upload({ name, description, tags, file: file! }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['vaults'] })
      onDone()
    },
    onError: (err: any) => {
      setError(err.response?.data?.detail ?? 'Échec de l\'import')
    },
  })

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragging(false)
    const f = e.dataTransfer.files[0]
    if (!f) return
    setFile(f)
    if (!name) setName(f.name.replace(/\.[^.]+$/, ''))
  }, [name])

  const handleFile = (f: File | undefined) => {
    if (!f) return
    setFile(f)
    if (!name) setName(f.name.replace(/\.[^.]+$/, ''))
  }

  return (
    <div className="card p-6 space-y-4 border-accent/20">
      <h3 className="text-ui font-semibold text-accent flex items-center gap-2">
        <Upload size={14} />
        Import a vault
      </h3>

      {error && (
        <div className="flex items-start gap-2 bg-severity-critical/10 border border-severity-critical/20 px-3 py-2">
          <AlertCircle size={13} className="text-severity-critical shrink-0 mt-0.5" />
          <p className="text-label text-severity-critical">{error}</p>
        </div>
      )}

      {/* Drop zone */}
      <div
        onDragOver={e => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
        className={`border-2 border-dashed p-8 text-center cursor-pointer transition-colors ${
          dragging ? 'border-accent/60 bg-accent/5' : 'border-hairline hover:border-strong'
        }`}
      >
        {file ? (
          <div className="flex items-center justify-center gap-3">
            <FileIcon name={file.name} className="text-accent" />
            <div className="text-left">
              <p className="text-ui text-fg font-medium">{file.name}</p>
              <p className="text-label text-fg-secondary/60">{fmtSize(file.size)}</p>
            </div>
            <button
              onClick={e => { e.stopPropagation(); setFile(null) }}
              className="ml-2 p-1 rounded-control text-fg-secondary/40 hover:text-severity-critical"
            >
              <X size={13} />
            </button>
          </div>
        ) : (
          <>
            <FileArchive size={28} className="mx-auto mb-2 text-fg-secondary/30" />
            <p className="text-ui text-fg-secondary/60">Drag and drop a file here</p>
            <p className="text-label text-fg-secondary/30 mt-1">
              ZIP, PDF, DOCX, CSV, scripts, or any other file - click to browse
            </p>
          </>
        )}
        <input
          ref={inputRef}
          type="file"
          className="sr-only"
          onChange={e => handleFile(e.target.files?.[0])}
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        {/* Name */}
        <div className="col-span-2">
          <label className="label">
            Nom du vault <span className="text-severity-critical">*</span>
          </label>
          <input
            className="input"
            placeholder="ex: SANS DFIR Toolset, IOC Reference Pack…"
            value={name}
            onChange={e => setName(e.target.value)}
          />
        </div>

        {/* Description */}
        <div className="col-span-2">
          <label className="label">Description</label>
          <textarea
            className="input resize-none"
            rows={2}
            placeholder="Contenu, source, version, cas d'usage…"
            value={description}
            onChange={e => setDesc(e.target.value)}
          />
        </div>

        {/* Tags */}
        <div className="col-span-2">
          <label className="label flex items-center gap-1">
            <Tag size={11} />
            Tags
            <span className="text-fg-secondary/40 font-normal">(comma-separated)</span>
          </label>
          <input
            className="input"
            placeholder="ex: malware, forensics, tools, reference"
            value={tags}
            onChange={e => setTags(e.target.value)}
          />
        </div>
      </div>

      <div className="flex justify-end gap-2 pt-1">
        <button className="btn-secondary text-label flex items-center gap-1.5" onClick={onDone}>
          <X size={12} /> Cancel
        </button>
        <button
          className="btn-primary text-label flex items-center gap-1.5"
          disabled={!file || !name.trim() || upload.isPending}
          onClick={() => { setError(null); upload.mutate() }}
        >
          {upload.isPending ? (
            <><span className="animate-spin inline-block">⟳</span> Import en cours…</>
          ) : (
            <><Check size={12} /> Import</>
          )}
        </button>
      </div>
    </div>
  )
}

// ── Empty state ────────────────────────────────────────────────────────────────

function EmptyState({ onUpload }: { onUpload: () => void }) {
  return (
    <div className="card p-12 text-center space-y-4">
      <Archive size={42} className="mx-auto text-fg-secondary/15" />
      <div>
        <p className="text-fg-secondary text-ui font-medium">No vault imported</p>
        <p className="text-fg-secondary/50 text-label mt-1 max-w-sm mx-auto">
          Import reference files - tool kits, IOC lists, scripts,
          playbooks, detection rules - available to every analyst.
        </p>
      </div>
      <button className="btn-primary text-label" onClick={onUpload}>
        <Upload size={12} className="inline mr-1.5" />
        Import the first vault
      </button>
    </div>
  )
}

// ── Filter bar ─────────────────────────────────────────────────────────────────

function FilterBar({
  search, onSearch, total,
}: {
  search: string; onSearch: (v: string) => void; total: number
}) {
  return (
    <div className="flex items-center gap-3">
      <input
        className="input text-ui py-1.5 flex-1 max-w-xs"
        placeholder="Search by name, tag..."
        value={search}
        onChange={e => onSearch(e.target.value)}
      />
      <span className="text-label text-fg-secondary/50 font-mono">{total} vault{total !== 1 ? 's' : ''}</span>
    </div>
  )
}

// ── Page ───────────────────────────────────────────────────────────────────────

export default function VaultManagement() {
  const qc = useQueryClient()
  const [showUpload, setShowUpload] = useState(false)
  const [search, setSearch]         = useState('')

  const { data: vaults = [], isLoading } = useQuery({
    queryKey: ['vaults'],
    queryFn:  vaultApi.list,
  })

  const deleteMut = useMutation({
    mutationFn: vaultApi.delete,
    onSuccess:  () => qc.invalidateQueries({ queryKey: ['vaults'] }),
  })

  const updateMut = useMutation({
    mutationFn: ({ id, patch }: { id: number; patch: VaultPatch }) => vaultApi.update(id, patch),
    onSuccess:  () => qc.invalidateQueries({ queryKey: ['vaults'] }),
  })

  const handleDelete = (id: number) => {
    if (confirm('Delete this vault? This cannot be undone.')) {
      deleteMut.mutate(id)
    }
  }

  const handleSave = (id: number, patch: VaultPatch) => {
    updateMut.mutate({ id, patch })
  }

  // Filter
  const q = search.toLowerCase()
  const filtered = vaults.filter(v => {
    if (!q) return true
    return (
      v.name.toLowerCase().includes(q) ||
      v.description.toLowerCase().includes(q) ||
      v.tags.toLowerCase().includes(q) ||
      v.file_name.toLowerCase().includes(q)
    )
  })

  return (
    <PageShell
      route="/config/vaults"
      title="Vault Management"
      subtitle={"Shared reference file library - tools, IOCs, scripts, rules, playbooks."}
      actions={(
        <button
          className="btn-primary flex items-center gap-1.5"
          onClick={() => setShowUpload((u) => !u)}
        >
          <Upload size={13} /> Import a vault
        </button>
      )}
    >
      <div className="max-w-4xl mx-auto space-y-6">

      {/* Upload form */}
      {showUpload && (
        <UploadForm onDone={() => setShowUpload(false)} />
      )}

      {/* Filter bar (only when there are vaults) */}
      {!isLoading && vaults.length > 0 && (
        <FilterBar search={search} onSearch={setSearch} total={filtered.length} />
      )}

      {/* List */}
      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map(i => (
            <div key={i} className="card p-5 animate-pulse">
              <div className="flex gap-3">
                <div className="w-10 h-10 bg-fg/5" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 bg-fg/5 rounded-control w-48" />
                  <div className="h-3 bg-fg/5 rounded-control w-72" />
                  <div className="h-2.5 bg-fg/5 rounded-control w-32" />
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : vaults.length === 0 && !showUpload ? (
        <EmptyState onUpload={() => setShowUpload(true)} />
      ) : filtered.length === 0 ? (
        <div className="card p-8 text-center">
          <p className="text-fg-secondary text-ui">No vault matches "{search}"</p>
          <button className="text-label text-accent mt-2 hover:underline" onClick={() => setSearch('')}>
            Clear search
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map(v => (
            <VaultCard
              key={v.id}
              vault={v}
              onDelete={handleDelete}
              onSave={handleSave}
            />
          ))}
        </div>
      )}
      </div>
    </PageShell>
  )
}
