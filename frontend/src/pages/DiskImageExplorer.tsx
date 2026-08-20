/**
 * Disk Image Explorer — FTK Imager-style browsing of forensic images.
 *
 * Layout mirrors FTK Imager: the evidence tree on the left, the current
 * directory's contents top-right, and the selected file's bytes bottom-right.
 */
import { useState, useMemo, useCallback } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import {
  HardDrive, ChevronRight, Folder, FolderOpen, File as FileIcon, Loader2,
  AlertCircle, Download, Hash, FileOutput, Check, Copy, Layers,
} from 'lucide-react'
import {
  diskImagesApi, type DirEntry, type DiskImageFile, type Partition,
} from '../api/diskImages'
import { useCurrentCase } from '../context/CurrentCaseContext'

const PREVIEW_BYTES = 4096

function fmtSize(n: number | null): string {
  if (n === null || n === undefined) return ''
  if (n < 1024) return `${n} o`
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} Ko`
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} Mo`
  return `${(n / 1024 ** 3).toFixed(2)} Go`
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  return iso.replace('T', ' ').replace(/\.\d+/, '').replace('+00:00', '')
}

/** NTFS metadata files ($MFT, $LogFile…) — worth flagging, not hiding. */
function isMetadata(name: string): boolean {
  return name.startsWith('$')
}

// ── Hex viewer ────────────────────────────────────────────────────────────────

function HexView({ hex }: { hex: string }) {
  const bytes = useMemo(() => {
    const out: number[] = []
    for (let i = 0; i + 1 < hex.length; i += 2) out.push(parseInt(hex.slice(i, i + 2), 16))
    return out
  }, [hex])

  if (bytes.length === 0) {
    return <p className="p-3 text-[10px] text-accent-muted/30 italic">Fichier vide.</p>
  }

  const rows: number[][] = []
  for (let i = 0; i < bytes.length; i += 16) rows.push(bytes.slice(i, i + 16))

  return (
    <div className="p-2 font-mono text-[10px] leading-[1.45]">
      {rows.map((row, r) => (
        <div key={r} className="flex gap-3 whitespace-pre">
          <span className="text-accent-muted/30 shrink-0">
            {(r * 16).toString(16).padStart(8, '0')}
          </span>
          <span className="text-white/60 shrink-0">
            {row.map((b, i) => b.toString(16).padStart(2, '0') + (i === 7 ? '  ' : ' ')).join('')}
            {row.length < 16 && ' '.repeat((16 - row.length) * 3 + (row.length <= 8 ? 1 : 0))}
          </span>
          <span className="text-white/45 shrink-0">
            {row.map(b => (b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : '.')).join('')}
          </span>
        </div>
      ))}
    </div>
  )
}

// ── Directory tree ────────────────────────────────────────────────────────────

function TreeDir({ image, partition, dirPath, name, depth, currentDir, onNavigate }: {
  image:      string
  partition:  number
  dirPath:    string
  name:       string
  depth:      number
  currentDir: string
  onNavigate: (dir: string) => void
}) {
  const [open, setOpen] = useState(depth === 0)

  const { data: entries, isFetching } = useQuery({
    queryKey: ['di-tree', image, partition, dirPath],
    queryFn:  () => diskImagesApi.listDir(image, partition, dirPath),
    enabled:  open,
  })

  const subdirs = (entries ?? []).filter(e => e.is_dir)
  const isCurrent = currentDir === dirPath

  return (
    <div>
      <div
        onClick={() => { setOpen(o => !o); onNavigate(dirPath) }}
        className={`flex items-center gap-1 px-1 py-[3px] text-[10px] cursor-pointer transition-colors ${
          isCurrent ? 'bg-accent-green/10 text-accent-green' : 'text-white/70 hover:bg-white/5'
        }`}
        style={{ paddingLeft: 4 + depth * 11 }}
      >
        <ChevronRight size={9}
          className={`shrink-0 text-accent-muted/40 transition-transform ${open ? 'rotate-90' : ''}`} />
        {open ? <FolderOpen size={10} className="shrink-0 text-accent-green/60" />
              : <Folder size={10} className="shrink-0 text-accent-muted/50" />}
        <span className="truncate font-mono">{name}</span>
        {isFetching && <Loader2 size={8} className="animate-spin text-accent-muted/40 shrink-0" />}
      </div>

      {open && subdirs.map(d => (
        <TreeDir key={d.path} image={image} partition={partition} dirPath={d.path}
                 name={d.name} depth={depth + 1} currentDir={currentDir} onNavigate={onNavigate} />
      ))}
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function DiskImageExplorer() {
  const { currentCase } = useCurrentCase()
  const caseId = currentCase?.id

  const [image,     setImage]     = useState<string | null>(null)
  const [partition, setPartition] = useState<number | null>(null)
  const [dir,       setDir]       = useState('/')
  const [selected,  setSelected]  = useState<DirEntry | null>(null)
  const [copied,      setCopied]      = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [downloadError, setDownloadError] = useState<string | null>(null)

  const { data: status } = useQuery({ queryKey: ['di-status'], queryFn: diskImagesApi.status })

  const { data: images = [], isLoading: loadingImages } = useQuery({
    queryKey: ['di-images'], queryFn: diskImagesApi.list,
  })

  const { data: partitions = [], isFetching: loadingParts, error: partError } = useQuery({
    queryKey: ['di-parts', image],
    queryFn:  () => diskImagesApi.partitions(image!),
    enabled:  !!image,
  })

  const { data: entries = [], isFetching: loadingDir, error: dirError } = useQuery({
    queryKey: ['di-list', image, partition, dir],
    queryFn:  () => diskImagesApi.listDir(image!, partition!, dir),
    enabled:  !!image && partition !== null,
  })

  const { data: preview, isFetching: loadingPreview } = useQuery({
    queryKey: ['di-preview', image, partition, selected?.path],
    queryFn:  () => diskImagesApi.preview(image!, partition!, selected!.path, 0, PREVIEW_BYTES),
    enabled:  !!image && partition !== null && !!selected && !selected.is_dir,
  })

  const { data: hashes, refetch: computeHash, isFetching: hashing } = useQuery({
    queryKey: ['di-hash', image, partition, selected?.path],
    queryFn:  () => diskImagesApi.hash(image!, partition!, selected!.path),
    enabled:  false,
  })

  const extract = useMutation({
    mutationFn: () => diskImagesApi.extract(caseId!, image!, partition!, selected!.path),
  })

  const selectImage = useCallback((img: DiskImageFile) => {
    setImage(img.path); setPartition(null); setDir('/'); setSelected(null)
  }, [])

  const selectPartition = useCallback((p: Partition) => {
    setPartition(p.number); setDir('/'); setSelected(null)
  }, [])

  const navigate = useCallback((d: string) => { setDir(d); setSelected(null) }, [])

  const copyPath = () => {
    if (!selected) return
    navigator.clipboard.writeText(selected.path)
    setCopied(true); setTimeout(() => setCopied(false), 1500)
  }

  /**
   * Fetch-then-blob rather than a plain <a href>: the API authenticates with a
   * Bearer header held in memory, which a browser-initiated navigation would
   * not send — the link would just 401.
   */
  const download = useCallback(async () => {
    if (!selected || !image || partition === null) return
    setDownloading(true)
    setDownloadError(null)
    try {
      const token = localStorage.getItem('remora_token')
      const res = await fetch(diskImagesApi.downloadUrl(image, partition, selected.path), {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url; a.download = selected.name
      a.click()
      URL.revokeObjectURL(url)
    } catch (e) {
      setDownloadError((e as Error).message)
    } finally {
      setDownloading(false)
    }
  }, [selected, image, partition])

  // ── Guards ────────────────────────────────────────────────────────────────

  if (status && !status.available) {
    return (
      <div className="p-6">
        <div className="flex items-center gap-2 text-sm text-yellow-400 bg-yellow-500/5 border border-yellow-500/20 rounded-lg px-4 py-3">
          <AlertCircle size={14} />
          dissect.target n'est pas installé dans l'image backend — l'exploration d'images est désactivée.
        </div>
      </div>
    )
  }

  if (status && !status.configured) {
    return (
      <div className="p-6 space-y-3">
        <div className="flex items-start gap-2 text-sm text-yellow-400 bg-yellow-500/5 border border-yellow-500/20 rounded-lg px-4 py-3">
          <AlertCircle size={14} className="mt-0.5 shrink-0" />
          <div>
            <p className="font-semibold">Aucun répertoire d'images configuré</p>
            <p className="text-[11px] text-yellow-400/70 mt-1 leading-relaxed">
              Montez un volume contenant vos images et renseignez <code className="font-mono">DISK_IMAGES_HOST_PATH</code>{' '}
              dans le <code className="font-mono">.env</code>, puis redémarrez la pile.
              Les images sont lues sur place, en lecture seule.
            </p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full overflow-hidden">
      {/* ── Evidence tree ────────────────────────────────────────────────── */}
      <div className="w-72 shrink-0 border-r border-white/5 bg-bg-card flex flex-col overflow-hidden">
        <p className="px-3 py-3 text-[10px] font-semibold uppercase tracking-widest text-accent-muted/50 flex items-center gap-1.5 border-b border-white/5">
          <HardDrive size={11} /> Images
          {images.length > 0 && <span className="ml-auto text-accent-muted/30">{images.length}</span>}
        </p>

        <div className="flex-1 overflow-y-auto">
          {loadingImages && (
            <div className="flex items-center gap-2 px-3 py-3 text-[10px] text-accent-muted/40">
              <Loader2 size={10} className="animate-spin" /> Analyse du répertoire…
            </div>
          )}
          {!loadingImages && images.length === 0 && (
            <p className="px-3 py-6 text-[10px] text-accent-muted/30 leading-relaxed text-center">
              Aucune image trouvée dans{' '}
              <code className="font-mono">{status?.roots.join(', ') || '—'}</code>.
            </p>
          )}

          {images.map(img => (
            <div key={img.path}>
              <div
                onClick={() => selectImage(img)}
                className={`px-2 py-1.5 cursor-pointer border-b border-white/[0.03] transition-colors ${
                  image === img.path ? 'bg-accent-green/5' : 'hover:bg-white/[0.02]'
                }`}
              >
                <div className="flex items-center gap-1.5">
                  <HardDrive size={10} className="shrink-0 text-accent-green/60" />
                  <span className="text-[10px] font-mono text-white/80 truncate">{img.name}</span>
                </div>
                <p className="text-[9px] text-accent-muted/35 mt-0.5 pl-[18px]">
                  {img.format.toUpperCase()} · {fmtSize(img.size)}
                </p>
              </div>

              {image === img.path && (
                <div className="border-b border-white/[0.03]">
                  {loadingParts && (
                    <div className="flex items-center gap-2 px-4 py-2 text-[10px] text-accent-muted/40">
                      <Loader2 size={9} className="animate-spin" /> Ouverture…
                    </div>
                  )}
                  {partError && (
                    <p className="px-4 py-2 text-[9px] text-severity-critical">
                      {(partError as any)?.response?.data?.detail ?? 'Ouverture impossible.'}
                    </p>
                  )}
                  {partitions.map(p => (
                    <div key={p.number}>
                      <div
                        onClick={() => p.browsable && selectPartition(p)}
                        title={p.browsable ? undefined : 'Système de fichiers non reconnu'}
                        className={`flex items-center gap-1.5 px-4 py-1.5 text-[10px] transition-colors ${
                          !p.browsable ? 'text-accent-muted/25 cursor-not-allowed'
                          : partition === p.number ? 'bg-accent-green/10 text-accent-green cursor-pointer'
                          : 'text-white/65 hover:bg-white/5 cursor-pointer'
                        }`}
                      >
                        <Layers size={9} className="shrink-0" />
                        <span className="font-mono truncate">
                          Partition {p.number}
                          {p.fs_type && <span className="text-accent-muted/40"> · {p.fs_type}</span>}
                          {p.label && <span className="text-accent-muted/40"> · {p.label}</span>}
                        </span>
                        <span className="ml-auto text-accent-muted/25 shrink-0">{fmtSize(p.size)}</span>
                      </div>

                      {partition === p.number && p.browsable && (
                        <div className="border-t border-white/[0.03] py-1">
                          <TreeDir image={img.path} partition={p.number} dirPath="/"
                                   name="/" depth={0} currentDir={dir} onNavigate={navigate} />
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* ── Directory contents + file preview ────────────────────────────── */}
      <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
        {/* Breadcrumb */}
        <div className="flex items-center gap-2 px-3 py-2 border-b border-white/5 shrink-0">
          <code className="text-[10px] font-mono text-accent-muted/60 truncate flex-1">
            {image ? `${image.split('/').pop()} › partition ${partition ?? '—'} › ${dir}` : 'Sélectionnez une image'}
          </code>
          {loadingDir && <Loader2 size={11} className="animate-spin text-accent-green/50" />}
          {entries.length > 0 && (
            <span className="text-[10px] text-accent-muted/35 shrink-0">{entries.length} entrée(s)</span>
          )}
        </div>

        {/* Contents */}
        <div className="flex-1 min-h-0 overflow-auto">
          {partition === null ? (
            <p className="p-6 text-center text-[11px] text-accent-muted/30">
              Choisissez une image puis une partition pour explorer son contenu.
            </p>
          ) : dirError ? (
            <p className="p-6 text-center text-[11px] text-severity-critical">
              {(dirError as any)?.response?.data?.detail ?? 'Lecture du répertoire impossible.'}
            </p>
          ) : (
            <table className="w-full text-[10px] font-mono border-collapse">
              <thead className="sticky top-0 bg-bg-card z-10">
                <tr className="text-accent-muted/40 text-left">
                  <th className="px-2 py-1.5">Nom</th>
                  <th className="px-2 py-1.5 w-24">Taille</th>
                  <th className="px-2 py-1.5 w-40">Modifié</th>
                  <th className="px-2 py-1.5 w-40">Créé</th>
                </tr>
              </thead>
              <tbody>
                {dir !== '/' && (
                  <tr onClick={() => navigate(dir.split('/').slice(0, -1).join('/') || '/')}
                      className="border-t border-white/[0.03] cursor-pointer hover:bg-white/[0.03]">
                    <td colSpan={4} className="px-2 py-1 text-accent-muted/50">../</td>
                  </tr>
                )}
                {entries.map(e => (
                  <tr key={e.path}
                    onClick={() => e.is_dir ? navigate(e.path) : setSelected(e)}
                    className={`border-t border-white/[0.03] cursor-pointer transition-colors ${
                      selected?.path === e.path ? 'bg-accent-green/10' : 'hover:bg-white/[0.03]'
                    }`}>
                    <td className="px-2 py-1">
                      <span className="flex items-center gap-1.5">
                        {e.is_dir
                          ? <Folder size={10} className="shrink-0 text-accent-muted/50" />
                          : <FileIcon size={10} className="shrink-0 text-accent-muted/30" />}
                        <span className={
                          e.error ? 'text-severity-critical/70'
                          : isMetadata(e.name) ? 'text-purple-300/70'
                          : e.is_dir ? 'text-white/80' : 'text-white/60'
                        }>{e.name}</span>
                        {e.error && (
                          <span className="text-[9px] text-severity-critical/60" title={e.error}>
                            illisible
                          </span>
                        )}
                      </span>
                    </td>
                    <td className="px-2 py-1 text-accent-muted/40">{e.is_dir ? '' : fmtSize(e.size)}</td>
                    <td className="px-2 py-1 text-accent-muted/40">{fmtDate(e.mtime)}</td>
                    <td className="px-2 py-1 text-accent-muted/40">{fmtDate(e.btime)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {partition !== null && !loadingDir && entries.length === 0 && !dirError && (
            <p className="p-6 text-center text-[11px] text-accent-muted/30">Répertoire vide.</p>
          )}
        </div>

        {/* File preview */}
        <div className="h-64 shrink-0 border-t border-white/8 flex flex-col overflow-hidden">
          <div className="flex items-center gap-2 px-2 py-1 border-b border-white/5 shrink-0">
            <p className="text-[9px] uppercase tracking-widest text-accent-muted/35 truncate">
              {selected && !selected.is_dir
                ? `${selected.name} — ${fmtSize(selected.size)}${preview && preview.total > preview.length ? ` (${fmtSize(preview.length)} affichés)` : ''}`
                : 'Aperçu'}
            </p>
            {selected && !selected.is_dir && (
              <div className="ml-auto flex items-center gap-1 shrink-0">
                <button onClick={copyPath} title="Copier le chemin"
                  className="flex items-center gap-1 text-[9px] px-1.5 py-0.5 rounded border border-white/10 text-accent-muted hover:text-accent-green hover:border-accent-green/40 transition-colors">
                  {copied ? <Check size={9} className="text-accent-green" /> : <Copy size={9} />} Chemin
                </button>
                <button onClick={() => computeHash()} disabled={hashing}
                  title="Calculer MD5 et SHA-256"
                  className="flex items-center gap-1 text-[9px] px-1.5 py-0.5 rounded border border-white/10 text-accent-muted hover:text-accent-green hover:border-accent-green/40 transition-colors disabled:opacity-40">
                  {hashing ? <Loader2 size={9} className="animate-spin" /> : <Hash size={9} />} Hash
                </button>
                <button onClick={download} disabled={downloading}
                  title="Télécharger le fichier"
                  className="flex items-center gap-1 text-[9px] px-1.5 py-0.5 rounded border border-white/10 text-accent-muted hover:text-accent-green hover:border-accent-green/40 transition-colors disabled:opacity-40">
                  {downloading ? <Loader2 size={9} className="animate-spin" /> : <Download size={9} />}
                  Télécharger
                </button>
                <button
                  onClick={() => extract.mutate()}
                  disabled={!caseId || extract.isPending}
                  title={caseId
                    ? 'Extraire vers le drop folder du case courant'
                    : 'Sélectionnez un case courant pour extraire'}
                  className="flex items-center gap-1 text-[9px] px-1.5 py-0.5 rounded border border-accent-green/25 text-accent-green/80 hover:bg-accent-green/10 transition-colors disabled:opacity-30">
                  {extract.isPending ? <Loader2 size={9} className="animate-spin" /> : <FileOutput size={9} />}
                  Extraire vers le case
                </button>
              </div>
            )}
          </div>

          {(hashes || extract.data || extract.isError || downloadError) && (
            <div className="px-2 py-1 border-b border-white/5 shrink-0 space-y-0.5">
              {hashes && (
                <p className="text-[9px] font-mono text-accent-muted/60">
                  MD5 <span className="text-white/70">{hashes.md5}</span>{'  '}
                  SHA-256 <span className="text-white/70">{hashes.sha256}</span>
                </p>
              )}
              {extract.data && (
                <p className="text-[9px] text-accent-green/70">
                  Extrait : {extract.data.filename} ({fmtSize(extract.data.size)}) — {extract.data.message}
                </p>
              )}
              {extract.isError && (
                <p className="text-[9px] text-severity-critical">
                  {(extract.error as any)?.response?.data?.detail ?? 'Extraction impossible.'}
                </p>
              )}
              {downloadError && (
                <p className="text-[9px] text-severity-critical">Téléchargement échoué : {downloadError}</p>
              )}
            </div>
          )}

          <div className="flex-1 overflow-auto">
            {!selected || selected.is_dir ? (
              <p className="p-3 text-[10px] text-accent-muted/30 italic">
                Sélectionnez un fichier pour afficher ses octets.
              </p>
            ) : loadingPreview ? (
              <div className="flex items-center gap-2 p-3 text-[10px] text-accent-muted/40">
                <Loader2 size={11} className="animate-spin" /> Lecture…
              </div>
            ) : preview ? (
              <HexView hex={preview.hex} />
            ) : null}
          </div>
        </div>
      </div>
    </div>
  )
}
