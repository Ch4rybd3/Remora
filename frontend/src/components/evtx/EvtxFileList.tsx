import { useRef, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Upload, FileText, Loader2, CheckCircle2, AlertCircle,
  Trash2, Clock, Plus, RotateCcw,
} from '../../ui/icons'
import { evtxApi, type EvtxFile } from '../../api/evtx'
import { fmtDateTimeShort } from '../../utils/dateUtils'

interface Props {
  caseId:           string
  selectedFileId:   string | null
  onSelectFile:     (fileId: string) => void
}

// ── Status badge ──────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: EvtxFile['status'] }) {
  if (status === 'ready')   return (
    <span className="flex items-center gap-1 text-label text-accent">
      <CheckCircle2 size={10} /> Ready
    </span>
  )
  if (status === 'parsing') return (
    <span className="flex items-center gap-1 text-label text-severity-low animate-pulse">
      <Loader2 size={10} className="animate-spin" /> Parsing…
    </span>
  )
  if (status === 'error')   return (
    <span className="flex items-center gap-1 text-label text-severity-critical">
      <AlertCircle size={10} /> Error
    </span>
  )
  return (
    <span className="flex items-center gap-1 text-label text-fg-secondary/50">
      <Clock size={10} /> Pending
    </span>
  )
}

// ── Drop zone ─────────────────────────────────────────────────────────────────

function DropZone({ caseId }: { caseId: string }) {
  const qc             = useQueryClient()
  const inputRef       = useRef<HTMLInputElement>(null)
  const [dragging, setDragging]   = useState(false)

  const upload = useMutation({
    mutationFn: (file: File) => evtxApi.upload(caseId, file),
    onSuccess:  () => qc.invalidateQueries({ queryKey: ['evtx-files', caseId] }),
  })

  const handleFiles = (files: FileList | null) => {
    if (!files) return
    Array.from(files).forEach(f => {
      if (f.name.toLowerCase().endsWith('.evtx')) upload.mutate(f)
    })
  }

  return (
    <div
      onDragEnter={e => { e.preventDefault(); setDragging(true) }}
      onDragLeave={e => { e.preventDefault(); setDragging(false) }}
      onDragOver={e => e.preventDefault()}
      onDrop={e => {
        e.preventDefault()
        setDragging(false)
        handleFiles(e.dataTransfer.files)
      }}
      onClick={() => inputRef.current?.click()}
      className={` border-2 border-dashed  px-4 py-6 flex flex-col items-center gap-2
        cursor-pointer transition-all select-none
        ${dragging
          ? 'border-accent/60 bg-accent/5'
          : 'border-hairline hover:border-strong hover:bg-white/[0.02]'}
      `}
    >
      <input
        ref={inputRef}
        type="file"
        accept=".evtx"
        multiple
        className="sr-only"
        onChange={e => handleFiles(e.target.files)}
      />
      {upload.isPending
        ? <Loader2 size={22} className="animate-spin text-accent/60" />
        : <Upload size={22} className="text-fg-secondary/40" />
      }
      <p className="text-label text-fg-secondary/60 text-center">
        {upload.isPending
          ? 'Uploading…'
          : <>Drop <span className="text-fg/70 font-mono">.evtx</span> files here or click to browse</>
        }
      </p>
      {upload.isError && (
        <p className="text-label text-severity-critical">Upload failed</p>
      )}
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function EvtxFileList({ caseId, selectedFileId, onSelectFile }: Props) {
  const qc = useQueryClient()

  const { data: files = [], isLoading } = useQuery({
    queryKey:    ['evtx-files', caseId],
    queryFn:     () => evtxApi.listFiles(caseId),
    refetchInterval: (query) => {
      // Poll while any file is pending/parsing
      const d = query.state.data as EvtxFile[] | undefined
      const busy = d?.some(f => f.status === 'pending' || f.status === 'parsing')
      return busy ? 2000 : false
    },
  })

  const deleteFile = useMutation({
    mutationFn: (fileId: string) => evtxApi.deleteFile(caseId, fileId),
    onSuccess:  () => qc.invalidateQueries({ queryKey: ['evtx-files', caseId] }),
  })

  const addEvidence = useMutation({
    mutationFn: (fileId: string) => evtxApi.addEvidence(caseId, fileId),
    onSuccess:  () => qc.invalidateQueries({ queryKey: ['evtx-files', caseId] }),
  })

  const reparse = useMutation({
    mutationFn: (fileId: string) => evtxApi.reparse(caseId, fileId),
    onSuccess:  () => qc.invalidateQueries({ queryKey: ['evtx-files', caseId] }),
  })

  return (
    <div className="flex flex-col gap-3">
      <DropZone caseId={caseId} />

      {isLoading && (
        <div className="flex justify-center py-4">
          <Loader2 size={16} className="animate-spin text-fg-secondary/30" />
        </div>
      )}

      {!isLoading && files.length === 0 && (
        <p className="text-label text-fg-secondary/30 italic text-center py-2">
          No EVTX files uploaded yet
        </p>
      )}

      {files.map(f => (
        <div
          key={f.id}
          onClick={() => f.status === 'ready' && onSelectFile(f.id)}
          className={` group  border p-3 flex flex-col gap-2 transition-all
            ${f.status === 'ready' ? 'cursor-pointer' : 'cursor-default'}
            ${selectedFileId === f.id
              ? 'border-accent/40 bg-accent/5'
              : 'border-hairline hover:border-hairline bg-white/[0.02]'}
          `}
        >
          {/* Header row */}
          <div className="flex items-start gap-2">
            <FileText size={13} className="shrink-0 mt-0.5 text-fg-secondary/50" />
            <div className="flex-1 min-w-0">
              <p className="text-label font-medium text-fg/80 truncate" title={f.filename}>
                {f.filename}
              </p>
              <div className="flex items-center gap-2 mt-0.5">
                <StatusBadge status={f.status} />
                {f.status === 'ready' && f.event_count != null && (
                  <span className="text-label text-fg-secondary/40">
                    {f.event_count.toLocaleString()} events
                  </span>
                )}
              </div>
            </div>
            {/* Actions */}
            <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
              onClick={e => e.stopPropagation()}>
              {/* Re-parse button — always available when file is on disk */}
              {(f.status === 'ready' || f.status === 'error') && (
                <button
                  onClick={() => reparse.mutate(f.id)}
                  disabled={reparse.isPending}
                  title="Re-parse with latest parser"
                  className="p-1 rounded-control text-fg-secondary/30 hover:text-severity-low transition-colors"
                >
                  <RotateCcw size={11} />
                </button>
              )}
              {f.status === 'ready' && !f.added_to_evidence && (
                <button
                  onClick={() => addEvidence.mutate(f.id)}
                  disabled={addEvidence.isPending}
                  title="Add to case evidence"
                  className="flex items-center gap-0.5 px-1.5 py-0.5 rounded-control text-label border border-accent/30 text-accent hover:bg-accent/10 transition-colors"
                >
                  <Plus size={9} /> Evidence
                </button>
              )}
              {f.added_to_evidence && (
                <span className="text-label text-accent/50 px-1">✓ In evidence</span>
              )}
              <button
                onClick={() => {
                  if (confirm(`Delete "${f.filename}"?`)) deleteFile.mutate(f.id)
                }}
                className="p-1 rounded-control text-fg-secondary/30 hover:text-severity-critical transition-colors"
                title="Delete"
              >
                <Trash2 size={11} />
              </button>
            </div>
          </div>

          {/* Error message */}
          {f.status === 'error' && f.error_msg && (
            <p className="text-label text-severity-critical/80 bg-severity-critical/5 rounded-control px-2 py-1">
              {f.error_msg}
            </p>
          )}

          {/* Parsing progress bar */}
          {(f.status === 'pending' || f.status === 'parsing') && (
            <div className="h-0.5 rounded-pill bg-fg/5 overflow-hidden">
              <div className="h-full bg-severity-low/60 animate-pulse w-1/2" />
            </div>
          )}

          {/* Upload date */}
          <p className="text-label text-fg-secondary/25">
            {fmtDateTimeShort(f.uploaded_at)}
          </p>
        </div>
      ))}
    </div>
  )
}
