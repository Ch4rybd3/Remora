import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  FolderInput, RefreshCw, Copy, Check, Inbox, Trash2,
  AlertTriangle, Clock, ChevronRight,
} from 'lucide-react'
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
    <div className="flex items-center gap-2 px-2.5 py-1.5 border-t border-white/5 text-xs">
      <span className="flex-1 min-w-0 font-mono text-white/75 truncate">{f.name}</span>
      <span className="text-accent-muted/40 shrink-0">{fmtSize(f.size)}</span>

      {!f.supported ? (
        <span className="shrink-0 flex items-center gap-1 text-[10px] text-yellow-500/80"
              title="Extension non prise en charge — ce fichier sera ignoré">
          <AlertTriangle size={10} /> non supporté
        </span>
      ) : !f.stable ? (
        <span className="shrink-0 flex items-center gap-1 text-[10px] text-blue-400/80"
              title="Copie encore en cours — l'ingestion attend que le fichier se stabilise">
          <Clock size={10} /> en cours d'écriture
        </span>
      ) : (
        <span className="shrink-0 text-[10px] text-accent-green/70 truncate max-w-[180px]"
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
    <div className="rounded-lg border border-white/10 bg-white/[0.02] overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2.5">
        <button onClick={() => setOpen(o => !o)} className="flex items-center gap-2 flex-1 min-w-0 text-left">
          <ChevronRight size={12}
            className={`text-accent-muted/40 transition-transform ${open ? 'rotate-90' : ''}`} />
          <FolderInput size={14} className="text-accent-green shrink-0" />
          <span className="text-xs font-semibold text-white shrink-0">Drop folder</span>
          {pending.length > 0 && (
            <span className="text-[10px] px-1.5 py-0.5 rounded border bg-accent-green/10 text-accent-green border-accent-green/30 shrink-0">
              {pending.length} en attente
            </span>
          )}
          {inbox.length > 0 && (
            <span className="text-[10px] px-1.5 py-0.5 rounded border bg-yellow-500/10 text-yellow-400 border-yellow-500/30 shrink-0">
              {inbox.length} non assigné{inbox.length > 1 ? 's' : ''}
            </span>
          )}
          <span className="text-[10px] text-accent-muted/35 truncate ml-1">
            {dz.auto_ingest
              ? `auto · balayage toutes les ${status?.poll_seconds ?? 30}s`
              : 'scan manuel'}
          </span>
        </button>

        <button
          onClick={() => scan.mutate(false)}
          disabled={scan.isPending}
          title="Scanner le dossier maintenant"
          className="flex items-center gap-1 text-[10px] px-2 py-1 rounded border border-white/10 text-accent-muted hover:text-accent-green hover:border-accent-green/40 transition-colors disabled:opacity-40"
        >
          <RefreshCw size={10} className={scan.isPending ? 'animate-spin' : ''} />
          Scanner
        </button>
      </div>

      {open && (
        <div className="border-t border-white/5">
          {/* Path */}
          <div className="flex items-center gap-2 px-3 py-2 bg-black/20">
            <code className="flex-1 min-w-0 text-[10px] font-mono text-accent-muted/70 truncate">
              {dz.path}
            </code>
            <button onClick={copyPath} title="Copier le chemin"
              className="text-accent-muted/40 hover:text-accent-green transition-colors shrink-0">
              {copied ? <Check size={11} className="text-accent-green" /> : <Copy size={11} />}
            </button>
          </div>

          <p className="px-3 py-2 text-[10px] text-accent-muted/45 leading-relaxed">
            Déposez vos artefacts (KAPE, EZ Tools, EVTX, EML, ZIP) dans ce dossier : ils sont
            ingérés comme un import de collection, sans passer par le navigateur. Ce chemin est
            celui du serveur ; il peut aussi être monté en lecteur réseau (partage SMB
            <code className="font-mono mx-0.5">dropzone</code>, à activer côté serveur).
            {' '}Un fichier n'est traité qu'après {dz.stable_seconds}s sans modification,
            pour ne jamais lire une copie en cours.
            {dz.processed_count > 0 && (
              <> {dz.processed_count} fichier{dz.processed_count > 1 ? 's' : ''} déjà traité
                {dz.processed_count > 1 ? 's' : ''} (archivé{dz.processed_count > 1 ? 's' : ''} dans
                {' '}<code className="font-mono">.processed/</code>).</>
            )}
          </p>

          {/* Pending in this case's folder */}
          {pending.length > 0 && (
            <div className="mx-3 mb-3 rounded border border-white/5">
              <p className="px-2.5 py-1.5 text-[9px] uppercase tracking-widest text-accent-muted/40">
                En attente dans ce case
              </p>
              {pending.map(f => <FileRow key={f.name} f={f} />)}
              {ready.length === 0 && (
                <p className="px-2.5 py-2 text-[10px] text-accent-muted/40 border-t border-white/5">
                  Aucun fichier prêt — attendez la stabilisation ou forcez le scan.
                  <button
                    onClick={() => scan.mutate(true)}
                    disabled={scan.isPending}
                    className="ml-1 text-accent-green/70 hover:text-accent-green underline disabled:opacity-40"
                  >
                    Forcer maintenant
                  </button>
                </p>
              )}
            </div>
          )}

          {/* Inbox — files dropped at the root, no case */}
          {inbox.length > 0 && (
            <div className="mx-3 mb-3 rounded border border-yellow-500/20 bg-yellow-500/[0.03]">
              <div className="flex items-center gap-2 px-2.5 py-1.5">
                <Inbox size={11} className="text-yellow-400/70" />
                <p className="flex-1 text-[9px] uppercase tracking-widest text-yellow-400/60">
                  Inbox — non assignés
                </p>
                <button
                  onClick={() => assignInbox.mutate([])}
                  disabled={assignInbox.isPending}
                  className="text-[10px] px-2 py-0.5 rounded border border-yellow-500/30 text-yellow-400 hover:bg-yellow-500/10 transition-colors disabled:opacity-40"
                >
                  Tout affecter à ce case
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
                        title="Affecter ce fichier au case courant"
                        className="text-[10px] text-accent-muted/50 hover:text-accent-green transition-colors disabled:opacity-30"
                      >
                        affecter
                      </button>
                      <button
                        onClick={() => deleteInbox.mutate(f.name)}
                        disabled={deleteInbox.isPending}
                        title="Supprimer ce fichier"
                        className="text-accent-muted/30 hover:text-severity-critical transition-colors disabled:opacity-30"
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
            <p className="px-3 pb-3 text-[10px] text-accent-muted/30 italic">
              Dossier vide — rien en attente.
            </p>
          )}

          {/* Last scan feedback */}
          {scan.data && (
            <p className="px-3 pb-3 text-[10px] text-accent-muted/50">
              Dernier scan : {scan.data.ingested} fichier(s) ingéré(s)
              {scan.data.skipped.length > 0 && `, ${scan.data.skipped.length} ignoré(s)`}.
            </p>
          )}
        </div>
      )}
    </div>
  )
}
