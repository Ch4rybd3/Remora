/**
 * Disk Image Explorer — FTK Imager-style browsing of forensic images.
 *
 * Layout mirrors FTK Imager: the evidence tree on the left, the current
 * directory's contents top-right, and the selected file's bytes bottom-right.
 */
import { useState, useMemo, useCallback } from 'react'
import { DataTable } from '../ui/DataTable'
import { useQuery, useMutation } from '@tanstack/react-query'
import {
  HardDrive, ChevronRight, Folder, FolderOpen, File as FileIcon, Loader2,
  AlertCircle, Download, Hash, FileOutput, Check, Copy, Layers, HelpCircle,
} from '../ui/icons'
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

// ── Transfer tips ─────────────────────────────────────────────────────────────
// A fresh instance shows an empty explorer with no clue how images get there.
// This panel spells it out with commands already filled in for this server.

function CopyableCommand({ label, command, hint }: {
  label:   string
  command: string
  hint?:   string
}) {
  const [copied, setCopied] = useState(false)
  const copy = () => {
    navigator.clipboard.writeText(command)
    setCopied(true); setTimeout(() => setCopied(false), 1500)
  }
  return (
    <div>
      <p className="text-label text-fg-secondary/60 mb-1">{label}</p>
      <div className="flex items-start gap-2 rounded-control border border-hairline bg-black/30 px-2 py-1.5">
        <code className="flex-1 min-w-0 text-label font-mono text-accent/80 break-all whitespace-pre-wrap">
          {command}
        </code>
        <button onClick={copy} title="Copy the command"
          className="shrink-0 text-fg-secondary/40 hover:text-accent transition-colors">
          {copied ? <Check size={11} className="text-accent" /> : <Copy size={11} />}
        </button>
      </div>
      {hint && <p className="text-label text-fg-secondary/35 mt-1 leading-relaxed">{hint}</p>}
    </div>
  )
}

function TransferTips({ hostPath, configured }: { hostPath: string; configured: boolean }) {
  // The host the analyst reached this UI on is, in practice, the host holding
  // the images — a far better default than a placeholder.
  const host = typeof window !== 'undefined' ? window.location.hostname : 'serveur'
  const user = '<user>'

  // A relative DISK_IMAGES_HOST_PATH (the "./images" default) is meaningless as
  // an scp/rsync destination — it would resolve against the SSH home directory
  // and copy to the wrong place without any error. Substitute a placeholder and
  // say so, rather than handing out a command that silently misfires.
  const isAbsolute = hostPath.startsWith('/')
  const target = isAbsolute ? hostPath.replace(/\/$/, '') : '/absolute/path/to/images'

  return (
    <div className="space-y-3">
      <p className="text-label text-fg-secondary/50 leading-relaxed">
        Images are read <strong className="text-fg-secondary/80">in place</strong>, never
        uploaded: a full acquisition routinely runs to several hundred GB. Copy them to{' '}
        <code className="font-mono text-accent/70">{target}</code> on{' '}
        <code className="font-mono text-accent/70">{host}</code> and they will appear here.
      </p>

      {!isAbsolute && (
        <p className="flex items-start gap-1.5 text-label text-severity-medium/80 bg-severity-medium/5 border border-severity-medium/20 rounded-control px-2 py-1.5 leading-relaxed">
          <AlertCircle size={11} className="mt-0.5 shrink-0" />
          <span>
            <code className="font-mono">DISK_IMAGES_HOST_PATH</code> is{' '}
            <code className="font-mono">{hostPath || '(empty)'}</code>, a path relative to the
            directory holding <code className="font-mono">docker-compose.yml</code>. The commands
            below need an absolute path: replace{' '}
            <code className="font-mono">{target}</code> with the real one, or make the variable
            absolute in <code className="font-mono">.env</code>.
          </span>
        </p>
      )}

      <CopyableCommand
        label="Copy an image from your machine"
        command={`rsync -avP --partial my-image.E01 ${user}@${host}:${target}/`}
        hint="-P shows progress and --partial resumes an interrupted transfer - essential on an image tens of GB in size."
      />

      <CopyableCommand
        label="Segmented set (.E01, .E02, ...)"
        command={`rsync -avP --partial my-image.E0* ${user}@${host}:${target}/`}
        hint="Copy the whole series: dissect resolves the following segments from the first one."
      />

      <CopyableCommand
        label="Mount the folder as a local drive"
        command={`sshfs ${user}@${host}:${target} ~/remora-images`}
        hint="For drag-and-drop from your file manager instead of pushing files. Unmount with: fusermount -u ~/remora-images"
      />

      {!configured && (
        <CopyableCommand
          label="Server side - once only, before starting the stack"
          command={[
            'sudo mkdir -p /mnt/evidence',
            'sudo chown $USER:$USER /mnt/evidence',
            '# then in .env:  DISK_IMAGES_HOST_PATH=/mnt/evidence',
            'docker compose up -d',
          ].join('\n')}
          hint="Create the directory before the first start: otherwise Docker creates it as root and you will not be able to put anything in it."
        />
      )}

      <p className="text-label text-fg-secondary/35 leading-relaxed border-t border-hairline pt-2">
        The directory is mounted read-only: Remora can neither modify nor delete an
        acquisition. It lives on the host and survives restarts and container rebuilds alike.
        If it is a dedicated disk or network share, remember to add it to{' '}
        <code className="font-mono">/etc/fstab</code> - otherwise the directory will be empty
        after a reboot and no image will appear.
      </p>
    </div>
  )
}

// ── Hex viewer ────────────────────────────────────────────────────────────────

function HexView({ hex }: { hex: string }) {
  const bytes = useMemo(() => {
    const out: number[] = []
    for (let i = 0; i + 1 < hex.length; i += 2) out.push(parseInt(hex.slice(i, i + 2), 16))
    return out
  }, [hex])

  if (bytes.length === 0) {
    return <p className="p-3 text-label text-fg-secondary/30 italic">Empty file.</p>
  }

  const rows: number[][] = []
  for (let i = 0; i < bytes.length; i += 16) rows.push(bytes.slice(i, i + 16))

  return (
    <div className="p-2 font-mono text-label leading-[1.45]">
      {rows.map((row, r) => (
        <div key={r} className="flex gap-3 whitespace-pre">
          <span className="text-fg-secondary/30 shrink-0">
            {(r * 16).toString(16).padStart(8, '0')}
          </span>
          <span className="text-fg/60 shrink-0">
            {row.map((b, i) => b.toString(16).padStart(2, '0') + (i === 7 ? '  ' : ' ')).join('')}
            {row.length < 16 && ' '.repeat((16 - row.length) * 3 + (row.length <= 8 ? 1 : 0))}
          </span>
          <span className="text-fg/45 shrink-0">
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
        className={`flex items-center gap-1 px-1 py-[3px] text-label cursor-pointer transition-colors ${ isCurrent ? 'bg-accent/10 text-accent' : 'text-fg/70 hover:bg-fg/5'
        }`}
        style={{ paddingLeft: 4 + depth * 11 }}
      >
        <ChevronRight size={9}
          className={`shrink-0 text-fg-secondary/40 transition-transform ${open ? 'rotate-90' : ''}`} />
        {open ? <FolderOpen size={10} className="shrink-0 text-accent/60" />
              : <Folder size={10} className="shrink-0 text-fg-secondary/50" />}
        <span className="truncate font-mono">{name}</span>
        {isFetching && <Loader2 size={8} className="animate-spin text-fg-secondary/40 shrink-0" />}
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
  const [tipsOpen,    setTipsOpen]    = useState(false)

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
        <div className="flex items-center gap-2 text-ui text-severity-medium bg-severity-medium/5 border border-severity-medium/20 px-4 py-3">
          <AlertCircle size={14} />
          dissect.target is not installed in the backend image - image exploration is disabled.
        </div>
      </div>
    )
  }

  if (status && !status.configured) {
    return (
      <div className="p-6 max-w-3xl space-y-4">
        <div className="flex items-start gap-2 text-ui text-severity-medium bg-severity-medium/5 border border-severity-medium/20 px-4 py-3">
          <AlertCircle size={14} className="mt-0.5 shrink-0" />
          <div>
            <p className="font-semibold">No image directory configured</p>
            <p className="text-label text-severity-medium/70 mt-1 leading-relaxed">
              Renseignez <code className="font-mono">DISK_IMAGES_HOST_PATH</code> dans le{' '}
              <code className="font-mono">.env</code>, then restart the stack.
            </p>
          </div>
        </div>
        <div className=" border border-hairline bg-panel p-4">
          <TransferTips hostPath={status.host_path} configured={false} />
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full overflow-hidden">
      {/* ── Evidence tree ────────────────────────────────────────────────── */}
      <div className="w-72 shrink-0 border-r border-hairline bg-panel flex flex-col overflow-hidden">
        <div className="px-3 py-3 flex items-center gap-1.5 border-b border-hairline">
          <p className="text-label font-semibold uppercase tracking-widest text-fg-secondary/50 flex items-center gap-1.5">
            <HardDrive size={11} /> Images
          </p>
          {images.length > 0 && <span className="text-fg-secondary/30 text-label">{images.length}</span>}
          <button
            onClick={() => setTipsOpen(o => !o)}
            title="How to put an image on the server"
            className={`ml-auto transition-colors ${ tipsOpen ? 'text-accent' : 'text-fg-secondary/30 hover:text-accent'
            }`}
          >
            <HelpCircle size={12} />
          </button>
        </div>

        {tipsOpen && (
          <div className="px-3 py-3 border-b border-hairline bg-black/20 max-h-[60vh] overflow-y-auto">
            <TransferTips hostPath={status?.host_path ?? ''} configured />
          </div>
        )}

        <div className="flex-1 overflow-y-auto">
          {loadingImages && (
            <div className="flex items-center gap-2 px-3 py-3 text-label text-fg-secondary/40">
              <Loader2 size={10} className="animate-spin" /> Scanning the directory...
            </div>
          )}
          {!loadingImages && images.length === 0 && (
            <div className="px-3 py-6 text-center">
              <p className="text-label text-fg-secondary/30 leading-relaxed">
                No image found in{' '}
                <code className="font-mono">{status?.host_path || status?.roots.join(', ') || '—'}</code>.
              </p>
              <button onClick={() => setTipsOpen(true)}
                className="mt-2 text-label text-accent/70 hover:text-accent underline">
                How do I add one?
              </button>
            </div>
          )}

          {images.map(img => (
            <div key={img.path}>
              <div
                onClick={() => selectImage(img)}
                className={`px-2 py-1.5 cursor-pointer border-b border-strong/[0.03] transition-colors ${ image === img.path ? 'bg-accent/5' : 'hover:bg-white/[0.02]'
                }`}
              >
                <div className="flex items-center gap-1.5">
                  <HardDrive size={10} className="shrink-0 text-accent/60" />
                  <span className="text-label font-mono text-fg/80 truncate">{img.name}</span>
                </div>
                <p className="text-label text-fg-secondary/35 mt-0.5 pl-[18px]">
                  {img.format.toUpperCase()} · {fmtSize(img.size)}
                </p>
              </div>

              {image === img.path && (
                <div className="border-b border-strong/[0.03]">
                  {loadingParts && (
                    <div className="flex items-center gap-2 px-4 py-2 text-label text-fg-secondary/40">
                      <Loader2 size={9} className="animate-spin" /> Ouverture…
                    </div>
                  )}
                  {partError && (
                    <p className="px-4 py-2 text-label text-severity-critical">
                      {(partError as any)?.response?.data?.detail ?? 'Ouverture impossible.'}
                    </p>
                  )}
                  {partitions.map(p => (
                    <div key={p.number}>
                      <div
                        onClick={() => p.browsable && selectPartition(p)}
                        title={p.browsable ? undefined : 'Unrecognised filesystem'}
                        className={`flex items-center gap-1.5 px-4 py-1.5 text-label transition-colors ${ !p.browsable ? 'text-fg-secondary/25 cursor-not-allowed'
                          : partition === p.number ? 'bg-accent/10 text-accent cursor-pointer'
                          : 'text-fg/65 hover:bg-fg/5 cursor-pointer'
                        }`}
                      >
                        <Layers size={9} className="shrink-0" />
                        <span className="font-mono truncate">
                          Partition {p.number}
                          {p.fs_type && <span className="text-fg-secondary/40"> · {p.fs_type}</span>}
                          {p.label && <span className="text-fg-secondary/40"> · {p.label}</span>}
                        </span>
                        <span className="ml-auto text-fg-secondary/25 shrink-0">{fmtSize(p.size)}</span>
                      </div>

                      {partition === p.number && p.browsable && (
                        <div className="border-t border-strong/[0.03] py-1">
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
        <div className="flex items-center gap-2 px-3 py-2 border-b border-hairline shrink-0">
          <code className="text-label font-mono text-fg-secondary/60 truncate flex-1">
            {image ? `${image.split('/').pop()} › partition ${partition ?? '—'} › ${dir}` : 'Select an image'}
          </code>
          {loadingDir && <Loader2 size={11} className="animate-spin text-accent/50" />}
          {entries.length > 0 && (
            <span className="text-label text-fg-secondary/35 shrink-0">{entries.length} entries</span>
          )}
        </div>

        {/* Contents */}
        <div className="flex-1 min-h-0 overflow-auto">
          {partition === null ? (
            <p className="p-6 text-center text-label text-fg-secondary/30">
              Choisissez une image puis une partition pour explorer son contenu.
            </p>
          ) : dirError ? (
            <p className="p-6 text-center text-label text-severity-critical">
              {(dirError as any)?.response?.data?.detail ?? 'Cannot read the directory.'}
            </p>
          ) : (
            <>
            {/* The parent directory is navigation, not an entry in the listing,
                so it sits above the table rather than pretending to be a row. */}
            {dir !== '/' && (
              <button
                onClick={() => navigate(dir.split('/').slice(0, -1).join('/') || '/')}
                className="w-full text-left px-2 py-1 font-mono text-label text-fg-muted
                           border-b border-hairline hover:bg-hover transition-colors"
              >
                ../
              </button>
            )}
            <DataTable
              density="compact"
              rows={entries}
              rowKey={(e) => e.path}
              empty="Empty directory."
              onRowClick={(e) => (e.is_dir ? navigate(e.path) : setSelected(e))}
              isRowSelected={(e) => selected?.path === e.path}
              columns={[
                {
                  key: 'name',
                  header: 'Name',
                  render: (e) => (
                    <span className="flex items-center gap-1.5">
                      {e.is_dir
                        ? <Folder size={10} className="shrink-0 text-fg-muted" />
                        : <FileIcon size={10} className="shrink-0 text-fg-muted" />}
                      <span className={
                        e.error ? 'text-severity-critical'
                        : isMetadata(e.name) ? 'text-data-2'
                        : e.is_dir ? 'text-fg' : 'text-fg-secondary'
                      }>{e.name}</span>
                      {e.error && (
                        <span className="text-label text-severity-critical" title={e.error}>unreadable</span>
                      )}
                    </span>
                  ),
                },
                { key: 'size',  header: 'Size',     width: 'w-24', align: 'right', mono: true,
                  render: (e) => <span className="text-fg-muted">{e.is_dir ? '' : fmtSize(e.size)}</span> },
                { key: 'mtime', header: 'Modified', width: 'w-40', mono: true, hideBelow: 'md',
                  render: (e) => <span className="text-fg-muted">{fmtDate(e.mtime)}</span> },
                { key: 'btime', header: 'Created',  width: 'w-40', mono: true, hideBelow: 'lg',
                  render: (e) => <span className="text-fg-muted">{fmtDate(e.btime)}</span> },
              ]}
            />
            </>
          )}
        </div>

        {/* File preview */}
        <div className="h-64 shrink-0 border-t border-hairline flex flex-col overflow-hidden">
          <div className="flex items-center gap-2 px-2 py-1 border-b border-hairline shrink-0">
            <p className="text-label uppercase tracking-widest text-fg-secondary/35 truncate">
              {selected && !selected.is_dir
                ? `${selected.name} — ${fmtSize(selected.size)}${preview && preview.total > preview.length ? ` (${fmtSize(preview.length)} shown)` : ''}`
                : 'Preview'}
            </p>
            {selected && !selected.is_dir && (
              <div className="ml-auto flex items-center gap-1 shrink-0">
                <button onClick={copyPath} title="Copy the path"
                  className="flex items-center gap-1 text-label px-1.5 py-0.5 rounded-control border border-hairline text-fg-secondary hover:text-accent hover:border-accent/40 transition-colors">
                  {copied ? <Check size={9} className="text-accent" /> : <Copy size={9} />} Chemin
                </button>
                <button onClick={() => computeHash()} disabled={hashing}
                  title="Calculer MD5 et SHA-256"
                  className="flex items-center gap-1 text-label px-1.5 py-0.5 rounded-control border border-hairline text-fg-secondary hover:text-accent hover:border-accent/40 transition-colors disabled:opacity-40">
                  {hashing ? <Loader2 size={9} className="animate-spin" /> : <Hash size={9} />} Hash
                </button>
                <button onClick={download} disabled={downloading}
                  title="Download the file"
                  className="flex items-center gap-1 text-label px-1.5 py-0.5 rounded-control border border-hairline text-fg-secondary hover:text-accent hover:border-accent/40 transition-colors disabled:opacity-40">
                  {downloading ? <Loader2 size={9} className="animate-spin" /> : <Download size={9} />}
                  Download
                </button>
                <button
                  onClick={() => extract.mutate()}
                  disabled={!caseId || extract.isPending}
                  title={caseId
                    ? 'Extraire vers le drop folder du case courant'
                    : 'Select a current case to extract into'}
                  className="flex items-center gap-1 text-label px-1.5 py-0.5 rounded-control border border-accent/25 text-accent/80 hover:bg-accent/10 transition-colors disabled:opacity-30">
                  {extract.isPending ? <Loader2 size={9} className="animate-spin" /> : <FileOutput size={9} />}
                  Extraire vers le case
                </button>
              </div>
            )}
          </div>

          {(hashes || extract.data || extract.isError || downloadError) && (
            <div className="px-2 py-1 border-b border-hairline shrink-0 space-y-0.5">
              {hashes && (
                <p className="text-label font-mono text-fg-secondary/60">
                  MD5 <span className="text-fg/70">{hashes.md5}</span>{'  '}
                  SHA-256 <span className="text-fg/70">{hashes.sha256}</span>
                </p>
              )}
              {extract.data && (
                <p className="text-label text-accent/70">
                  Extrait : {extract.data.filename} ({fmtSize(extract.data.size)}) — {extract.data.message}
                </p>
              )}
              {extract.isError && (
                <p className="text-label text-severity-critical">
                  {(extract.error as any)?.response?.data?.detail ?? 'Extraction impossible.'}
                </p>
              )}
              {downloadError && (
                <p className="text-label text-severity-critical">Download failed: {downloadError}</p>
              )}
            </div>
          )}

          <div className="flex-1 overflow-auto">
            {!selected || selected.is_dir ? (
              <p className="p-3 text-label text-fg-secondary/30 italic">
                Select a file to display its bytes.
              </p>
            ) : loadingPreview ? (
              <div className="flex items-center gap-2 p-3 text-label text-fg-secondary/40">
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
