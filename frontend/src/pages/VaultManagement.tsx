import { useState, useRef, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Archive, Upload, Trash2, Download, Pencil, X, Check,
  FileText, FileArchive, FileSpreadsheet, File, Code2,
  AlertCircle, Tag, Package,
} from 'lucide-react'
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
    ['zip', 'tar', 'gz', '7z', 'rar'].includes(ext) ? 'bg-amber-500/10 text-amber-400 border-amber-500/20' :
    ['pdf'].includes(ext)                             ? 'bg-red-500/10 text-red-400 border-red-500/20' :
    ['docx', 'doc'].includes(ext)                     ? 'bg-blue-500/10 text-blue-400 border-blue-500/20' :
    ['csv', 'xlsx', 'xls'].includes(ext)              ? 'bg-green-500/10 text-green-400 border-green-500/20' :
    ['py', 'sh', 'ps1', 'js', 'ts'].includes(ext)    ? 'bg-purple-500/10 text-purple-400 border-purple-500/20' :
    ['md', 'txt'].includes(ext)                       ? 'bg-slate-500/10 text-slate-400 border-slate-500/20' :
    'bg-white/5 text-accent-muted border-white/10'

  return (
    <span className={`text-[10px] font-mono font-bold px-1.5 py-0.5 rounded border uppercase ${color}`}>
      .{ext}
    </span>
  )
}

// ── Tag chip ───────────────────────────────────────────────────────────────────

function TagChip({ label }: { label: string }) {
  return (
    <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-accent-green/10 text-accent-green/80 border border-accent-green/20">
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
        <div className="shrink-0 mt-0.5 p-2 rounded-lg bg-white/5 border border-white/5">
          <FileIcon name={vault.file_name} className="text-accent-green/70" />
        </div>

        {/* Meta */}
        <div className="flex-1 min-w-0">
          {editing ? (
            <input
              className="input text-sm font-semibold mb-1 py-1"
              value={editName}
              onChange={e => setEditName(e.target.value)}
              placeholder="Vault name"
              autoFocus
            />
          ) : (
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-semibold text-white">{vault.name}</span>
              <ExtBadge name={vault.file_name} />
              <span className="text-[10px] text-accent-muted/40 font-mono">{fmtSize(vault.file_size)}</span>
            </div>
          )}

          {editing ? (
            <textarea
              className="input text-xs mt-1 resize-none"
              rows={2}
              value={editDesc}
              onChange={e => setEditDesc(e.target.value)}
              placeholder="Description (optional)"
            />
          ) : (
            vault.description
              ? <p className="text-xs text-accent-muted mt-0.5">{vault.description}</p>
              : <p className="text-xs text-accent-muted/30 italic mt-0.5">Pas de description</p>
          )}

          <p className="text-[10px] text-accent-muted/30 mt-1">
            {vault.file_name}
            {' · '}
            Importé le {fmtDateTimeShort(vault.created_at)}
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
                className="p-1.5 rounded text-accent-green hover:bg-accent-green/10 transition-colors disabled:opacity-40"
                title="Enregistrer"
              >
                <Check size={14} />
              </button>
              <button
                onClick={handleCancel}
                className="p-1.5 rounded text-accent-muted/60 hover:text-white hover:bg-white/5 transition-colors"
                title="Annuler"
              >
                <X size={14} />
              </button>
            </>
          ) : (
            <>
              <a
                href={vaultApi.downloadUrl(vault.id)}
                download={vault.file_name}
                className="p-1.5 rounded text-accent-muted/40 hover:text-accent-green hover:bg-accent-green/5 transition-colors"
                title="Télécharger"
              >
                <Download size={14} />
              </a>
              <button
                onClick={() => setEditing(true)}
                className="p-1.5 rounded text-accent-muted/40 hover:text-white hover:bg-white/5 transition-colors opacity-0 group-hover:opacity-100 transition-opacity"
                title="Modifier"
              >
                <Pencil size={13} />
              </button>
              <button
                onClick={() => onDelete(vault.id)}
                className="p-1.5 rounded text-accent-muted/40 hover:text-severity-critical hover:bg-severity-critical/5 transition-colors"
                title="Supprimer"
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
          <label className="label text-[10px] flex items-center gap-1">
            <Tag size={10} />
            Tags <span className="text-accent-muted/40">(séparés par des virgules)</span>
          </label>
          <input
            className="input text-xs"
            value={editTags}
            onChange={e => setEditTags(e.target.value)}
            placeholder="ex: malware, tools, reference"
          />
        </div>
      ) : tags.length > 0 ? (
        <div className="flex flex-wrap gap-1.5 pt-1 border-t border-white/5">
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
    <div className="card p-6 space-y-4 border-accent-green/20">
      <h3 className="text-sm font-semibold text-accent-green flex items-center gap-2">
        <Upload size={14} />
        Importer un vault
      </h3>

      {error && (
        <div className="flex items-start gap-2 bg-severity-critical/10 border border-severity-critical/20 rounded-lg px-3 py-2">
          <AlertCircle size={13} className="text-severity-critical shrink-0 mt-0.5" />
          <p className="text-xs text-severity-critical">{error}</p>
        </div>
      )}

      {/* Drop zone */}
      <div
        onDragOver={e => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
        className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors ${
          dragging ? 'border-accent-green/60 bg-accent-green/5' : 'border-white/10 hover:border-white/20'
        }`}
      >
        {file ? (
          <div className="flex items-center justify-center gap-3">
            <FileIcon name={file.name} className="text-accent-green" />
            <div className="text-left">
              <p className="text-sm text-white font-medium">{file.name}</p>
              <p className="text-xs text-accent-muted/60">{fmtSize(file.size)}</p>
            </div>
            <button
              onClick={e => { e.stopPropagation(); setFile(null) }}
              className="ml-2 p-1 rounded text-accent-muted/40 hover:text-severity-critical"
            >
              <X size={13} />
            </button>
          </div>
        ) : (
          <>
            <FileArchive size={28} className="mx-auto mb-2 text-accent-muted/30" />
            <p className="text-sm text-accent-muted/60">Glissez-déposez un fichier ici</p>
            <p className="text-xs text-accent-muted/30 mt-1">
              ZIP, PDF, DOCX, CSV, scripts, ou tout autre fichier · cliquez pour parcourir
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
            <span className="text-accent-muted/40 font-normal">(séparés par des virgules)</span>
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
        <button className="btn-secondary text-xs flex items-center gap-1.5" onClick={onDone}>
          <X size={12} /> Annuler
        </button>
        <button
          className="btn-primary text-xs flex items-center gap-1.5"
          disabled={!file || !name.trim() || upload.isPending}
          onClick={() => { setError(null); upload.mutate() }}
        >
          {upload.isPending ? (
            <><span className="animate-spin inline-block">⟳</span> Import en cours…</>
          ) : (
            <><Check size={12} /> Importer</>
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
      <Archive size={42} className="mx-auto text-accent-muted/15" />
      <div>
        <p className="text-accent-muted text-sm font-medium">Aucun vault importé</p>
        <p className="text-accent-muted/50 text-xs mt-1 max-w-sm mx-auto">
          Importez des fichiers de référence — kits d'outils, listes d'IOCs, scripts,
          playbooks, règles de détection — accessibles à tous les analystes.
        </p>
      </div>
      <button className="btn-primary text-xs" onClick={onUpload}>
        <Upload size={12} className="inline mr-1.5" />
        Importer le premier vault
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
        className="input text-sm py-1.5 flex-1 max-w-xs"
        placeholder="Rechercher par nom, tag…"
        value={search}
        onChange={e => onSearch(e.target.value)}
      />
      <span className="text-xs text-accent-muted/50 font-mono">{total} vault{total !== 1 ? 's' : ''}</span>
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
    if (confirm('Supprimer ce vault ? Cette action est irréversible.')) {
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
    <div className="p-6 max-w-4xl mx-auto space-y-6">

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-accent-green flex items-center gap-2">
            <Archive size={22} />
            Vault Management
          </h1>
          <p className="text-accent-muted text-sm mt-1">
            Bibliothèque de fichiers de référence partagés — outils, IOCs, scripts, règles, playbooks.
          </p>
        </div>
        <button
          className="btn-primary flex items-center gap-2 text-sm shrink-0"
          onClick={() => setShowUpload(u => !u)}
        >
          <Upload size={14} />
          Importer un vault
        </button>
      </div>

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
                <div className="w-10 h-10 rounded-lg bg-white/5" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 bg-white/5 rounded w-48" />
                  <div className="h-3 bg-white/5 rounded w-72" />
                  <div className="h-2.5 bg-white/5 rounded w-32" />
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : vaults.length === 0 && !showUpload ? (
        <EmptyState onUpload={() => setShowUpload(true)} />
      ) : filtered.length === 0 ? (
        <div className="card p-8 text-center">
          <p className="text-accent-muted text-sm">Aucun vault ne correspond à « {search} »</p>
          <button className="text-xs text-accent-green mt-2 hover:underline" onClick={() => setSearch('')}>
            Effacer la recherche
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
  )
}
