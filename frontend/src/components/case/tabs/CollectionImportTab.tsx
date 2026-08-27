import { useRef, useState, useCallback, useMemo } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronRight, Globe } from '../../../ui/icons'
import { collectionImportApi, type ImportedCollection, type ImportedFile, type GroupSummary } from '../../../api/collectionImport'
import { useNavigate } from 'react-router-dom'
import { TIMEZONE_OPTIONS } from '../../../context/TimezoneContext'
import DropFolderPanel from '../DropFolderPanel'

interface Props { caseId: string }

/**
 * Archive containers the backend can unpack (see backend/app/services/archives.py).
 * Two-part suffixes are listed first so `.tar.gz` matches before `.gz`.
 */
const ARCHIVE_EXTS = [
  '.tar.gz', '.tar.bz2', '.tar.xz', '.tar.zst', '.tar.lz',
  '.zip', '.jar', '.7z', '.rar', '.tar',
  '.tgz', '.tbz', '.tbz2', '.txz',
  '.gz', '.bz2', '.xz', '.zst', '.zstd',
] as const

/** The archive suffix of `name`, or null when it is not an archive. */
function archiveExt(name: string): string | null {
  const low = name.toLowerCase()
  return ARCHIVE_EXTS.find(e => low.endsWith(e)) ?? null
}

const isArchiveFile = (name: string) => archiveExt(name) !== null

// Each upload batch stays under this to avoid nginx / memory issues
const MAX_BATCH_BYTES = 200 * 1024 * 1024          // 200 MB
// Files above this threshold get a notice about browsing performance
const LARGE_FILE_BYTES = 500 * 1024 * 1024         // 500 MB

/** Split a file list into batches where each batch total ≤ MAX_BATCH_BYTES */
function makeBatches(files: File[]): File[][] {
  const batches: File[][] = []
  let current: File[] = []
  let currentSize = 0
  for (const f of files) {
    if (currentSize + f.size > MAX_BATCH_BYTES && current.length > 0) {
      batches.push(current)
      current = []
      currentSize = 0
    }
    current.push(f)
    currentSize += f.size
  }
  if (current.length > 0) batches.push(current)
  return batches
}

const STATUS_COLOR: Record<string, string> = {
  pending: 'text-severity-medium',
  processing: 'text-severity-low',
  done: 'text-accent',
  error: 'text-severity-critical',
  imported: 'text-accent',
  unsupported: 'text-fg-muted',
}

const CATEGORY_ICON: Record<string, string> = {
  'Event Logs':        '📋',
  'Artifact Explorer': '🗂',
}

/**
 * Resolve destination page for a collection group.
 * - EVTX files → /artifacts/filesystem (EVTX viewer, uses CurrentCase context)
 * - EML files  → /artifacts/email      (Email Analysis, uses CurrentCase context)
 * - Everything else → /artifacts/explorer?open=<filename>
 */
function resolveDestination(page: string | null, firstFilename?: string): string {
  if (page?.includes('/evtx'))   return '/artifacts/filesystem'
  if (page?.includes('/emails')) return '/artifacts/email'
  const base = '/artifacts/explorer'
  if (!firstFilename) return base
  return `${base}?open=${encodeURIComponent(firstFilename)}`
}

function fmt(bytes: number | null) {
  if (!bytes) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`
}

function fmtNum(n: number | null | undefined) {
  if (!n) return '0'
  return n.toLocaleString()
}

function mergeGroups(groups: GroupSummary[]): GroupSummary[] {
  const map = new Map<string, GroupSummary>()
  for (const g of groups) {
    const existing = map.get(g.label)
    if (existing) {
      existing.files.push(...g.files)
      existing.imported += g.imported
      existing.error += g.error
      existing.unsupported += g.unsupported
      existing.total_rows += g.total_rows
    } else {
      map.set(g.label, { ...g, files: [...g.files] })
    }
  }
  return Array.from(map.values())
}

function mergeSession(cols: ImportedCollection[]): ImportedCollection & { _sourceIds: string[] } {
  if (cols.length === 1) return { ...cols[0], _sourceIds: [cols[0].id] }
  const allFiles = cols.flatMap(c => c.files)
  const allGroups = mergeGroups(cols.flatMap(c => c.groups ?? []))
  const totalFiles = cols.reduce((s, c) => s + c.total_files, 0)
  const status = cols.some(c => c.status === 'processing') ? 'processing'
    : cols.some(c => c.status === 'error') ? 'error'
    : cols.every(c => c.status === 'done') ? 'done'
    : 'pending'
  const earliest = cols.reduce((min, c) => c.uploaded_at < min ? c.uploaded_at : min, cols[0].uploaded_at)
  return {
    id: cols[0].session_id ?? cols[0].id,
    case_id: cols[0].case_id,
    session_id: cols[0].session_id,
    filename: `${totalFiles} CSV files`,
    file_size: cols.reduce((s, c) => s + c.file_size, 0),
    uploaded_at: earliest,
    status,
    total_files: totalFiles,
    processed_files: cols.reduce((s, c) => s + c.processed_files, 0),
    error_message: cols.map(c => c.error_message).filter(Boolean).join('; ') || null,
    files: allFiles,
    groups: allGroups,
    _sourceIds: cols.map(c => c.id),
  }
}

function Progress({ val, total }: { val: number; total: number }) {
  const pct = total > 0 ? Math.round((val / total) * 100) : 0
  return (
    <div className="flex items-center gap-2 text-label">
      <div className="flex-1 h-1.5 bg-[#1a2332] rounded-pill overflow-hidden">
        <div className="h-full bg-accent transition-all" style={{ width: `${pct}%` }} />
      </div>
      <span className="text-fg-muted w-10 text-right">{pct}%</span>
    </div>
  )
}

function TzPicker({ f, caseId }: { f: ImportedFile; caseId: string }) {
  const [open, setOpen] = useState(false)
  const qc = useQueryClient()

  const setTz = useMutation({
    mutationFn: (tz: string | null) => collectionImportApi.setFileTimezone(caseId, f.id, tz),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['collection-imports', caseId] })
      setOpen(false)
    },
  })

  const label = f.source_timezone
    ? (TIMEZONE_OPTIONS.find(o => o.value === f.source_timezone)?.label ?? f.source_timezone)
    : 'UTC'
  const isCustom = !!f.source_timezone

  return (
    <div className="relative inline-block">
      <button
        onClick={e => { e.stopPropagation(); setOpen(v => !v) }}
        title="Source timezone for this artifact's timestamps"
        className={`flex items-center gap-1 text-label px-1.5 py-0.5 rounded-control border transition-colors ${ isCustom
            ? 'border-severity-low/40 bg-severity-low/10 text-severity-low hover:bg-severity-low/20'
            : 'border-hairline bg-white/[0.03] text-fg-muted hover:text-fg-muted hover:border-strong'
        }`}
      >
        <Globe size={9} />
        <span>{label}</span>
      </button>
      {open && (
        <div className="absolute z-50 top-full left-0 mt-1 w-48 bg-[#0d1927] border border-hairline shadow-xl text-label overflow-hidden">
          <div className="px-2 py-1.5 border-b border-hairline text-label text-fg-muted uppercase tracking-wide">
            Timezone source
          </div>
          <div className="max-h-52 overflow-y-auto">
            {/* Reset to default */}
            <button
              onClick={() => setTz.mutate(null)}
              className={`w-full text-left px-3 py-1.5 hover:bg-fg/5 ${!isCustom ? 'text-accent' : 'text-fg-muted'}`}
            >
              UTC (default)
            </button>
            {TIMEZONE_OPTIONS.filter(o => o.value !== 'UTC').map(o => (
              <button
                key={o.value}
                onClick={() => setTz.mutate(o.value)}
                className={`w-full text-left px-3 py-1.5 hover:bg-fg/5 ${f.source_timezone === o.value ? 'text-accent' : 'text-fg-muted'}`}
              >
                {o.label}
                <span className="text-fg-muted ml-1 text-label">{o.region}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function FileBadge({ f, caseId }: { f: ImportedFile; caseId: string }) {
  const color = STATUS_COLOR[f.status] ?? 'text-fg-muted'
  const showTzPicker = f.status === 'imported' && !!f.csv_artifact_id
  return (
    <tr className="border-b border-hairline hover:bg-white/[0.02] text-label">
      <td className="py-2 pl-3 pr-2 font-mono text-fg-muted max-w-[280px] truncate">
        {f.filename.split('/').pop()}
      </td>
      <td className="py-2 px-2">
        {f.category_label
          ? <span className="text-fg-muted">{f.category_label}</span>
          : <span className="text-label font-semibold px-1.5 py-0.5 rounded-control border bg-fg-muted/10 text-fg-muted border-fg-muted/20">unknown</span>}
      </td>
      <td className={`py-2 px-2 font-semibold ${color}`}>{f.status}</td>
      <td className="py-2 px-2 text-fg-muted text-right">{fmtNum(f.row_count)}</td>
      <td className="py-2 px-2">
        {showTzPicker ? <TzPicker f={f} caseId={caseId} /> : <span className="text-fg-muted">—</span>}
      </td>
      <td className="py-2 px-2 text-fg-muted text-right">{fmt(f.file_size)}</td>
      <td className="py-2 pr-3 text-fg-muted text-right">
        {f.expires_at && !f.added_to_evidence
          ? new Date(f.expires_at).toLocaleDateString()
          : f.added_to_evidence ? <span className="text-accent text-label">∞</span> : '—'}
      </td>
    </tr>
  )
}

/** Extract a short display name from a potentially long path or "N CSV files". */
function displayName(filename: string): string {
  if (!filename.includes('/')) return filename
  return filename.split('/').pop() ?? filename
}

const STATUS_BADGE: Record<string, string> = {
  done:       'text-accent border-accent/30 bg-accent/8',
  processing: 'text-severity-low border-severity-low/30 bg-severity-low/8',
  error:      'text-severity-critical border-severity-critical/30 bg-severity-critical/8',
  pending:    'text-severity-medium border-severity-medium/30 bg-severity-medium/8',
}

function CollectionCard({ cols, caseId }: { cols: ImportedCollection[]; caseId: string }) {
  const [expanded, setExpanded] = useState(true)
  const navigate = useNavigate()
  const qc = useQueryClient()

  const col = useMemo(() => mergeSession(cols), [cols])

  const del = useMutation({
    mutationFn: () => Promise.all(col._sourceIds.map(id => collectionImportApi.delete(caseId, id))),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['collection-imports', caseId] }),
  })

  const groups = col.groups ?? []
  const colArchiveExt = archiveExt(col.filename)
  const isCsv         = colArchiveExt === null

  // Summary counters
  const importedCount = col.files.filter(f => f.status === 'imported').length
  const errorCount    = col.files.filter(f => f.status === 'error').length
  const knownGroups   = groups.filter(g => g.label !== 'Unknown' && g.label !== 'Unsupported' && g.imported > 0)
  const unknownCount  = col.files.filter(f => !f.category_label && f.status === 'imported').length

  return (
    <div className="border border-hairline bg-[#0d1927] overflow-hidden">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="px-4 py-3 border-b border-hairline">
        {/* Row 1: toggle + name + status + delete */}
        <div className="flex items-center gap-2">
          <button className="text-fg-muted hover:text-fg shrink-0" onClick={() => setExpanded(v => !v)}>
            {expanded ? '▾' : '▸'}
          </button>
          <span className="text-label font-mono px-1.5 py-0.5 rounded-control border border-hairline text-fg-muted uppercase shrink-0">
            {isCsv ? 'csv' : colArchiveExt!.replace(/^\./, '')}
          </span>
          <p className="text-ui font-medium text-fg truncate flex-1 min-w-0" title={col.filename}>
            {displayName(col.filename)}
          </p>
          <span className={`text-label font-bold shrink-0 px-2 py-0.5 rounded-control border ${STATUS_BADGE[col.status] ?? STATUS_BADGE.pending}`}>
            {col.status.toUpperCase()}
          </span>
          <button
            className="text-fg-muted hover:text-severity-critical text-label ml-1 shrink-0"
            onClick={() => { if (confirm(col._sourceIds.length > 1 ? `Delete this session (${col._sourceIds.length} batches)?` : 'Delete this collection import?')) del.mutate() }}
          >✕</button>
        </div>

        {/* Row 2: meta */}
        <div className="flex items-center gap-2 mt-1 text-label text-fg-muted">
          <span>{new Date(col.uploaded_at).toLocaleString()}</span>
          <span>·</span>
          <span>{fmt(col.file_size)}</span>
          <span>·</span>
          <span className={importedCount === col.total_files ? 'text-accent/60' : ''}>
            {importedCount}/{col.total_files} imported
          </span>
          {errorCount > 0 && (
            <span className="text-severity-critical/70">{errorCount} error{errorCount > 1 ? 's' : ''}</span>
          )}
        </div>

        {/* Row 3: category chips (visible when done) */}
        {col.status === 'done' && (knownGroups.length > 0 || unknownCount > 0) && (
          <div className="flex items-center gap-1 mt-2 flex-wrap">
            {knownGroups.map(g => (
              <span key={g.label}
                className="flex items-center gap-1 text-label px-1.5 py-0.5 rounded-control bg-white/[0.03] border border-hairline text-fg-muted">
                <span className="leading-none">{CATEGORY_ICON[g.label] ?? '📁'}</span>
                <span className="text-accent/80 font-mono font-semibold">{g.imported}</span>
                <span className="text-fg-muted max-w-[90px] truncate">{g.label}</span>
                {g.total_rows > 0 && (
                  <span className="text-fg-muted font-mono">{fmtNum(g.total_rows)}</span>
                )}
              </span>
            ))}
            {unknownCount > 0 && (
              <span className="flex items-center gap-1 text-label px-1.5 py-0.5 rounded-control bg-fg-muted/5 border border-fg-muted/20 text-fg-muted">
                ?&nbsp;<span className="font-mono">{unknownCount}</span>&nbsp;unknown
              </span>
            )}
          </div>
        )}
      </div>

      {/* Progress bar when processing */}
      {col.status === 'processing' && (
        <div className="px-4 py-2 border-b border-hairline">
          <Progress val={col.processed_files} total={col.total_files} />
        </div>
      )}

      {/* Artifact group detail — collapsible, shown when expanded */}
      {expanded && col.status === 'done' && groups.length > 0 && (
        <div className="divide-y divide-hairline">
          {groups.map(g => {
            // Files in this group (join by filename)
            const groupFiles = col.files.filter(f => g.files.includes(f.filename))
            const isUnknown = g.label === 'Unknown' || g.label === 'Unsupported'
            return (
              <div key={g.label} className="px-4 py-3">
                {/* Group header */}
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-prose leading-none">{isUnknown ? '🔲' : (CATEGORY_ICON[g.label] ?? '📁')}</span>
                  <span className="text-label font-semibold text-fg">
                    {isUnknown ? 'Unsupported / Unknown' : g.label}
                  </span>
                  {g.total_rows > 0 && (
                    <span className="text-label text-accent font-mono">
                      {fmtNum(g.total_rows)} rows
                    </span>
                  )}
                  {g.error > 0 && (
                    <span className="text-label text-severity-critical">{g.error} error{g.error > 1 ? 's' : ''}</span>
                  )}
                  <div className="flex-1" />
                </div>
                {/* Per-file rows */}
                <div className="space-y-0.5 ml-6">
                  {groupFiles.map(f => {
                    const basename = f.filename.split('/').pop() ?? f.filename
                    const dest = resolveDestination(g.destination_page, basename)
                    return (
                      <div key={f.id} className="flex items-center gap-1.5 text-label group/row">
                        {/* View button — left, primary action */}
                        <button
                          onClick={() => navigate(dest)}
                          disabled={f.status !== 'imported'}
                          title={f.status === 'imported' ? 'Open in the Artifact Explorer' : 'Not imported yet'}
                          className="flex items-center gap-0.5 text-accent/60 hover:text-accent disabled:text-fg-muted disabled:cursor-default transition-colors shrink-0"
                        >
                          <ChevronRight size={12} />
                        </button>

                        {/* Status dot */}
                        <span className={
                          f.status === 'imported' ? 'text-accent' :
                          f.status === 'error'    ? 'text-severity-critical' :
                          f.status === 'pending'  ? 'text-severity-medium' : 'text-fg-muted'
                        }>
                          {f.status === 'imported' ? '✓' : f.status === 'error' ? '✗' : f.status === 'pending' ? '◌' : '—'}
                        </span>

                        {/* Filename + Unknown badge */}
                        <span className="font-mono text-fg-muted truncate flex-1 min-w-0">{basename}</span>
                        {!f.category_label && (
                          <span className="shrink-0 text-label font-semibold px-1.5 py-0.5 rounded-control border bg-fg-muted/10 text-fg-muted border-fg-muted/20">
                            unknown
                          </span>
                        )}

                        {/* Error */}
                        {f.status === 'error' && f.error_message && (
                          <span className="shrink-0 text-severity-critical/70 truncate max-w-[120px]" title={f.error_message}>
                            {f.error_message.slice(0, 35)}…
                          </span>
                        )}

                        {/* Row count — right */}
                        {f.row_count != null && f.row_count > 0 && (
                          <span className="shrink-0 text-fg-muted tabular-nums ml-auto pl-2">{fmtNum(f.row_count)} rows</span>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* File detail table — raw view inside expanded card */}
      {expanded && (
        <div className="overflow-x-auto">
          <table className="w-full text-label">
            <thead>
              <tr className="border-b border-hairline text-fg-muted uppercase tracking-wide text-label">
                <th className="py-2 pl-3 pr-2 text-left">File</th>
                <th className="py-2 px-2 text-left">Category</th>
                <th className="py-2 px-2 text-left">Status</th>
                <th className="py-2 px-2 text-right">Rows</th>
                <th className="py-2 px-2 text-left">Timezone</th>
                <th className="py-2 px-2 text-right">Size</th>
                <th className="py-2 pr-3 text-right">Expires</th>
              </tr>
            </thead>
            <tbody>
              {col.files.map(f => <FileBadge key={f.id} f={f} caseId={caseId} />)}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ── Drop zone ─────────────────────────────────────────────────────────────────

function DropZone({ onFiles }: { onFiles: (files: File[]) => void }) {
  const [dragging, setDragging] = useState(false)

  const validate = (files: File[]): string | null => {
    const archives = files.filter(f => isArchiveFile(f.name))
    if (archives.length > 0 && archives.length !== files.length)
      return 'Cannot mix an archive with other files in the same upload'
    if (archives.length > 1) return 'Une seule archive par upload'
    for (const f of files) {
      if (isArchiveFile(f.name)) continue
      if (f.name.split('.').pop()?.toLowerCase() !== 'csv')
        return `Unsupported file type: ${f.name}`
    }
    return null
  }

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragging(false)
    const files = Array.from(e.dataTransfer.files)
    const err = validate(files)
    if (err) { alert(err); return }
    onFiles(files)
  }, [onFiles])

  return (
    <div
      className={`border-2 border-dashed p-10 text-center transition-colors ${
        dragging
          ? 'border-accent/60 bg-accent/5'
          : 'border-hairline hover:border-strong'
      }`}
      onDragOver={e => { e.preventDefault(); setDragging(true) }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
    >
      <p className="text-title mb-2">📂</p>
      <p className="text-fg-muted text-ui">Drop files here</p>
      <p className="text-fg-muted text-label mt-1">
        Archive (ZIP, 7z, RAR, TAR…) <span className="text-fg-muted mx-1">ou</span> un ou plusieurs fichiers CSV
      </p>
    </div>
  )
}

// ── Main tab ──────────────────────────────────────────────────────────────────

export default function CollectionImportTab({ caseId }: Props) {
  const archiveRef = useRef<HTMLInputElement>(null)
  const csvRef = useRef<HTMLInputElement>(null)
  const folderRef = useRef<HTMLInputElement>(null)
  const [uploadState, setUploadState] = useState<{
    total: number; done: number; skipped: string[]
  } | null>(null)
  const qc = useQueryClient()

  const { data: collections = [], isLoading } = useQuery({
    queryKey: ['collection-imports', caseId],
    queryFn: () => collectionImportApi.list(caseId),
    refetchInterval: (q) => {
      const data = q.state.data as ImportedCollection[] | undefined
      if (!data) return 3000
      return data.some(c => c.status === 'processing') ? 2000 : false
    },
  })

  // Group collections by session_id — each null session_id is its own group (legacy)
  const sessions = useMemo(() => {
    const map = new Map<string, ImportedCollection[]>()
    for (const col of collections) {
      const key = col.session_id ?? col.id
      const list = map.get(key) ?? []
      list.push(col)
      map.set(key, list)
    }
    return Array.from(map.values()).sort((a, b) =>
      new Date(b[0].uploaded_at).getTime() - new Date(a[0].uploaded_at).getTime()
    )
  }, [collections])

  const upload = useMutation({
    mutationFn: (files: File[]) => collectionImportApi.upload(caseId, files),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['collection-imports', caseId] }),
  })

  /** Upload a list of files, automatically split into ≤200 MB batches, all under one session */
  async function uploadBatched(files: File[]) {
    const sessionId = crypto.randomUUID()
    const batches = makeBatches(files)
    setUploadState(s => ({ total: batches.length, done: 0, skipped: s?.skipped ?? [] }))
    for (const batch of batches) {
      await collectionImportApi.upload(caseId, batch, sessionId)
      setUploadState(s => s ? { ...s, done: s.done + 1 } : null)
    }
    qc.invalidateQueries({ queryKey: ['collection-imports', caseId] })
    setTimeout(() => setUploadState(null), 4000)
  }

  function filterAndUpload(all: File[]) {
    const csvFiles = all.filter(f => f.name.toLowerCase().endsWith('.csv'))
    const large = csvFiles
      .filter(f => f.size > LARGE_FILE_BYTES)
      .map(f => `${f.name} (${(f.size / 1024 / 1024).toFixed(0)} MB)`)

    if (csvFiles.length === 0) {
      alert('No CSV files found in the selection.')
      return
    }
    // Upload ALL CSV files — large ones will be importable via Artifact Explorer
    setUploadState({ total: 0, done: 0, skipped: large })
    uploadBatched(csvFiles)
  }

  function handleArchiveChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? [])
    if (files.length) upload.mutate(files)
    e.target.value = ''
  }

  function handleCsvChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? [])
    e.target.value = ''
    filterAndUpload(files)
  }

  function handleFolderChange(e: React.ChangeEvent<HTMLInputElement>) {
    const all = Array.from(e.target.files ?? [])
    e.target.value = ''
    filterAndUpload(all)
  }

  const busy = upload.isPending || (uploadState !== null && uploadState.done < uploadState.total)

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-accent font-semibold text-ui uppercase tracking-wide">
            Artifact Collections
          </h3>
          <p className="text-label text-fg-muted mt-0.5">
            EZ Tools / KAPE import - an archive (ZIP, 7z, RAR, TAR...), individual CSVs, or a whole folder (recursive)
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {/* Folder */}
          <button
            className="btn-secondary text-label flex items-center gap-1.5"
            onClick={() => folderRef.current?.click()}
            disabled={busy}
            title="Select a KAPE output folder — all CSV files imported recursively. Files >300 MB are skipped (use their dedicated page)."
          >
            {busy && uploadState && uploadState.total > 0 ? (
              <>
                <span className="inline-block w-3 h-3 border-2 border-strong border-t-strong rounded-pill animate-spin" />
                Batch {uploadState.done + 1}/{uploadState.total}…
              </>
            ) : busy ? (
              <>
                <span className="inline-block w-3 h-3 border-2 border-strong border-t-strong rounded-pill animate-spin" />
                Scanning…
              </>
            ) : '📁 Import Folder'}
          </button>
          {/* CSV(s) */}
          <button
            className="btn-secondary text-label flex items-center gap-1.5"
            onClick={() => csvRef.current?.click()}
            disabled={busy}
            title="Pick one or more CSV files individually"
          >
            📄 CSV(s)
          </button>
          {/* Archive */}
          <button
            className="btn-primary text-label flex items-center gap-1.5"
            onClick={() => archiveRef.current?.click()}
            disabled={busy}
            title="Import an archive - ZIP, 7z, RAR, TAR/TGZ/TAR.XZ... (KAPE triage, EZ Tools output)"
          >
            {upload.isPending ? (
              <>
                <span className="inline-block w-3 h-3 border-2 border-strong border-t-strong rounded-pill animate-spin" />
                Uploading…
              </>
            ) : '🗜 Archive'}
          </button>

          <input
            ref={archiveRef}
            type="file"
            accept={ARCHIVE_EXTS.join(',')}
            className="hidden"
            onChange={handleArchiveChange}
          />
          <input ref={csvRef}    type="file" accept=".csv" className="hidden" multiple onChange={handleCsvChange} />
          {/* webkitdirectory allows recursive folder selection */}
          <input
            ref={folderRef}
            type="file"
            className="hidden"
            // @ts-expect-error — webkitdirectory is non-standard but supported in all modern browsers
            webkitdirectory=""
            multiple
            onChange={handleFolderChange}
          />
        </div>
      </div>

      {/* Skipped files notice */}
      {uploadState && uploadState.skipped.length > 0 && (
        <div className="rounded-control border border-severity-medium/30 bg-severity-medium/5 px-3 py-2 text-label text-severity-medium">
          <p className="font-semibold mb-1">
            {uploadState.skipped.length} large file{uploadState.skipped.length > 1 ? 's' : ''} (
            &gt;500 MB) - imported into the Artifact Explorer,
            browsing may be slow. For best performance, use their dedicated pages (Logs, MFT/USN...).
          </p>
          <ul className="space-y-0.5 text-severity-medium/80 font-mono">
            {uploadState.skipped.map(s => <li key={s}>· {s}</li>)}
          </ul>
        </div>
      )}

      {/* Drop folder — ingestion without going through the browser */}
      <DropFolderPanel caseId={caseId} />

      {/* Supported tools legend */}
      <div className="flex flex-wrap gap-2 text-label text-fg-muted items-center">
        <span className="text-fg-muted">EZ Tools:</span>
        {[
          'EvtxECmd', 'LECmd', 'JLECmd', 'SBECmd', 'RBCmd',
          'MFTECmd', 'AppCompatCacheParser', 'AmcacheParser',
          'SrumECmd', 'WxTCmd', 'RECmd',
        ].map(t => (
          <span key={t} className="px-1.5 py-0.5 rounded-control bg-[#0d1927] border border-hairline font-mono text-fg-muted">
            {t}
          </span>
        ))}
      </div>

      {/* Collections list or empty drop zone */}
      {isLoading ? (
        <p className="text-fg-muted text-ui">Loading…</p>
      ) : sessions.length === 0 ? (
        <DropZone onFiles={files => upload.mutate(files)} />
      ) : (
        <>
          <div className="space-y-3">
            {sessions.map(sessionCols => (
              <CollectionCard
                key={sessionCols[0].session_id ?? sessionCols[0].id}
                cols={sessionCols}
                caseId={caseId}
              />
            ))}
          </div>
          {/* Drop zone below existing collections */}
          <DropZone onFiles={files => upload.mutate(files)} />
        </>
      )}

      {/* Retention notice */}
      <p className="text-label text-fg-muted italic border-t border-hairline pt-3">
        Files not linked to an evidence entry are automatically purged after 90 days.
        Files added to the chain of custody are kept indefinitely.
      </p>
    </div>
  )
}
