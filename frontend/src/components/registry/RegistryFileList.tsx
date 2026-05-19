import { useCallback, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useDropzone } from 'react-dropzone'
import {
  Upload, Trash2, RotateCcw, Loader2, AlertTriangle, CheckCircle2,
} from 'lucide-react'
import { registryApi, type RegistryFile } from '../../api/registry'
import { fmtDateTimeShort } from '../../utils/dateUtils'
import { fmtDuration } from '../../utils/formatUtils'

interface Props {
  caseId:         string
  selectedFileId: string | null
  onSelectFile:   (file: RegistryFile) => void
}

// ── Hive type badge ───────────────────────────────────────────────────────────

const HIVE_COLORS: Record<string, string> = {
  NTUSER:    'bg-blue-500/10   text-blue-400   border-blue-500/20',
  USRCLASS:  'bg-cyan-500/10   text-cyan-400   border-cyan-500/20',
  SYSTEM:    'bg-accent-green/10 text-accent-green border-accent-green/20',
  SOFTWARE:  'bg-purple-500/10 text-purple-400 border-purple-500/20',
  SAM:       'bg-orange-500/10 text-orange-400 border-orange-500/20',
  SECURITY:  'bg-red-500/10    text-red-400    border-red-500/20',
  AMCACHE:   'bg-yellow-500/10 text-yellow-400 border-yellow-500/20',
  SHIMCACHE: 'bg-teal-500/10   text-teal-400   border-teal-500/20',
  BATCH:     'bg-white/5       text-white/50   border-white/10',
  GENERIC:   'bg-white/5       text-white/30   border-white/10',
}

export function HiveBadge({ type }: { type: string }) {
  const cls = HIVE_COLORS[type] ?? HIVE_COLORS.GENERIC
  return (
    <span className={`text-[8px] font-mono px-1.5 py-0.5 rounded border ${cls}`}>
      {type}
    </span>
  )
}

// ── Status badge ──────────────────────────────────────────────────────────────

function StatusBadge({ f }: { f: RegistryFile }) {
  if (f.status === 'ready') {
    return (
      <div className="flex flex-col gap-0.5">
        <span className="text-[9px] text-accent-green font-mono">
          ✓ {(f.entry_count ?? 0).toLocaleString()} entries
        </span>
        {f.parse_duration_seconds != null && (
          <span className="text-[8px] text-accent-muted/35">
            parsed in {fmtDuration(f.parse_duration_seconds)}
          </span>
        )}
      </div>
    )
  }
  if (f.status === 'parsing' || f.status === 'pending') {
    return (
      <div className="space-y-1">
        <div className="flex items-center gap-1 text-[9px] text-yellow-400">
          <Loader2 size={9} className="animate-spin" />
          {f.status === 'pending' ? 'Queued…' : `Parsing… ${f.parse_progress}%`}
        </div>
        {f.status === 'parsing' && (
          <div className="h-0.5 w-full bg-white/5 rounded-full overflow-hidden">
            <div
              className="h-full bg-yellow-400/60 rounded-full transition-all"
              style={{ width: `${f.parse_progress}%` }}
            />
          </div>
        )}
      </div>
    )
  }
  if (f.status === 'error') {
    return (
      <div className="flex items-center gap-1 text-[9px] text-severity-critical">
        <AlertTriangle size={9} />
        <span className="truncate" title={f.error_msg ?? undefined}>Error</span>
      </div>
    )
  }
  return null
}

// ── File row ──────────────────────────────────────────────────────────────────

function FileRow({
  f, selected, onSelect, onDelete, onReparse,
}: {
  f:         RegistryFile
  selected:  boolean
  onSelect:  () => void
  onDelete:  () => void
  onReparse: () => void
}) {
  return (
    <div
      onClick={onSelect}
      className={`px-3 py-2.5 cursor-pointer border-b border-white/5 hover:bg-white/5 transition-colors group ${
        selected ? 'bg-accent-green/5 border-l-2 border-l-accent-green/40' : ''
      }`}
    >
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0 space-y-1">
          <div className="flex items-center gap-1.5">
            <HiveBadge type={f.hive_type} />
          </div>
          <p className={`text-[11px] font-mono truncate ${selected ? 'text-white' : 'text-white/70'}`}>
            {f.filename}
          </p>
          <StatusBadge f={f} />
          <p className="text-[8px] text-accent-muted/25">
            {fmtDateTimeShort(f.uploaded_at)}
          </p>
        </div>
        <div className="flex flex-col gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
          <button
            onClick={e => { e.stopPropagation(); onReparse() }}
            className="p-1 rounded text-accent-muted/40 hover:text-accent-green hover:bg-accent-green/10 transition-colors"
            title="Re-parse"
          >
            <RotateCcw size={10} />
          </button>
          <button
            onClick={e => { e.stopPropagation(); onDelete() }}
            className="p-1 rounded text-accent-muted/40 hover:text-severity-critical hover:bg-severity-critical/10 transition-colors"
            title="Delete"
          >
            <Trash2 size={10} />
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function RegistryFileList({ caseId, selectedFileId, onSelectFile }: Props) {
  const qc = useQueryClient()
  const [err, setErr] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)

  const { data: files = [], isLoading } = useQuery({
    queryKey:  ['registry-files', caseId],
    queryFn:   () => registryApi.listFiles(caseId),
    refetchInterval: (query) => {
      const data = query.state.data ?? []
      return data.some(f => f.status === 'pending' || f.status === 'parsing') ? 2000 : false
    },
  })

  const reparse = useMutation({
    mutationFn: ({ fileId }: { fileId: string }) => registryApi.reparse(caseId, fileId),
    onSuccess:  () => qc.invalidateQueries({ queryKey: ['registry-files', caseId] }),
  })

  const onDrop = useCallback(async (accepted: File[]) => {
    if (!accepted.length) return
    setErr(null)
    setUploading(true)
    try {
      await Promise.all(accepted.map(f => registryApi.upload(caseId, f)))
      qc.invalidateQueries({ queryKey: ['registry-files', caseId] })
    } catch {
      setErr('One or more uploads failed')
    } finally {
      setUploading(false)
    }
  }, [caseId, qc])

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'text/csv': ['.csv'], 'text/plain': ['.csv', '.txt'] },
    multiple: true,
  })

  const handleDelete = async (f: RegistryFile) => {
    if (!confirm(`Delete "${f.filename}"?`)) return
    await registryApi.deleteFile(caseId, f.id)
    qc.invalidateQueries({ queryKey: ['registry-files', caseId] })
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Dropzone */}
      <div className="p-2 border-b border-white/5 shrink-0">
        <div
          {...getRootProps()}
          className={`border border-dashed rounded px-3 py-3 text-center cursor-pointer transition-colors ${
            isDragActive
              ? 'border-accent-green/50 bg-accent-green/5'
              : 'border-white/10 hover:border-white/20 hover:bg-white/5'
          }`}
        >
          <input {...getInputProps()} />
          {uploading ? (
            <div className="flex items-center justify-center gap-1.5 text-[10px] text-accent-muted/50">
              <Loader2 size={11} className="animate-spin" />
              Uploading…
            </div>
          ) : (
            <div className="space-y-0.5">
              <Upload size={13} className="mx-auto text-accent-muted/30" />
              <p className="text-[9px] text-accent-muted/40">Drop RECmd / RegExplorer CSV</p>
              <p className="text-[8px] text-accent-muted/25">Multiple files supported</p>
            </div>
          )}
        </div>
        {err && <p className="text-[9px] text-severity-critical mt-1">{err}</p>}
      </div>

      {/* File list */}
      <div className="flex-1 overflow-y-auto">
        {isLoading && (
          <div className="flex items-center justify-center py-6">
            <Loader2 size={16} className="animate-spin text-accent-muted/40" />
          </div>
        )}
        {!isLoading && files.length === 0 && (
          <p className="text-center text-[10px] text-accent-muted/30 py-6">
            No registry files uploaded yet
          </p>
        )}
        {files.map(f => (
          <FileRow
            key={f.id}
            f={f}
            selected={f.id === selectedFileId}
            onSelect={() => onSelectFile(f)}
            onDelete={() => handleDelete(f)}
            onReparse={() => reparse.mutate({ fileId: f.id })}
          />
        ))}
      </div>
    </div>
  )
}
