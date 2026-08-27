import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  FolderInput, RefreshCw, Copy, Check, Inbox, Trash2,
  AlertTriangle, Clock, ChevronRight,
} from '../../ui/icons'
import { dropzoneApi, type DropzoneFile } from '../../api/dropzone'

interface Props { caseId: string }

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`
}

function FileRow({ f, action }: { f: DropzoneFile; action?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 px-2.5 py-1.5 border-t border-hairline text-label">
      <span className="flex-1 min-w-0 font-mono text-fg/75 truncate">{f.name}</span>
      <span className="text-fg-secondary/40 shrink-0">{fmtSize(f.size)}</span>

      {!f.supported ? (
        <span className="shrink-0 flex items-center gap-1 text-label text-severity-medium/80"
              title="Unsupported extension - this file will be ignored">
          <AlertTriangle size={10} /> unsupported
        </span>
      ) : !f.stable ? (
        <span className="shrink-0 flex items-center gap-1 text-label text-severity-low/80"
              title="Copy still in progress - ingestion waits for the file to settle">
          <Clock size={10} /> still being written
        </span>
      ) : (
        <span className="shrink-0 text-label text-accent/70 truncate max-w-[180px]"
              title={f.detected ?? undefined}>
          {f.detected ?? 'Artifact Explorer'}
        </span>
      )}

      {action}
    </div>
  )
}

/**
 * Drop folder panel — shows the watched path for this case, what is waiting in
 * it, and the case-less inbox for anything dropped at the root.
 */
export default function DropFolderPanel({ caseId }: Props) {
  const qc = useQueryClient()
  const [open,   setOpen]   = useState(false)
  const [copied, setCopied] = useState(false)

  const { data: dz } = useQuery({
    queryKey: ['dropzone', caseId],
    queryFn: () => dropzoneApi.forCase(caseId),
    // Cheap directory listing — keeps the pending list live while files land
    refetchInterval: 15_000,
  })

  const { data: status } = useQuery({
    queryKey: ['dropzone-status'],
    queryFn: dropzoneApi.status,
    refetchInterval: 30_000,
  })

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['dropzone', caseId] })
    qc.invalidateQueries({ queryKey: ['dropzone-status'] })
    qc.invalidateQueries({ queryKey: ['collection-imports', caseId] })
  }

  const scan = useMutation({
    mutationFn: (includeUnstable: boolean) => dropzoneApi.scan(caseId, includeUnstable),
    onSuccess: invalidate,
  })

  const assignInbox = useMutation({
    mutationFn: (files: string[]) => dropzoneApi.assignInbox(caseId, files),
    onSuccess: invalidate,
  })

  const deleteInbox = useMutation({
    mutationFn: (name: string) => dropzoneApi.deleteInboxFile(name),
    onSuccess: invalidate,
  })

  if (!dz) return null

  const inbox   = status?.inbox ?? []
  const pending = dz.pending
  const ready   = pending.filter(f => f.supported && f.stable)

  const copyPath = () => {
    navigator.clipboard.writeText(dz.path)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className=" border border-hairline bg-white/[0.02] overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2.5">
        <button onClick={() => setOpen(o => !o)} className="flex items-center gap-2 flex-1 min-w-0 text-left">
          <ChevronRight size={12}
            className={`text-fg-secondary/40 transition-transform ${open ? 'rotate-90' : ''}`} />
          <FolderInput size={14} className="text-accent shrink-0" />
          <span className="text-label font-semibold text-fg shrink-0">Drop folder</span>
          {pending.length > 0 && (
            <span className="text-label px-1.5 py-0.5 rounded-control border bg-accent/10 text-accent border-accent/30 shrink-0">
              {pending.length} en attente
            </span>
          )}
          {inbox.length > 0 && (
            <span className="text-label px-1.5 py-0.5 rounded-control border bg-severity-medium/10 text-severity-medium border-severity-medium/30 shrink-0">
              {inbox.length} unassigned
            </span>
          )}
          <span className="text-label text-fg-secondary/35 truncate ml-1">
            {dz.auto_ingest
              ? `auto · balayage toutes les ${status?.poll_seconds ?? 30}s`
              : 'scan manuel'}
          </span>
        </button>

        <button
          onClick={() => scan.mutate(false)}
          disabled={scan.isPending}
          title="Scan the folder now"
          className="flex items-center gap-1 text-label px-2 py-1 rounded-control border border-hairline text-fg-secondary hover:text-accent hover:border-accent/40 transition-colors disabled:opacity-40"
        >
          <RefreshCw size={10} className={scan.isPending ? 'animate-spin' : ''} />
          Scanner
        </button>
      </div>

      {open && (
        <div className="border-t border-hairline">
          {/* Path */}
          <div className="flex items-center gap-2 px-3 py-2 bg-black/20">
            <code className="flex-1 min-w-0 text-label font-mono text-fg-secondary/70 truncate">
              {dz.path}
            </code>
            <button onClick={copyPath} title="Copy the path"
              className="text-fg-secondary/40 hover:text-accent transition-colors shrink-0">
              {copied ? <Check size={11} className="text-accent" /> : <Copy size={11} />}
            </button>
          </div>

          <p className="px-3 py-2 text-label text-fg-secondary/45 leading-relaxed">
            Drop your artifacts (KAPE, EZ Tools, EVTX, EML, ZIP) into this folder: they are
            ingested exactly like a collection import, without going through the browser. This is
            the server-side path; it can also be mounted as a network drive (SMB share
            <code className="font-mono mx-0.5">dropzone</code>, enabled server-side).
            {' '}A file is only processed after {dz.stable_seconds}s without modification,
            pour ne jamais lire une copie en cours.
            {dz.processed_count > 0 && (
              <> {dz.processed_count} file{dz.processed_count > 1 ? 's' : ''} already processed
                (archived in
                {' '}<code className="font-mono">.processed/</code>).</>
            )}
          </p>

          {/* Pending in this case's folder */}
          {pending.length > 0 && (
            <div className="mx-3 mb-3 rounded-control border border-hairline">
              <p className="px-2.5 py-1.5 text-label uppercase tracking-widest text-fg-secondary/40">
                En attente dans ce case
              </p>
              {pending.map(f => <FileRow key={f.name} f={f} />)}
              {ready.length === 0 && (
                <p className="px-2.5 py-2 text-label text-fg-secondary/40 border-t border-hairline">
                  No file ready - wait for it to settle, or force a scan.
                  <button
                    onClick={() => scan.mutate(true)}
                    disabled={scan.isPending}
                    className="ml-1 text-accent/70 hover:text-accent underline disabled:opacity-40"
                  >
                    Forcer maintenant
                  </button>
                </p>
              )}
            </div>
          )}

          {/* Inbox — files dropped at the root, no case */}
          {inbox.length > 0 && (
            <div className="mx-3 mb-3 rounded-control border border-severity-medium/20 bg-severity-medium/[0.03]">
              <div className="flex items-center gap-2 px-2.5 py-1.5">
                <Inbox size={11} className="text-severity-medium/70" />
                <p className="flex-1 text-label uppercase tracking-widest text-severity-medium/60">
                  Inbox - unassigned
                </p>
                <button
                  onClick={() => assignInbox.mutate([])}
                  disabled={assignInbox.isPending}
                  className="text-label px-2 py-0.5 rounded-control border border-severity-medium/30 text-severity-medium hover:bg-severity-medium/10 transition-colors disabled:opacity-40"
                >
                  Assign everything to this case
                </button>
              </div>
              {inbox.map(f => (
                <FileRow
                  key={f.name}
                  f={f}
                  action={
                    <span className="flex items-center gap-1.5 shrink-0">
                      <button
                        onClick={() => assignInbox.mutate([f.name])}
                        disabled={assignInbox.isPending || !f.supported}
                        title="Assign this file to the current case"
                        className="text-label text-fg-secondary/50 hover:text-accent transition-colors disabled:opacity-30"
                      >
                        affecter
                      </button>
                      <button
                        onClick={() => deleteInbox.mutate(f.name)}
                        disabled={deleteInbox.isPending}
                        title="Delete this file"
                        className="text-fg-secondary/30 hover:text-severity-critical transition-colors disabled:opacity-30"
                      >
                        <Trash2 size={10} />
                      </button>
                    </span>
                  }
                />
              ))}
            </div>
          )}

          {pending.length === 0 && inbox.length === 0 && (
            <p className="px-3 pb-3 text-label text-fg-secondary/30 italic">
              Dossier vide — rien en attente.
            </p>
          )}

          {/* Last scan feedback */}
          {scan.data && (
            <p className="px-3 pb-3 text-label text-fg-secondary/50">
              Last scan: {scan.data.ingested} file(s) ingested
              {scan.data.skipped.length > 0 && `, ${scan.data.skipped.length} skipped`}.
            </p>
          )}
        </div>
      )}
    </div>
  )
}
