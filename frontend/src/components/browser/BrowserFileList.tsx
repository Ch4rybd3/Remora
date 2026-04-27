import { useCallback, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useDropzone } from 'react-dropzone'
import {
  Upload, Trash2, RotateCcw, Plus, Check, Loader2, Clock, AlertTriangle,
} from 'lucide-react'
import { browserApi, type BrowserFile } from '../../api/browser'
import { format } from 'date-fns'

interface Props {
  caseId:         string
  selectedFileId: string | null
  onSelectFile:   (file: BrowserFile) => void
}

// ── Artifact type badge ───────────────────────────────────────────────────────

const TYPE_COLORS: Record<string, string> = {
  history:    'bg-blue-500/10 text-blue-400 border-blue-500/20',
  downloads:  'bg-accent-green/10 text-accent-green border-accent-green/20',
  extensions: 'bg-purple-500/10 text-purple-400 border-purple-500/20',
  cookies:    'bg-orange-500/10 text-orange-400 border-orange-500/20',
  autofill:   'bg-yellow-500/10 text-yellow-400 border-yellow-500/20',
  searches:   'bg-teal-500/10 text-teal-400 border-teal-500/20',
  bookmarks:  'bg-pink-500/10 text-pink-400 border-pink-500/20',
  cache:      'bg-white/5 text-white/30 border-white/10',
  generic:    'bg-white/5 text-white/30 border-white/10',
}

function TypeBadge({ type }: { type: string }) {
  const cls = TYPE_COLORS[type] ?? TYPE_COLORS.generic
  return (
    <span className={`text-[8px] font-mono px-1 py-0.5 rounded border ${cls}`}>
      {type}
    </span>
  )
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDuration(s: number): string {
  if (s < 60)  return `${s}s`
  const m = Math.floor(s / 60), rem = s % 60
  return rem > 0 ? `${m}m ${rem}s` : `${m}m`
}

// ── Status badge ──────────────────────────────────────────────────────────────

function StatusBadge({ f }: { f: BrowserFile }) {
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
  if (f.status === 'parsing') {
    const pct   = f.parse_progress ?? 0
    return (
      <div className="w-full space-y-1">
        <span className="flex items-center gap-1 text-[9px] text-blue-400">
          <Loader2 size={9} className="animate-spin shrink-0" />
          Parsing… {pct}%
        </span>
        <div className="h-0.5 w-full bg-white/5 rounded-full overflow-hidden">
          <div
            className="h-full bg-blue-400/60 rounded-full transition-all duration-700"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>
    )
  }
  if (f.status === 'error') return (
    <span className="flex items-center gap-1 text-[9px] text-severity-critical">
      <AlertTriangle size={9} /> Error
    </span>
  )
  return (
    <span className="flex items-center gap-1 text-[9px] text-accent-muted/50">
      <Clock size={9} /> Pending
    </span>
  )
}

// ── Drop zone ─────────────────────────────────────────────────────────────────

function DropZone({ caseId }: { caseId: string }) {
  const qc = useQueryClient()
  const [err, setErr] = useState<string | null>(null)

  const [uploading, setUploading] = useState(false)

  const onDrop = useCallback(async (accepted: File[]) => {
    if (!accepted.length) return
    setErr(null)
    setUploading(true)
    try {
      await Promise.all(accepted.map(f => browserApi.upload(caseId, f)))
      qc.invalidateQueries({ queryKey: ['browser-files', caseId] })
    } catch {
      setErr('One or more uploads failed')
    } finally {
      setUploading(false)
    }
  }, [caseId, qc])

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    multiple: true,
    accept: { 'text/csv': ['.csv'] },
  })

  return (
    <div className="space-y-1.5">
      <div
        {...getRootProps()}
        className={`border-2 border-dashed rounded-lg p-4 text-center cursor-pointer transition-colors ${
          isDragActive
            ? 'border-accent-green bg-accent-green/5'
            : 'border-white/10 hover:border-white/20'
        }`}
      >
        <input {...getInputProps()} />
        {uploading ? (
          <div className="flex flex-col items-center gap-1.5">
            <Loader2 size={18} className="animate-spin text-accent-green" />
            <p className="text-[11px] text-accent-muted">Uploading…</p>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-1.5">
            <Upload size={18} className="text-accent-muted/40" />
            <p className="text-[11px] text-accent-muted">
              Drop <span className="font-mono text-white/60">WebX CSV</span> files here
            </p>
            <p className="text-[10px] text-accent-muted/40">
              History · Downloads · Extensions · Cookies… (multi-file OK)
            </p>
          </div>
        )}
      </div>
      {err && <p className="text-[10px] text-severity-critical">{err}</p>}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function BrowserFileList({ caseId, selectedFileId, onSelectFile }: Props) {
  const qc = useQueryClient()

  const { data: files = [] } = useQuery({
    queryKey:        ['browser-files', caseId],
    queryFn:         () => browserApi.listFiles(caseId),
    refetchInterval: (query) => {
      const data = query.state.data as BrowserFile[] | undefined
      return data?.some(f => f.status === 'pending' || f.status === 'parsing') ? 1500 : false
    },
  })

  const remove = useMutation({
    mutationFn: (id: string) => browserApi.deleteFile(caseId, id),
    onSuccess:  () => qc.invalidateQueries({ queryKey: ['browser-files', caseId] }),
  })

  const reparse = useMutation({
    mutationFn: (id: string) => browserApi.reparse(caseId, id),
    onSuccess:  () => qc.invalidateQueries({ queryKey: ['browser-files', caseId] }),
  })

  const addEvidence = useMutation({
    mutationFn: (id: string) => browserApi.addEvidence(caseId, id),
    onSuccess:  () => qc.invalidateQueries({ queryKey: ['browser-files', caseId] }),
  })

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="px-3 py-3 border-b border-white/5 shrink-0">
        <p className="text-[10px] font-semibold tracking-widest uppercase text-accent-muted/50 mb-3">
          Browser CSV Files
        </p>
        <DropZone caseId={caseId} />
      </div>

      {/* File list */}
      <div className="flex-1 overflow-y-auto">
        {files.length === 0 ? (
          <div className="px-4 py-8 text-center">
            <p className="text-[11px] text-accent-muted/30">No files uploaded yet</p>
          </div>
        ) : (
          <div className="divide-y divide-white/5">
            {files.map(f => (
              <div
                key={f.id}
                onClick={() => f.status === 'ready' && onSelectFile(f)}
                className={`group px-3 py-2.5 transition-colors ${
                  f.status === 'ready' ? 'cursor-pointer' : 'cursor-default'
                } ${
                  selectedFileId === f.id
                    ? 'bg-accent-green/8 border-l-2 border-accent-green'
                    : 'hover:bg-white/[0.03] border-l-2 border-transparent'
                }`}
              >
                {/* Filename + type badge */}
                <div className="flex items-center gap-1.5 min-w-0">
                  <TypeBadge type={f.artifact_type} />
                  <p className="text-xs font-mono text-white/80 truncate flex-1" title={f.filename}>
                    {f.filename}
                  </p>
                </div>

                {/* Status + date */}
                <div className="flex items-center justify-between mt-1">
                  <StatusBadge f={f} />
                  <span className="text-[9px] text-accent-muted/30">
                    {format(new Date(f.uploaded_at), 'dd MMM HH:mm')}
                  </span>
                </div>

                {f.status === 'error' && f.error_msg && (
                  <p className="text-[9px] text-severity-critical/70 mt-1 truncate" title={f.error_msg}>
                    {f.error_msg}
                  </p>
                )}

                {/* Actions */}
                <div className="flex items-center gap-1.5 mt-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                  {(f.status === 'ready' || f.status === 'error') && (
                    <button
                      onClick={e => { e.stopPropagation(); reparse.mutate(f.id) }}
                      disabled={reparse.isPending}
                      className="flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] border border-white/10 text-accent-muted hover:text-white transition-colors"
                      title="Re-parse"
                    >
                      <RotateCcw size={9} />
                    </button>
                  )}
                  {f.status === 'ready' && !f.added_to_evidence && (
                    <button
                      onClick={e => { e.stopPropagation(); addEvidence.mutate(f.id) }}
                      disabled={addEvidence.isPending}
                      className="flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] border border-accent-green/30 text-accent-green hover:bg-accent-green/10 transition-colors"
                      title="Add to evidence"
                    >
                      <Plus size={9} /> Evidence
                    </button>
                  )}
                  {f.added_to_evidence && (
                    <span className="text-[9px] text-accent-green/50 px-1 flex items-center gap-0.5">
                      <Check size={9} /> In evidence
                    </span>
                  )}
                  <button
                    onClick={e => { e.stopPropagation(); remove.mutate(f.id) }}
                    disabled={remove.isPending}
                    className="ml-auto flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] border border-severity-critical/20 text-severity-critical/60 hover:bg-severity-critical/10 transition-colors"
                    title="Delete"
                  >
                    <Trash2 size={9} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
