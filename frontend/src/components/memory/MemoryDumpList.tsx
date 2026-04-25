import { useRef, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Upload, Trash2, HardDrive, AlertCircle, Loader2, CheckCircle2, Clock } from 'lucide-react'
import { memoryApi, type MemoryDump } from '../../api/memory'
import { formatDistanceToNow } from 'date-fns'

// ── Status badge ───────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { cls: string; icon: React.ElementType; label: string }> = {
    uploaded:  { cls: 'text-accent-muted bg-white/5 border-white/10',           icon: Clock,        label: 'Queued'     },
    analyzing: { cls: 'text-yellow-400 bg-yellow-400/8 border-yellow-400/20',    icon: Loader2,      label: 'Analyzing'  },
    done:      { cls: 'text-accent-green bg-accent-green/8 border-accent-green/20', icon: CheckCircle2, label: 'Done'    },
    error:     { cls: 'text-severity-critical bg-severity-critical/8 border-severity-critical/20', icon: AlertCircle, label: 'Error' },
  }
  const theme = map[status] ?? map.uploaded
  const Icon  = theme.icon
  return (
    <span className={`inline-flex items-center gap-1 text-[9px] font-semibold font-mono px-1.5 py-0.5 rounded border ${theme.cls}`}>
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
            className={`flex-1 py-1.5 text-[10px] font-semibold rounded border transition-colors capitalize ${
              osType === os
                ? 'bg-accent-green/10 border-accent-green/30 text-accent-green'
                : 'bg-white/[0.03] border-white/8 text-accent-muted hover:text-white'
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
        className={`cursor-pointer border-2 border-dashed rounded-lg p-4 text-center transition-colors ${
          dragOver
            ? 'border-accent-green/60 bg-accent-green/5'
            : dumpFile
              ? 'border-accent-green/30 bg-accent-green/3'
              : 'border-white/10 hover:border-white/20'
        }`}
      >
        <input
          ref={dumpRef}
          type="file"
          className="hidden"
          onChange={e => setDumpFile(e.target.files?.[0] ?? null)}
        />
        <Upload size={16} className={`mx-auto mb-1.5 ${dumpFile ? 'text-accent-green' : 'text-accent-muted/40'}`} />
        {dumpFile ? (
          <p className="text-[10px] text-accent-green font-medium truncate px-2">{dumpFile.name}</p>
        ) : (
          <>
            <p className="text-[10px] text-accent-muted/60">Drop dump file here or click</p>
            <p className="text-[9px] text-accent-muted/30 mt-0.5">.raw .mem .vmem .dmp .img …</p>
          </>
        )}
      </div>

      {/* Optional symbols */}
      <div>
        <button
          onClick={() => symbolsRef.current?.click()}
          className="w-full text-left text-[10px] text-accent-muted/50 hover:text-accent-muted transition-colors flex items-center gap-1.5 px-1"
        >
          <span className="text-accent-muted/30">+</span>
          {symbolsFile ? (
            <span className="text-accent-muted truncate">{symbolsFile.name}</span>
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
        <p className="text-[10px] text-severity-critical">
          {(upload.error as Error)?.message ?? 'Upload failed'}
        </p>
      )}

      <button
        onClick={handleSubmit}
        disabled={!dumpFile || upload.isPending}
        className="btn-primary w-full text-xs flex items-center justify-center gap-1.5 disabled:opacity-40"
      >
        {upload.isPending ? <><Loader2 size={12} className="animate-spin" /> Uploading…</> : 'Upload & Analyze'}
      </button>
    </div>
  )
}

// ── Dump list ──────────────────────────────────────────────────────────────────

function formatBytes(n: number | null): string {
  if (!n) return '—'
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 ** 3) return `${(n / 1024 / 1024).toFixed(1)} MB`
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`
}

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
          <p className="text-[9px] font-semibold tracking-widest uppercase text-accent-muted/40 px-1">
            Dumps ({dumps.length})
          </p>
          {dumps.map(dump => (
            <div
              key={dump.id}
              onClick={() => onSelect(dump)}
              className={`group relative rounded-lg border p-2.5 cursor-pointer transition-all ${
                selectedDumpId === dump.id
                  ? 'border-accent-green/40 bg-accent-green/5'
                  : 'border-white/8 bg-white/[0.02] hover:border-white/15 hover:bg-white/[0.04]'
              }`}
            >
              <div className="flex items-start gap-2">
                <HardDrive size={12} className="text-accent-muted/50 shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <p className="text-[11px] font-medium text-white truncate">{dump.filename}</p>
                  <div className="flex items-center gap-2 mt-1">
                    <StatusBadge status={dump.status} />
                    <span className="text-[9px] text-accent-muted/40 font-mono capitalize">{dump.os_type}</span>
                    <span className="text-[9px] text-accent-muted/30 font-mono">{formatBytes(dump.file_size)}</span>
                  </div>
                  <p className="text-[9px] text-accent-muted/30 mt-0.5">
                    {formatDistanceToNow(new Date(dump.uploaded_at), { addSuffix: true })}
                  </p>
                  {dump.error_msg && (
                    <p className="text-[9px] text-severity-critical mt-1 line-clamp-2">{dump.error_msg}</p>
                  )}
                </div>
                <button
                  onClick={e => { e.stopPropagation(); deleteDump.mutate(dump.id) }}
                  className="opacity-0 group-hover:opacity-100 p-1 rounded text-accent-muted/40 hover:text-severity-critical hover:bg-severity-critical/10 transition-all shrink-0"
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
