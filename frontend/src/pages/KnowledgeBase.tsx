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
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  Archive, FileText, Image as ImageIcon, File,
  FileSpreadsheet, Code2, ExternalLink, Download,
  Settings, Upload, ZoomIn, ZoomOut, Maximize2,
  BookOpen, Package, FileType,
} from 'lucide-react'
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
  obsidian:    'text-violet-400 bg-violet-500/10 border-violet-500/20',
  pdf:         'text-red-400 bg-red-500/10 border-red-500/20',
  image:       'text-blue-400 bg-blue-500/10 border-blue-500/20',
  text:        'text-slate-400 bg-slate-500/10 border-slate-500/20',
  spreadsheet: 'text-green-400 bg-green-500/10 border-green-500/20',
  code:        'text-purple-400 bg-purple-500/10 border-purple-500/20',
  docx:        'text-cyan-400 bg-cyan-500/10 border-cyan-500/20',
  other:       'text-accent-muted bg-white/5 border-white/10',
}

const ICON_BG: Record<VaultType, string> = {
  obsidian:    'bg-violet-500/10 border-violet-500/20 text-violet-400',
  pdf:         'bg-red-500/10    border-red-500/20    text-red-400',
  image:       'bg-blue-500/10   border-blue-500/20   text-blue-400',
  text:        'bg-slate-500/10  border-slate-500/20  text-slate-400',
  spreadsheet: 'bg-green-500/10  border-green-500/20  text-green-400',
  code:        'bg-purple-500/10 border-purple-500/20 text-purple-400',
  docx:        'bg-cyan-500/10   border-cyan-500/20   text-cyan-400',
  other:       'bg-white/5       border-white/10      text-accent-muted',
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
      className={`w-full text-left px-3 py-2.5 flex items-start gap-2.5 transition-colors group
        ${selected
          ? 'bg-accent-green/5 border-l-2 border-l-accent-green/40 text-white'
          : 'border-l-2 border-l-transparent text-accent-muted hover:text-white hover:bg-white/5'
        }`}
    >
      <div className={`shrink-0 p-1.5 rounded border mt-0.5 ${ICON_BG[type]}`}>
        <TypeIcon type={type} size={12} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium truncate leading-snug">{vault.name}</p>
        <p className={`text-[10px] font-mono mt-0.5 ${selected ? 'text-accent-muted' : 'text-accent-muted/50'}`}>
          {fmtSize(vault.file_size)}
        </p>
        {tags.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1">
            {tags.slice(0, 3).map(t => (
              <span key={t} className="text-[9px] font-mono px-1 py-0 rounded bg-white/5 text-accent-muted/50 border border-white/8">
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
      <div className={`p-3 rounded-xl border ${ICON_BG[type]}`}>
        <TypeIcon type={type} size={22} />
      </div>
      <div className="flex-1 min-w-0">
        <h2 className="text-lg font-bold text-white leading-tight">{vault.name}</h2>
        <div className="flex items-center gap-2 mt-1 flex-wrap">
          <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded border ${TYPE_COLORS[type]}`}>
            {TYPE_LABELS[type]}
          </span>
          <span className="text-xs text-accent-muted/50 font-mono">{fmtSize(vault.file_size)}</span>
          <span className="text-xs text-accent-muted/30 font-mono">{vault.file_name}</span>
        </div>
        {vault.description && (
          <p className="text-sm text-accent-muted mt-2 leading-relaxed">{vault.description}</p>
        )}
        {tags.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-2">
            {tags.map(t => (
              <span key={t} className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-accent-green/10 text-accent-green/70 border border-accent-green/20">
                {t}
              </span>
            ))}
          </div>
        )}
        <p className="text-[10px] text-accent-muted/30 mt-2">
          Importé par {vault.created_by ?? '—'} · {fmtDate(vault.created_at)}
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
      className="btn-primary inline-flex items-center gap-2 text-sm"
    >
      <Download size={14} />
      Télécharger {vault.file_name}
    </a>
  )
}

/** ZIP / Obsidian vault */
function ObsidianView({ vault }: { vault: VaultEntry }) {
  const navigate = useNavigate()
  return (
    <div className="p-8 max-w-2xl mx-auto">
      <VaultMetaHeader vault={vault} />
      <div className="card p-6 space-y-4 border-violet-500/20 bg-violet-500/5">
        <div className="flex items-start gap-3">
          <Archive size={20} className="text-violet-400 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-white">Vault Obsidian</p>
            <p className="text-xs text-accent-muted mt-1 leading-relaxed">
              Ce vault contient des notes Markdown au format Obsidian. Ouvre l'éditeur
              de connaissances pour naviguer, lire et éditer tes notes, suivre les
              wikiliens et visualiser le graphe de connaissances.
            </p>
          </div>
        </div>
        <div className="flex gap-2 pt-2">
          <button
            className="btn-primary flex items-center gap-2 text-sm"
            onClick={() => navigate('/knowledge/editor')}
          >
            <ExternalLink size={14} />
            Ouvrir dans l'éditeur de connaissances
          </button>
          <a
            href={vaultApi.downloadUrl(vault.id)}
            download={vault.file_name}
            className="btn-secondary flex items-center gap-2 text-sm"
          >
            <Download size={13} />
            Télécharger le ZIP
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
      <div className="flex items-center gap-3 px-4 py-2 border-b border-white/5 bg-bg-secondary/50 shrink-0">
        <FileType size={13} className="text-red-400" />
        <span className="text-xs text-accent-muted font-medium flex-1 truncate">{vault.name}</span>
        <a
          href={vaultApi.downloadUrl(vault.id)}
          download={vault.file_name}
          className="flex items-center gap-1 text-xs text-accent-muted/50 hover:text-white transition-colors"
        >
          <Download size={11} />
          Télécharger
        </a>
        <a
          href={vaultApi.viewUrl(vault.id)}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1 text-xs text-accent-muted/50 hover:text-white transition-colors"
        >
          <Maximize2 size={11} />
          Plein écran
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
      <div className="flex items-center gap-3 px-4 py-2 border-b border-white/5 bg-bg-secondary/50 shrink-0">
        <ImageIcon size={13} className="text-blue-400" />
        <span className="text-xs text-accent-muted font-medium flex-1 truncate">{vault.name}</span>
        <span className="text-[10px] font-mono text-accent-muted/40">{fmtSize(vault.file_size)}</span>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setZoom(z => Math.max(0.25, +(z - 0.25).toFixed(2)))}
            className="p-1 rounded text-accent-muted/40 hover:text-white hover:bg-white/5 transition-colors"
            title="Zoom out"
          >
            <ZoomOut size={12} />
          </button>
          <span className="text-[10px] font-mono text-accent-muted/50 w-10 text-center">
            {Math.round(zoom * 100)}%
          </span>
          <button
            onClick={() => setZoom(z => Math.min(4, +(z + 0.25).toFixed(2)))}
            className="p-1 rounded text-accent-muted/40 hover:text-white hover:bg-white/5 transition-colors"
            title="Zoom in"
          >
            <ZoomIn size={12} />
          </button>
          <button
            onClick={() => setZoom(1)}
            className="p-1 rounded text-accent-muted/40 hover:text-white hover:bg-white/5 transition-colors text-[10px] font-mono"
            title="Reset zoom"
          >
            1:1
          </button>
        </div>
        <a
          href={vaultApi.downloadUrl(vault.id)}
          download={vault.file_name}
          className="flex items-center gap-1 text-xs text-accent-muted/50 hover:text-white transition-colors"
        >
          <Download size={11} />
          Télécharger
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
      <div className="flex items-center gap-3 px-4 py-2 border-b border-white/5 bg-bg-secondary/50 shrink-0">
        <FileText size={13} className="text-slate-400" />
        <span className="text-xs text-accent-muted font-medium flex-1 truncate">{vault.name}</span>
        <a
          href={vaultApi.downloadUrl(vault.id)}
          download={vault.file_name}
          className="flex items-center gap-1 text-xs text-accent-muted/50 hover:text-white transition-colors"
        >
          <Download size={11} />
          Télécharger
        </a>
      </div>
      <div className="flex-1 overflow-auto p-6">
        {isLoading ? (
          <p className="text-accent-muted text-sm animate-pulse">Chargement…</p>
        ) : (
          <pre className="text-xs text-foreground/80 font-mono whitespace-pre-wrap leading-relaxed">
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
      <div className="card p-6 space-y-3 border-white/10">
        <p className="text-sm text-accent-muted">
          {type === 'docx'
            ? 'Les documents Word ne peuvent pas être prévisualisés directement dans le navigateur.'
            : type === 'spreadsheet'
            ? 'Les fichiers tableur ne peuvent pas être prévisualisés directement dans le navigateur.'
            : 'Ce type de fichier ne peut pas être prévisualisé dans le navigateur.'}
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
      <Archive size={42} className="text-accent-muted/15" />
      <div>
        <p className="text-accent-muted text-sm font-medium">Sélectionne un vault</p>
        <p className="text-accent-muted/40 text-xs mt-1 max-w-xs">
          Choisis un vault dans la liste à gauche pour le prévisualiser ou l'ouvrir.
        </p>
      </div>
      <button
        className="btn-secondary text-xs flex items-center gap-1.5 mt-2"
        onClick={() => navigate('/config/vaults')}
      >
        <Settings size={12} />
        Gérer les vaults
      </button>
    </div>
  )
}

function NoVaultsYet() {
  const navigate = useNavigate()
  return (
    <div className="flex flex-col items-center justify-center h-full gap-4 text-center px-8">
      <Package size={46} className="text-accent-muted/12" />
      <div>
        <p className="text-accent-muted text-sm font-medium">Aucun vault importé</p>
        <p className="text-accent-muted/40 text-xs mt-1 max-w-xs leading-relaxed">
          Importe des vaults Obsidian, PDF, images ou documents depuis la page de gestion.
        </p>
      </div>
      <button
        className="btn-primary text-xs flex items-center gap-1.5"
        onClick={() => navigate('/config/vaults')}
      >
        <Upload size={12} />
        Importer un vault
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
    <div className="flex h-full overflow-hidden">

      {/* ── Left panel — vault list ──────────────────────────────────────── */}
      <aside className="w-64 shrink-0 border-r border-white/5 bg-bg-secondary flex flex-col">

        {/* Header */}
        <div className="px-3 py-3 border-b border-white/5 space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Archive size={14} className="text-accent-green/70" />
              <span className="text-xs font-semibold text-accent-green tracking-wide">Knowledge Vaults</span>
            </div>
            <button
              onClick={() => navigate('/config/vaults')}
              className="p-1 rounded text-accent-muted/30 hover:text-white hover:bg-white/5 transition-colors"
              title="Gérer les vaults"
            >
              <Settings size={12} />
            </button>
          </div>

          {/* Search */}
          {vaults.length > 2 && (
            <input
              className="input py-1 text-xs"
              placeholder="Rechercher…"
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
                  className={`text-[9px] font-mono px-1.5 py-0.5 rounded border transition-colors ${
                    typeFilter === t
                      ? 'bg-accent-green/15 text-accent-green border-accent-green/30'
                      : 'bg-white/5 text-accent-muted/40 border-white/10 hover:text-white'
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
                  <div className="w-7 h-7 rounded bg-white/5 shrink-0" />
                  <div className="flex-1 space-y-1.5">
                    <div className="h-3 bg-white/5 rounded w-28" />
                    <div className="h-2 bg-white/5 rounded w-16" />
                  </div>
                </div>
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <p className="text-[11px] text-accent-muted/30 italic text-center py-6 px-3">
              {search || typeFilter !== 'all' ? 'Aucun vault trouvé.' : 'Aucun vault importé.'}
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
          <div className="px-3 py-2 border-t border-white/5">
            <button
              onClick={() => navigate('/config/vaults')}
              className="flex items-center gap-1.5 text-[10px] text-accent-muted/30 hover:text-accent-green transition-colors w-full"
            >
              <Settings size={10} />
              {vaults.length} vault{vaults.length !== 1 ? 's' : ''} · Gérer →
            </button>
          </div>
        )}
      </aside>

      {/* ── Right panel — viewer ─────────────────────────────────────────── */}
      <main className="flex-1 overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-accent-muted text-sm animate-pulse">Chargement des vaults…</p>
          </div>
        ) : vaults.length === 0 ? (
          <NoVaultsYet />
        ) : selectedVault ? (
          <VaultViewer vault={selectedVault} />
        ) : (
          <NoVaultSelected />
        )}
      </main>

    </div>
  )
}
