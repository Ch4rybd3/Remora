import { useCallback, useState } from 'react'
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query'
import { useDropzone } from 'react-dropzone'
import {
  Upload, Trash2, Loader2, AlertTriangle, Lock, Eye, EyeOff, ShieldCheck,
  BookmarkPlus,
} from '../../ui/icons'
import { binaryApi, type BinaryFile } from '../../api/binary'
import { fmtDateTimeShort } from '../../utils/dateUtils'

interface Props {
  caseId:         string
  selectedFileId: string | null
  onSelectFile:   (file: BinaryFile) => void
}

// ── Status badge ──────────────────────────────────────────────────────────────

function StatusBadge({ f }: { f: BinaryFile }) {
  if (f.status === 'ready') {
    return <span className="text-label text-accent font-mono">✓ {f.binary_type ?? 'ready'}</span>
  }
  if (f.status === 'analysing' || f.status === 'pending') {
    return (
      <span className="flex items-center gap-1 text-label text-severity-medium">
        <Loader2 size={9} className="animate-spin" />
        {f.status}
      </span>
    )
  }
  if (f.status === 'error') {
    return (
      <span className="flex items-center gap-1 text-label text-severity-critical">
        <AlertTriangle size={9} />
        error
      </span>
    )
  }
  return null
}

function fmtSize(bytes: number | null): string {
  if (bytes === null) return '?'
  if (bytes < 1024)       return `${bytes} B`
  if (bytes < 1048576)    return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1048576).toFixed(1)} MB`
}

// ── File row ──────────────────────────────────────────────────────────────────

function FileRow({
  f,
  selected,
  onSelect,
  onDelete,
  onAddEvidence,
  addingEvidence,
}: {
  f:              BinaryFile
  selected:       boolean
  onSelect:       () => void
  onDelete:       () => void
  onAddEvidence:  () => void
  addingEvidence: boolean
}) {
  return (
    <div
      onClick={onSelect}
      className={`px-3 py-2.5 cursor-pointer border-b border-hairline hover:bg-fg/5 transition-colors group ${ selected ? 'bg-accent/5 border-l-2 border-l-accent/40' : ''
      }`}
    >
      <div className="flex items-start gap-2">
        <Lock size={11} className="mt-0.5 shrink-0 text-fg-secondary/30" />
        <div className="flex-1 min-w-0">
          <p className={`text-label font-mono truncate ${selected ? 'text-fg' : 'text-fg/70'}`}>
            {f.filename}
          </p>
          <div className="flex items-center gap-2 mt-0.5">
            <StatusBadge f={f} />
            {f.file_size !== null && (
              <span className="text-label text-fg-secondary/30">{fmtSize(f.file_size)}</span>
            )}
          </div>
          <p className="text-label text-fg-secondary/25 mt-0.5">
            {fmtDateTimeShort(f.uploaded_at)}
          </p>
        </div>
        <button
          onClick={e => { e.stopPropagation(); onDelete() }}
          className="opacity-0 group-hover:opacity-100 p-1 rounded-control text-fg-secondary/40 hover:text-severity-critical hover:bg-severity-critical/10 transition-all"
          title="Delete"
        >
          <Trash2 size={11} />
        </button>
      </div>

      {/* Evidence button — visible only when this file is selected */}
      {selected && (
        <div className="mt-2 pt-2 border-t border-hairline">
          <button
            onClick={e => { e.stopPropagation(); onAddEvidence() }}
            disabled={f.added_to_evidence || addingEvidence}
            className={`w-full flex items-center justify-center gap-1.5 py-1 rounded-control text-label transition-colors ${ f.added_to_evidence
                ? 'border border-accent/20 text-accent/60 bg-accent/5 cursor-default'
                : 'border border-hairline text-fg-secondary/50 hover:border-accent/30 hover:text-accent hover:bg-accent/5'
            } disabled:opacity-50`}
          >
            <BookmarkPlus size={10} />
            {f.added_to_evidence ? 'In evidence' : 'Add to evidence'}
          </button>
        </div>
      )}
    </div>
  )
}

// ── Upload form ───────────────────────────────────────────────────────────────

function UploadForm({ caseId, onDone }: { caseId: string; onDone: () => void }) {
  const [file,       setFile]       = useState<File | null>(null)
  const [password,   setPassword]   = useState('')
  const [showPass,   setShowPass]   = useState(false)
  const [uploading,  setUploading]  = useState(false)
  const [err,        setErr]        = useState<string | null>(null)

  const onDrop = useCallback((accepted: File[]) => {
    if (accepted[0]) { setFile(accepted[0]); setErr(null) }
  }, [])

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    multiple: false,
    maxSize: 500 * 1024 * 1024,
  })

  const handleUpload = async () => {
    if (!file)     return setErr('Select a file first')
    if (!password) return setErr('Password is required for encryption')
    setErr(null)
    setUploading(true)
    try {
      await binaryApi.upload(caseId, file, password)
      setFile(null)
      setPassword('')
      onDone()
    } catch (e: any) {
      setErr(e?.response?.data?.detail ?? 'Upload failed')
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="p-3 space-y-2 border-b border-hairline">
      {/* Dropzone */}
      <div
        {...getRootProps()}
        className={`border border-dashed rounded-control px-3 py-4 text-center cursor-pointer transition-colors ${ isDragActive
            ? 'border-accent/50 bg-accent/5'
            : file
              ? 'border-accent/30 bg-accent/5'
              : 'border-hairline hover:border-strong hover:bg-fg/5'
        }`}
      >
        <input {...getInputProps()} />
        {file ? (
          <div className="space-y-0.5">
            <p className="text-label font-mono text-accent truncate">{file.name}</p>
            <p className="text-label text-fg-secondary/40">{fmtSize(file.size)}</p>
          </div>
        ) : (
          <div className="space-y-1">
            <Upload size={14} className="mx-auto text-fg-secondary/30" />
            <p className="text-label text-fg-secondary/40">Drop a binary here</p>
            <p className="text-label text-fg-secondary/25">PE · ELF · Mach-O</p>
          </div>
        )}
      </div>

      {/* Password field */}
      <div className="relative">
        <Lock size={10} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-secondary/30" />
        <input
          type={showPass ? 'text' : 'password'}
          placeholder="Encryption password"
          value={password}
          onChange={e => setPassword(e.target.value)}
          className="w-full bg-canvas border border-hairline rounded-control px-7 py-1.5 text-label text-fg placeholder:text-fg-secondary/30 focus:outline-none focus:border-accent/30"
        />
        <button
          onClick={() => setShowPass(v => !v)}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-fg-secondary/30 hover:text-fg transition-colors"
          type="button"
        >
          {showPass ? <EyeOff size={11} /> : <Eye size={11} />}
        </button>
      </div>

      {/* Security note */}
      <div className="flex items-start gap-1.5 px-2 py-1.5 bg-accent/5 border border-accent/15 rounded-control">
        <ShieldCheck size={10} className="mt-0.5 shrink-0 text-accent/50" />
        <p className="text-label text-fg-secondary/40 leading-relaxed">
          File encrypted with AES-256 + PBKDF2 before storage. Never executed server-side.
          Password is not stored anywhere.
        </p>
      </div>

      {err && <p className="text-label text-severity-critical">{err}</p>}

      <button
        onClick={handleUpload}
        disabled={uploading || !file || !password}
        className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded-control bg-accent/10 border border-accent/20 text-accent text-label font-medium hover:bg-accent/15 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
      >
        {uploading ? <><Loader2 size={11} className="animate-spin" /> Uploading…</> : <><Upload size={11} /> Upload & Analyse</>}
      </button>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function BinaryFileList({ caseId, selectedFileId, onSelectFile }: Props) {
  const qc = useQueryClient()

  const { data: files = [], isLoading } = useQuery({
    queryKey:  ['binary-files', caseId],
    queryFn:   () => binaryApi.listFiles(caseId),
    refetchInterval: (query) => {
      const data = query.state.data ?? []
      return data.some(f => f.status === 'pending' || f.status === 'analysing') ? 2000 : false
    },
  })

  const handleDelete = async (f: BinaryFile) => {
    if (!confirm(`Delete "${f.filename}"? The encrypted binary will be permanently removed.`)) return
    await binaryApi.deleteFile(caseId, f.id)
    qc.invalidateQueries({ queryKey: ['binary-files', caseId] })
  }

  const addEvidence = useMutation({
    mutationFn: (fileId: string) => binaryApi.addEvidence(caseId, fileId),
    onSuccess: (_, fileId) => {
      qc.invalidateQueries({ queryKey: ['binary-files', caseId] })
      qc.invalidateQueries({ queryKey: ['binary-file', fileId] })
    },
  })

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <UploadForm caseId={caseId} onDone={() => qc.invalidateQueries({ queryKey: ['binary-files', caseId] })} />

      <div className="flex-1 overflow-y-auto">
        {isLoading && (
          <div className="flex items-center justify-center py-6">
            <Loader2 size={16} className="animate-spin text-fg-secondary/40" />
          </div>
        )}
        {!isLoading && files.length === 0 && (
          <p className="text-center text-label text-fg-secondary/30 py-6">No binaries uploaded yet</p>
        )}
        {files.map(f => (
          <FileRow
            key={f.id}
            f={f}
            selected={f.id === selectedFileId}
            onSelect={() => onSelectFile(f)}
            onDelete={() => handleDelete(f)}
            onAddEvidence={() => addEvidence.mutate(f.id)}
            addingEvidence={addEvidence.isPending && addEvidence.variables === f.id}
          />
        ))}
      </div>
    </div>
  )
}
