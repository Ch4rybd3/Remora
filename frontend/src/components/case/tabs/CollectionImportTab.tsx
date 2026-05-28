import { useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { collectionImportApi, type ImportedCollection, type ImportedFile } from '../../../api/collectionImport'
import { useNavigate } from 'react-router-dom'

interface Props { caseId: string }

const STATUS_COLOR: Record<string, string> = {
  pending: 'text-yellow-400',
  processing: 'text-blue-400',
  done: 'text-accent-green',
  error: 'text-red-400',
  imported: 'text-accent-green',
  unsupported: 'text-gray-500',
}

const CATEGORY_ICON: Record<string, string> = {
  'Execution Artifacts': '⚡',
  'User Activity': '👤',
  'Event Logs': '📋',
  'Filesystem': '💾',
  'SRUM': '📊',
  'Registry Analysis': '🗂️',
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

function Progress({ val, total }: { val: number; total: number }) {
  const pct = total > 0 ? Math.round((val / total) * 100) : 0
  return (
    <div className="flex items-center gap-2 text-xs">
      <div className="flex-1 h-1.5 bg-[#1a2332] rounded-full overflow-hidden">
        <div
          className="h-full bg-accent-green transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-gray-400 w-10 text-right">{pct}%</span>
    </div>
  )
}

function FileBadge({ f }: { f: ImportedFile }) {
  const color = STATUS_COLOR[f.status] ?? 'text-gray-400'
  return (
    <tr className="border-b border-white/5 hover:bg-white/[0.02] text-xs">
      <td className="py-2 pl-3 pr-2 font-mono text-gray-400 max-w-[280px] truncate">
        {f.filename.split('/').pop()}
      </td>
      <td className="py-2 px-2">
        {f.category_label
          ? <span className="text-gray-300">{f.category_label}</span>
          : <span className="text-gray-600 italic">unsupported</span>}
      </td>
      <td className={`py-2 px-2 font-semibold ${color}`}>{f.status}</td>
      <td className="py-2 px-2 text-gray-400 text-right">{fmtNum(f.row_count)}</td>
      <td className="py-2 px-2 text-gray-400 text-right">{fmt(f.file_size)}</td>
      <td className="py-2 pr-3 text-gray-500 text-right">
        {f.expires_at && !f.added_to_evidence
          ? new Date(f.expires_at).toLocaleDateString()
          : f.added_to_evidence ? <span className="text-accent-green text-xs">∞</span> : '—'}
      </td>
    </tr>
  )
}

function CollectionCard({ col, caseId }: { col: ImportedCollection; caseId: string }) {
  const [expanded, setExpanded] = useState(false)
  const navigate = useNavigate()
  const qc = useQueryClient()

  const del = useMutation({
    mutationFn: () => collectionImportApi.delete(caseId, col.id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['collection-imports', caseId] }),
  })

  const groups = col.groups ?? []

  return (
    <div className="border border-white/10 rounded-lg bg-[#0d1927] overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-white/10">
        <button
          className="text-gray-400 hover:text-white text-xs w-4"
          onClick={() => setExpanded(v => !v)}
        >
          {expanded ? '▾' : '▸'}
        </button>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-white truncate">{col.filename}</p>
          <p className="text-xs text-gray-500 mt-0.5">
            {new Date(col.uploaded_at).toLocaleString()} · {fmt(col.file_size)} · {col.total_files} files
          </p>
        </div>
        <span className={`text-xs font-semibold ${STATUS_COLOR[col.status]}`}>
          {col.status.toUpperCase()}
        </span>
        <button
          className="text-gray-600 hover:text-red-400 text-xs ml-2"
          onClick={() => { if (confirm('Delete this collection import?')) del.mutate() }}
        >
          ✕
        </button>
      </div>

      {/* Progress bar when processing */}
      {col.status === 'processing' && (
        <div className="px-4 py-2 border-b border-white/5">
          <Progress val={col.processed_files} total={col.total_files} />
        </div>
      )}

      {/* Group summary cards */}
      {col.status === 'done' && groups.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 p-3">
          {groups.map(g => (
            <button
              key={g.label}
              className="text-left p-3 rounded border border-white/10 bg-[#111e2e] hover:border-accent-green/40 transition-colors"
              onClick={() => g.destination_page && navigate(g.destination_page)}
            >
              <div className="flex items-center gap-1.5 mb-1">
                <span>{CATEGORY_ICON[g.label] ?? '📁'}</span>
                <span className="text-xs font-semibold text-white truncate">{g.label}</span>
              </div>
              <p className="text-xs text-accent-green">{fmtNum(g.total_rows)} rows</p>
              <p className="text-xs text-gray-500 mt-0.5">
                {g.imported} imported
                {g.error > 0 && <span className="text-red-400 ml-1">{g.error} err</span>}
                {g.unsupported > 0 && <span className="text-gray-600 ml-1">{g.unsupported} unsupported</span>}
              </p>
            </button>
          ))}
        </div>
      )}

      {/* File detail table */}
      {expanded && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-white/10 text-gray-500 uppercase tracking-wide text-[10px]">
                <th className="py-2 pl-3 pr-2 text-left">File</th>
                <th className="py-2 px-2 text-left">Category</th>
                <th className="py-2 px-2 text-left">Status</th>
                <th className="py-2 px-2 text-right">Rows</th>
                <th className="py-2 px-2 text-right">Size</th>
                <th className="py-2 pr-3 text-right">Expires</th>
              </tr>
            </thead>
            <tbody>
              {col.files.map(f => <FileBadge key={f.id} f={f} />)}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

export default function CollectionImportTab({ caseId }: Props) {
  const fileRef = useRef<HTMLInputElement>(null)
  const qc = useQueryClient()

  const { data: collections = [], isLoading } = useQuery({
    queryKey: ['collection-imports', caseId],
    queryFn: () => collectionImportApi.list(caseId),
    refetchInterval: (q) => {
      const data = q.state.data as ImportedCollection[] | undefined
      if (!data) return 3000
      const hasProcessing = data.some(c => c.status === 'processing')
      return hasProcessing ? 2000 : false
    },
  })

  const upload = useMutation({
    mutationFn: (file: File) => collectionImportApi.upload(caseId, file),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['collection-imports', caseId] }),
  })

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) upload.mutate(file)
    e.target.value = ''
  }

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-accent-green font-semibold text-sm uppercase tracking-wide">
            Artifact Collections
          </h3>
          <p className="text-xs text-gray-500 mt-0.5">
            Import EZ Tools / KAPE parsed output ZIPs — files are auto-detected and routed to the correct analysis page
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500 italic">ZIP only</span>
          <button
            className="btn-primary text-xs flex items-center gap-1.5"
            onClick={() => fileRef.current?.click()}
            disabled={upload.isPending}
          >
            {upload.isPending ? (
              <>
                <span className="inline-block w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Uploading…
              </>
            ) : (
              <>⬆ Import ZIP</>
            )}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".zip"
            className="hidden"
            onChange={handleFile}
          />
        </div>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-3 text-xs text-gray-500">
        <span>Supported sources:</span>
        {[
          'EvtxECmd', 'LECmd', 'JLECmd', 'SBECmd', 'RBCmd',
          'MFTECmd', 'AppCompatCacheParser', 'AmcacheParser',
          'SrumECmd', 'WxTCmd', 'RECmd',
        ].map(t => (
          <span key={t} className="px-1.5 py-0.5 rounded bg-[#0d1927] border border-white/10 font-mono text-gray-400">
            {t}
          </span>
        ))}
      </div>

      {/* Collections list */}
      {isLoading ? (
        <p className="text-gray-500 text-sm">Loading…</p>
      ) : collections.length === 0 ? (
        <div className="border border-dashed border-white/10 rounded-lg p-10 text-center">
          <p className="text-gray-400 text-sm">No collections imported yet</p>
          <p className="text-gray-600 text-xs mt-1">
            Import a ZIP containing EZ Tools parsed CSVs to get started
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {collections.map(col => (
            <CollectionCard key={col.id} col={col} caseId={caseId} />
          ))}
        </div>
      )}

      {/* Retention notice */}
      <p className="text-xs text-gray-600 italic border-t border-white/5 pt-3">
        Files not added to the chain of custody are automatically purged after 90 days.
        Files linked to an evidence entry are kept indefinitely.
      </p>
    </div>
  )
}
