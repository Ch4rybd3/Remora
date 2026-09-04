/**
 * Vault Browser — main Knowledge Base entry point.
 *
 * Left panel  : list of all vaults (from vault API).
 * Right panel : type-aware viewer.
 *   • ZIP / Obsidian  → info card + "Open Knowledge Editor" button
 *   • PDF             → native browser PDF viewer via <iframe>
 *   • Images          → full-panel <img> with zoom
 *   • Text / Markdown → rendered plain text
 *   • DOCX / other    → metadata card + download button
 *
 * The Obsidian markdown editor lives at /knowledge/editor (KnowledgeEditor).
 * Vault administration (upload / delete / edit) lives at /config/vaults.
 */

import { useState } from 'react'
import { PageShell } from '../ui/PageShell'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  Archive, FileText, Image as ImageIcon, File,
  FileSpreadsheet, Code2, ExternalLink, Download,
  Settings, Upload, ZoomIn, ZoomOut, Maximize2,
  BookOpen, Package, FileType,
} from '../ui/icons'
import { vaultApi, type VaultEntry } from '../api/vault'
import { fmtDate } from '../utils/dateUtils'

// ── Vault type detection ───────────────────────────────────────────────────────

type VaultType = 'obsidian' | 'pdf' | 'image' | 'text' | 'spreadsheet' | 'code' | 'docx' | 'other'

function detectType(fileName: string): VaultType {
  const ext = fileName.split('.').pop()?.toLowerCase() ?? ''
  if (ext === 'zip')                                             return 'obsidian'
  if (ext === 'pdf')                                             return 'pdf'
  if (['png','jpg','jpeg','gif','webp','svg','bmp'].includes(ext)) return 'image'
  if (['md','txt','rst','log','csv'].includes(ext))              return 'text'
  if (['xlsx','xls','ods'].includes(ext))                        return 'spreadsheet'
  if (['py','js','ts','sh','ps1','json','yaml','yml','toml','xml'].includes(ext)) return 'code'
  if (['docx','doc','odt','rtf'].includes(ext))                  return 'docx'
  return 'other'
}

function TypeIcon({ type, size = 16, className = '' }: { type: VaultType; size?: number; className?: string }) {
  const props = { size, className }
  switch (type) {
    case 'obsidian':    return <Archive {...props} />
    case 'pdf':         return <FileType {...props} />
    case 'image':       return <ImageIcon {...props} />
    case 'text':        return <FileText {...props} />
    case 'spreadsheet': return <FileSpreadsheet {...props} />
    case 'code':        return <Code2 {...props} />
    case 'docx':        return <BookOpen {...props} />
    default:            return <File {...props} />
  }
}

const TYPE_LABELS: Record<VaultType, string> = {
  obsidian:    'Obsidian Vault',
  pdf:         'PDF',
  image:       'Image',
  text:        'Text / Markdown',
  spreadsheet: 'Spreadsheet',
  code:        'Script / Code',
  docx:        'Word Document',
  other:       'File',
}

const TYPE_COLORS: Record<VaultType, string> = {
  obsidian:    'text-data-2 bg-data-2/10 border-data-2/20',
  pdf:         'text-severity-critical bg-severity-critical/10 border-severity-critical/20',
  image:       'text-severity-low bg-severity-low/10 border-severity-low/20',
  text:        'text-fg-muted bg-fg-muted/10 border-fg-muted/20',
  spreadsheet: 'text-accent bg-accent/10 border-accent/20',
  code:        'text-data-2 bg-data-2/10 border-data-2/20',
  docx:        'text-data-5 bg-data-5/10 border-data-5/20',
  other:       'text-fg-secondary bg-fg/5 border-hairline',
}

const ICON_BG: Record<VaultType, string> = {
  obsidian:    'bg-data-2/10 border-data-2/20 text-data-2',
  pdf:         'bg-severity-critical/10    border-severity-critical/20    text-severity-critical',
  image:       'bg-severity-low/10   border-severity-low/20   text-severity-low',
  text:        'bg-fg-muted/10  border-fg-muted/20  text-fg-muted',
  spreadsheet: 'bg-accent/10  border-accent/20  text-accent',
  code:        'bg-data-2/10 border-data-2/20 text-data-2',
  docx:        'bg-data-5/10   border-data-5/20   text-data-5',
  other:       'bg-fg/5       border-hairline      text-fg-secondary',
}

import { fmtBytes as fmtSize } from '../utils/formatUtils'

// ── Helpers ────────────────────────────────────────────────────────────────────

function parseTags(raw: string): string[] {
  return raw.split(',').map(t => t.trim()).filter(Boolean)
}

// ── Left panel — vault list ────────────────────────────────────────────────────

function VaultListItem({
  vault, selected, onClick,
}: {
  vault: VaultEntry; selected: boolean; onClick: () => void
}) {
  const type = detectType(vault.file_name)
  const tags = parseTags(vault.tags)

  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-3 py-2.5 flex items-start gap-2.5 transition-colors group ${selected
          ? 'bg-accent/5 border-l-2 border-l-accent/40 text-fg'
          : 'border-l-2 border-l-transparent text-fg-secondary hover:text-fg hover:bg-fg/5'
        }`}
    >
      <div className={`shrink-0 p-1.5 rounded-control border mt-0.5 ${ICON_BG[type]}`}>
        <TypeIcon type={type} size={12} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-label font-medium truncate leading-snug">{vault.name}</p>
        <p className={`text-label font-mono mt-0.5 ${selected ? 'text-fg-secondary' : 'text-fg-secondary/50'}`}>
          {fmtSize(vault.file_size)}
        </p>
        {tags.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1">
            {tags.slice(0, 3).map(t => (
              <span key={t} className="text-label font-mono px-1 py-0 rounded-control bg-fg/5 text-fg-secondary/50 border border-hairline">
                {t}
              </span>
            ))}
          </div>
        )}
      </div>
    </button>
  )
}

// ── Right panel viewers ────────────────────────────────────────────────────────

function VaultMetaHeader({ vault }: { vault: VaultEntry }) {
  const type = detectType(vault.file_name)
  const tags = parseTags(vault.tags)
  return (
    <div className="flex items-start gap-4 mb-6">
      <div className={`p-3 border ${ICON_BG[type]}`}>
        <TypeIcon type={type} size={22} />
      </div>
      <div className="flex-1 min-w-0">
        <h2 className="text-title font-bold text-fg leading-tight">{vault.name}</h2>
        <div className="flex items-center gap-2 mt-1 flex-wrap">
          <span className={`text-label font-mono px-1.5 py-0.5 rounded-control border ${TYPE_COLORS[type]}`}>
            {TYPE_LABELS[type]}
          </span>
          <span className="text-label text-fg-secondary/50 font-mono">{fmtSize(vault.file_size)}</span>
          <span className="text-label text-fg-secondary/30 font-mono">{vault.file_name}</span>
        </div>
        {vault.description && (
          <p className="text-ui text-fg-secondary mt-2 leading-relaxed">{vault.description}</p>
        )}
        {tags.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-2">
            {tags.map(t => (
              <span key={t} className="text-label font-mono px-1.5 py-0.5 rounded-control bg-accent/10 text-accent/70 border border-accent/20">
                {t}
              </span>
            ))}
          </div>
        )}
        <p className="text-label text-fg-secondary/30 mt-2">
          Imported by {vault.created_by ?? '-'} · {fmtDate(vault.created_at)}
        </p>
      </div>
    </div>
  )
}

function DownloadBtn({ vault }: { vault: VaultEntry }) {
  return (
    <a
      href={vaultApi.downloadUrl(vault.id)}
      download={vault.file_name}
      className="btn-primary inline-flex items-center gap-2 text-ui"
    >
      <Download size={14} />
      Download {vault.file_name}
    </a>
  )
}

/** ZIP / Obsidian vault */
function ObsidianView({ vault }: { vault: VaultEntry }) {
  const navigate = useNavigate()
  return (
    <div className="p-8 max-w-2xl mx-auto">
      <VaultMetaHeader vault={vault} />
      <div className="card p-6 space-y-4 border-data-2/20 bg-data-2/5">
        <div className="flex items-start gap-3">
          <Archive size={20} className="text-data-2 shrink-0 mt-0.5" />
          <div>
            <p className="text-ui font-semibold text-fg">Vault Obsidian</p>
            <p className="text-label text-fg-secondary mt-1 leading-relaxed">
              This vault holds Markdown notes in Obsidian format. Open the knowledge
              editor to browse, read and edit them, follow wikilinks and view the
              knowledge graph.
            </p>
          </div>
        </div>
        <div className="flex gap-2 pt-2">
          <button
            className="btn-primary flex items-center gap-2 text-ui"
            onClick={() => navigate('/knowledge/editor')}
          >
            <ExternalLink size={14} />
            Open in the knowledge editor
          </button>
          <a
            href={vaultApi.downloadUrl(vault.id)}
            download={vault.file_name}
            className="btn-secondary flex items-center gap-2 text-ui"
          >
            <Download size={13} />
            Download the ZIP
          </a>
        </div>
      </div>
    </div>
  )
}

/** PDF viewer */
function PdfView({ vault }: { vault: VaultEntry }) {
  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-3 px-4 py-2 border-b border-hairline bg-panel/50 shrink-0">
        <FileType size={13} className="text-severity-critical" />
        <span className="text-label text-fg-secondary font-medium flex-1 truncate">{vault.name}</span>
        <a
          href={vaultApi.downloadUrl(vault.id)}
          download={vault.file_name}
          className="flex items-center gap-1 text-label text-fg-secondary/50 hover:text-fg transition-colors"
        >
          <Download size={11} />
          Download
        </a>
        <a
          href={vaultApi.viewUrl(vault.id)}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1 text-label text-fg-secondary/50 hover:text-fg transition-colors"
        >
          <Maximize2 size={11} />
          Full screen
        </a>
      </div>
      <iframe
        src={vaultApi.viewUrl(vault.id)}
        className="flex-1 w-full border-none bg-white"
        title={vault.name}
      />
    </div>
  )
}

/** Image viewer */
function ImageView({ vault }: { vault: VaultEntry }) {
  const [zoom, setZoom] = useState(1)
  const ext = vault.file_name.split('.').pop()?.toLowerCase()
  const isSvg = ext === 'svg'

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center gap-3 px-4 py-2 border-b border-hairline bg-panel/50 shrink-0">
        <ImageIcon size={13} className="text-severity-low" />
        <span className="text-label text-fg-secondary font-medium flex-1 truncate">{vault.name}</span>
        <span className="text-label font-mono text-fg-secondary/40">{fmtSize(vault.file_size)}</span>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setZoom(z => Math.max(0.25, +(z - 0.25).toFixed(2)))}
            className="p-1 rounded-control text-fg-secondary/40 hover:text-fg hover:bg-fg/5 transition-colors"
            title="Zoom out"
          >
            <ZoomOut size={12} />
          </button>
          <span className="text-label font-mono text-fg-secondary/50 w-10 text-center">
            {Math.round(zoom * 100)}%
          </span>
          <button
            onClick={() => setZoom(z => Math.min(4, +(z + 0.25).toFixed(2)))}
            className="p-1 rounded-control text-fg-secondary/40 hover:text-fg hover:bg-fg/5 transition-colors"
            title="Zoom in"
          >
            <ZoomIn size={12} />
          </button>
          <button
            onClick={() => setZoom(1)}
            className="p-1 rounded-control text-fg-secondary/40 hover:text-fg hover:bg-fg/5 transition-colors text-label font-mono"
            title="Reset zoom"
          >
            1:1
          </button>
        </div>
        <a
          href={vaultApi.downloadUrl(vault.id)}
          download={vault.file_name}
          className="flex items-center gap-1 text-label text-fg-secondary/50 hover:text-fg transition-colors"
        >
          <Download size={11} />
          Download
        </a>
      </div>

      {/* Image area */}
      <div className="flex-1 overflow-auto flex items-start justify-center p-6 bg-[#0a0f1a]">
        {isSvg ? (
          <object
            data={vaultApi.viewUrl(vault.id)}
            type="image/svg+xml"
            className="max-w-none shadow-2xl"
            style={{ transform: `scale(${zoom})`, transformOrigin: 'top center', transition: 'transform 0.15s' }}
          />
        ) : (
          <img
            src={vaultApi.viewUrl(vault.id)}
            alt={vault.name}
            className="max-w-none shadow-2xl"
            style={{ transform: `scale(${zoom})`, transformOrigin: 'top center', transition: 'transform 0.15s' }}
          />
        )}
      </div>
    </div>
  )
}

/** Plain text / Markdown viewer */
function TextView({ vault }: { vault: VaultEntry }) {
  const { data, isLoading } = useQuery({
    queryKey: ['vault-text', vault.id],
    queryFn: async () => {
      const res = await fetch(vaultApi.viewUrl(vault.id), { credentials: 'include' })
      return res.text()
    },
  })

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-3 px-4 py-2 border-b border-hairline bg-panel/50 shrink-0">
        <FileText size={13} className="text-fg-muted" />
        <span className="text-label text-fg-secondary font-medium flex-1 truncate">{vault.name}</span>
        <a
          href={vaultApi.downloadUrl(vault.id)}
          download={vault.file_name}
          className="flex items-center gap-1 text-label text-fg-secondary/50 hover:text-fg transition-colors"
        >
          <Download size={11} />
          Download
        </a>
      </div>
      <div className="flex-1 overflow-auto p-6">
        {isLoading ? (
          <p className="text-fg-secondary text-ui animate-pulse">Loading...</p>
        ) : (
          <pre className="text-label text-fg/80 font-mono whitespace-pre-wrap leading-relaxed">
            {data}
          </pre>
        )}
      </div>
    </div>
  )
}

/** DOCX / spreadsheet / other — download only */
function DownloadOnlyView({ vault }: { vault: VaultEntry }) {
  const type = detectType(vault.file_name)
  return (
    <div className="p-8 max-w-2xl mx-auto">
      <VaultMetaHeader vault={vault} />
      <div className="card p-6 space-y-3 border-hairline">
        <p className="text-ui text-fg-secondary">
          {type === 'docx'
            ? 'Word documents cannot be previewed directly in the browser.'
            : type === 'spreadsheet'
            ? 'Spreadsheet files cannot be previewed directly in the browser.'
            : 'This file type cannot be previewed in the browser.'}
        </p>
        <DownloadBtn vault={vault} />
      </div>
    </div>
  )
}

/** Dispatcher: chooses viewer based on vault type */
function VaultViewer({ vault }: { vault: VaultEntry }) {
  const type = detectType(vault.file_name)
  switch (type) {
    case 'obsidian':    return <ObsidianView vault={vault} />
    case 'pdf':         return <PdfView vault={vault} />
    case 'image':       return <ImageView vault={vault} />
    case 'text':
    case 'code':        return <TextView vault={vault} />
    default:            return <DownloadOnlyView vault={vault} />
  }
}

// ── Empty states ───────────────────────────────────────────────────────────────

function NoVaultSelected() {
  const navigate = useNavigate()
  return (
    <div className="flex flex-col items-center justify-center h-full gap-4 text-center px-8">
      <Archive size={42} className="text-fg-secondary/15" />
      <div>
        <p className="text-fg-secondary text-ui font-medium">Select a vault</p>
        <p className="text-fg-secondary/40 text-label mt-1 max-w-xs">
          Pick a vault from the list on the left to preview or open it.
        </p>
      </div>
      <button
        className="btn-secondary text-label flex items-center gap-1.5 mt-2"
        onClick={() => navigate('/config/vaults')}
      >
        <Settings size={12} />
        Manage vaults
      </button>
    </div>
  )
}

function NoVaultsYet() {
  const navigate = useNavigate()
  return (
    <div className="flex flex-col items-center justify-center h-full gap-4 text-center px-8">
      <Package size={46} className="text-fg-secondary/12" />
      <div>
        <p className="text-fg-secondary text-ui font-medium">No vault imported</p>
        <p className="text-fg-secondary/40 text-label mt-1 max-w-xs leading-relaxed">
          Importe des vaults Obsidian, PDF, images ou documents depuis la page de gestion.
        </p>
      </div>
      <button
        className="btn-primary text-label flex items-center gap-1.5"
        onClick={() => navigate('/config/vaults')}
      >
        <Upload size={12} />
        Import a vault
      </button>
    </div>
  )
}

// ── Search / filter bar ────────────────────────────────────────────────────────

const TYPE_FILTER_LABELS: Partial<Record<VaultType | 'all', string>> = {
  all:      'Tous',
  obsidian: 'Obsidian',
  pdf:      'PDF',
  image:    'Images',
  text:     'Texte',
  docx:     'Word',
  other:    'Autres',
}

// ── Main page ──────────────────────────────────────────────────────────────────

export default function KnowledgeBase() {
  const navigate = useNavigate()
  const [selectedId, setSelectedId]       = useState<number | null>(null)
  const [search, setSearch]               = useState('')
  const [typeFilter, setTypeFilter]       = useState<VaultType | 'all'>('all')

  const { data: vaults = [], isLoading } = useQuery({
    queryKey: ['vaults'],
    queryFn:  vaultApi.list,
  })

  const selectedVault = vaults.find(v => v.id === selectedId) ?? null

  // Filter logic
  const filtered = vaults.filter(v => {
    const q = search.toLowerCase()
    const matchQ = !q || v.name.toLowerCase().includes(q) || v.tags.toLowerCase().includes(q) || v.description.toLowerCase().includes(q)
    const matchT  = typeFilter === 'all' || detectType(v.file_name) === typeFilter
    return matchQ && matchT
  })

  // Available type filters (only types that exist in the vaults list)
  const presentTypes = [...new Set(vaults.map(v => detectType(v.file_name)))]
  const filterOptions: Array<VaultType | 'all'> = ['all', ...presentTypes]

  return (
    <PageShell
      route="/knowledge"
      title="Vault"
      meta={vaults.length ? `${vaults.length} vault${vaults.length > 1 ? 's' : ''}` : undefined}
      fullHeight
      asideLeft={(
      <aside className="w-64 shrink-0 border-r border-hairline bg-panel flex flex-col">

        {/* Header */}
        <div className="px-3 py-3 border-b border-hairline space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Archive size={14} className="text-accent/70" />
              <span className="text-label font-semibold text-accent tracking-wide">Knowledge Vaults</span>
            </div>
            <button
              onClick={() => navigate('/config/vaults')}
              className="p-1 rounded-control text-fg-secondary/30 hover:text-fg hover:bg-fg/5 transition-colors"
              title="Manage vaults"
            >
              <Settings size={12} />
            </button>
          </div>

          {/* Search */}
          {vaults.length > 2 && (
            <input
              className="input py-1 text-label"
              placeholder="Search..."
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          )}

          {/* Type filter chips */}
          {presentTypes.length > 1 && (
            <div className="flex flex-wrap gap-1">
              {filterOptions.map(t => (
                <button
                  key={t}
                  onClick={() => setTypeFilter(t)}
                  className={`text-label font-mono px-1.5 py-0.5 rounded-control border transition-colors ${ typeFilter === t
                      ? 'bg-accent/15 text-accent border-accent/30'
                      : 'bg-fg/5 text-fg-secondary/40 border-hairline hover:text-fg'
                  }`}
                >
                  {TYPE_FILTER_LABELS[t] ?? t}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Vault list */}
        <div className="flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="space-y-1 p-2">
              {[1, 2, 3].map(i => (
                <div key={i} className="flex gap-2 px-2 py-2 animate-pulse">
                  <div className="w-7 h-7 rounded-control bg-fg/5 shrink-0" />
                  <div className="flex-1 space-y-1.5">
                    <div className="h-3 bg-fg/5 rounded-control w-28" />
                    <div className="h-2 bg-fg/5 rounded-control w-16" />
                  </div>
                </div>
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <p className="text-label text-fg-secondary/30 italic text-center py-6 px-3">
              {search || typeFilter !== 'all' ? 'No vault found.' : 'No vault imported.'}
            </p>
          ) : (
            <div className="space-y-0 py-1">
              {filtered.map(v => (
                <VaultListItem
                  key={v.id}
                  vault={v}
                  selected={v.id === selectedId}
                  onClick={() => setSelectedId(v.id === selectedId ? null : v.id)}
                />
              ))}
            </div>
          )}
        </div>

        {/* Footer: count + manage link */}
        {vaults.length > 0 && (
          <div className="px-3 py-2 border-t border-hairline">
            <button
              onClick={() => navigate('/config/vaults')}
              className="flex items-center gap-1.5 text-label text-fg-secondary/30 hover:text-accent transition-colors w-full"
            >
              <Settings size={10} />
              {vaults.length} vault{vaults.length !== 1 ? 's' : ''} · Manage →
            </button>
          </div>
        )}
      </aside>
      )}
    >

      {/* ── Right panel — viewer ─────────────────────────────────────────── */}
      <main className="h-full overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-fg-secondary text-ui animate-pulse">Loading vaults...</p>
          </div>
        ) : vaults.length === 0 ? (
          <NoVaultsYet />
        ) : selectedVault ? (
          <VaultViewer vault={selectedVault} />
        ) : (
          <NoVaultSelected />
        )}
      </main>

    </PageShell>
  )
}
