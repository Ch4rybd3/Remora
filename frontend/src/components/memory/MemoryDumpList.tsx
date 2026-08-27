import { useRef, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Upload, Trash2, HardDrive, AlertCircle, Loader2, CheckCircle2, Clock } from '../../ui/icons'
import { memoryApi, type MemoryDump } from '../../api/memory'
import { fmtRelative } from '../../utils/dateUtils'
import { fmtBytes as formatBytes } from '../../utils/formatUtils'

// ── Status badge ───────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { cls: string; icon: React.ElementType; label: string }> = {
    uploaded:  { cls: 'text-fg-secondary bg-fg/5 border-hairline',           icon: Clock,        label: 'Queued'     },
    analyzing: { cls: 'text-severity-medium bg-severity-medium/8 border-severity-medium/20',    icon: Loader2,      label: 'Analyzing'  },
    done:      { cls: 'text-accent bg-accent/8 border-accent/20', icon: CheckCircle2, label: 'Done'    },
    error:     { cls: 'text-severity-critical bg-severity-critical/8 border-severity-critical/20', icon: AlertCircle, label: 'Error' },
  }
  const theme = map[status] ?? map.uploaded
  const Icon  = theme.icon
  return (
    <span className={`inline-flex items-center gap-1 text-label font-semibold font-mono px-1.5 py-0.5 rounded-control border ${theme.cls}`}>
      <Icon size={9} className={status === 'analyzing' ? 'animate-spin' : ''} />
      {theme.label}
    </span>
  )
}

// ── Upload form ────────────────────────────────────────────────────────────────

function UploadForm({ caseId, onSuccess }: { caseId: string; onSuccess: () => void }) {
  const [dragOver,     setDragOver]     = useState(false)
  const [osType,       setOsType]       = useState<'windows' | 'linux'>('windows')
  const [dumpFile,     setDumpFile]     = useState<File | null>(null)
  const [symbolsFile,  setSymbolsFile]  = useState<File | null>(null)
  const dumpRef    = useRef<HTMLInputElement>(null)
  const symbolsRef = useRef<HTMLInputElement>(null)

  const upload = useMutation({
    mutationFn: (fd: FormData) => memoryApi.upload(caseId, fd),
    onSuccess: () => { setDumpFile(null); setSymbolsFile(null); onSuccess() },
  })

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const f = e.dataTransfer.files[0]
    if (f) setDumpFile(f)
  }

  const handleSubmit = () => {
    if (!dumpFile) return
    const fd = new FormData()
    fd.append('file', dumpFile)
    fd.append('os_type', osType)
    if (symbolsFile) fd.append('symbols_file', symbolsFile)
    upload.mutate(fd)
  }

  return (
    <div className="space-y-3">
      {/* OS selector */}
      <div className="flex gap-1.5">
        {(['windows', 'linux'] as const).map(os => (
          <button
            key={os}
            onClick={() => setOsType(os)}
            className={`flex-1 py-1.5 text-label font-semibold rounded-control border transition-colors capitalize ${ osType === os
                ? 'bg-accent/10 border-accent/30 text-accent'
                : 'bg-white/[0.03] border-hairline text-fg-secondary hover:text-fg'
            }`}
          >
            {os}
          </button>
        ))}
      </div>

      {/* Drop zone */}
      <div
        onDragOver={e => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        onClick={() => dumpRef.current?.click()}
        className={`cursor-pointer border-2 border-dashed p-4 text-center transition-colors ${
          dragOver
            ? 'border-accent/60 bg-accent/5'
            : dumpFile
              ? 'border-accent/30 bg-accent/3'
              : 'border-hairline hover:border-strong'
        }`}
      >
        <input
          ref={dumpRef}
          type="file"
          className="hidden"
          onChange={e => setDumpFile(e.target.files?.[0] ?? null)}
        />
        <Upload size={16} className={`mx-auto mb-1.5 ${dumpFile ? 'text-accent' : 'text-fg-secondary/40'}`} />
        {dumpFile ? (
          <p className="text-label text-accent font-medium truncate px-2">{dumpFile.name}</p>
        ) : (
          <>
            <p className="text-label text-fg-secondary/60">Drop dump file here or click</p>
            <p className="text-label text-fg-secondary/30 mt-0.5">.raw .mem .vmem .dmp .img …</p>
          </>
        )}
      </div>

      {/* Optional symbols */}
      <div>
        <button
          onClick={() => symbolsRef.current?.click()}
          className="w-full text-left text-label text-fg-secondary/50 hover:text-fg-secondary transition-colors flex items-center gap-1.5 px-1"
        >
          <span className="text-fg-secondary/30">+</span>
          {symbolsFile ? (
            <span className="text-fg-secondary truncate">{symbolsFile.name}</span>
          ) : (
            'Add symbol file (optional)'
          )}
        </button>
        <input
          ref={symbolsRef}
          type="file"
          className="hidden"
          onChange={e => setSymbolsFile(e.target.files?.[0] ?? null)}
        />
      </div>

      {upload.isError && (
        <p className="text-label text-severity-critical">
          {(upload.error as Error)?.message ?? 'Upload failed'}
        </p>
      )}

      <button
        onClick={handleSubmit}
        disabled={!dumpFile || upload.isPending}
        className="btn-primary w-full text-label flex items-center justify-center gap-1.5 disabled:opacity-40"
      >
        {upload.isPending ? <><Loader2 size={12} className="animate-spin" /> Uploading…</> : 'Upload & Analyze'}
      </button>
    </div>
  )
}

// ── Dump list ──────────────────────────────────────────────────────────────────


interface Props {
  caseId:         string
  selectedDumpId: string | null
  onSelect:       (dump: MemoryDump) => void
}

export default function MemoryDumpList({ caseId, selectedDumpId, onSelect }: Props) {
  const qc = useQueryClient()
  const { data: dumps = [], refetch } = useQuery({
    queryKey: ['memory-dumps', caseId],
    queryFn:  () => memoryApi.listDumps(caseId),
    refetchInterval: (query) => {
      const d = query.state.data ?? []
      return d.some(x => x.status === 'analyzing' || x.status === 'uploaded') ? 3000 : false
    },
  })

  const deleteDump = useMutation({
    mutationFn: (id: string) => memoryApi.deleteDump(caseId, id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['memory-dumps', caseId] }),
  })

  return (
    <div className="flex flex-col gap-4">
      <UploadForm caseId={caseId} onSuccess={() => refetch()} />

      {dumps.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-label font-semibold tracking-widest uppercase text-fg-secondary/40 px-1">
            Dumps ({dumps.length})
          </p>
          {dumps.map(dump => (
            <div
              key={dump.id}
              onClick={() => onSelect(dump)}
              className={`group relative border p-2.5 cursor-pointer transition-all ${
                selectedDumpId === dump.id
                  ? 'border-accent/40 bg-accent/5'
                  : 'border-hairline bg-white/[0.02] hover:border-hairline hover:bg-white/[0.04]'
              }`}
            >
              <div className="flex items-start gap-2">
                <HardDrive size={12} className="text-fg-secondary/50 shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <p className="text-label font-medium text-fg truncate">{dump.filename}</p>
                  <div className="flex items-center gap-2 mt-1">
                    <StatusBadge status={dump.status} />
                    <span className="text-label text-fg-secondary/40 font-mono capitalize">{dump.os_type}</span>
                    <span className="text-label text-fg-secondary/30 font-mono">{formatBytes(dump.file_size)}</span>
                  </div>
                  <p className="text-label text-fg-secondary/30 mt-0.5">
                    {fmtRelative(dump.uploaded_at)}
                  </p>
                  {dump.error_msg && (
                    <p className="text-label text-severity-critical mt-1 line-clamp-2">{dump.error_msg}</p>
                  )}
                </div>
                <button
                  onClick={e => { e.stopPropagation(); deleteDump.mutate(dump.id) }}
                  className="opacity-0 group-hover:opacity-100 p-1 rounded-control text-fg-secondary/40 hover:text-severity-critical hover:bg-severity-critical/10 transition-all shrink-0"
                  title="Delete dump"
                >
                  <Trash2 size={10} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
