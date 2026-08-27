import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Upload, Search, X, ChevronDown, ChevronLeft, ChevronRight,
  ChevronsLeft, ChevronsRight, ArrowUp, ArrowDown, SlidersHorizontal,
  BookmarkPlus, BookmarkCheck, Download, Columns3, Trash2, FileText,
  Loader2, Info, Table2, Globe, Layers, GripVertical, ChevronRight as ChevronRightIcon,
  Terminal, HelpCircle, AlertCircle, Shield, ShieldCheck,
} from '../ui/icons'
import { csvArtifactsApi, type CsvArtifactMeta, type ArtifactRowFilters, type OmniSearchFile, type GroupResult } from '../api/csvArtifacts'
import { timelineApi } from '../api/timeline'
import { useCurrentCase } from '../context/CurrentCaseContext'
import { fmtRelative, parseArtifactTimestamp } from '../utils/dateUtils'

// ── Types ─────────────────────────────────────────────────────────────────────

type FilterMode = 'contains' | '=' | '!contains' | '!='
interface ColFilter { mode: FilterMode; value: string }
type ColFilters = Record<string, ColFilter>

interface TabState {
  filters:     ArtifactRowFilters
  colFilters:  ColFilters
  hiddenCols:  string[]
  colWidths:   Record<string, number>
  groupByCols: string[]
  colOrder:    string[]
  rql:         string
}

const defaultTabState = (): TabState => ({
  filters:     { page: 1, page_size: 100, sort_dir: 'asc' },
  colFilters:  {},
  hiddenCols:  [],
  colWidths:   {},
  groupByCols: [],
  colOrder:    [],
  rql:         '',
})

interface PinnedRow {
  key:            string
  artifactId:     string
  artifactName:   string
  ezLabel:        string | null
  ezCategory:     string | null
  dateColumn:     string | null
  sourceTimezone: string | null
  columns:        string[]
  row:            Record<string, string>
  /** Analyst-editable, pre-filled from the parser recipe below. */
  title:          string
  description:    string
}

// ── Timeline title/description recipes ────────────────────────────────────────
// Per-parser hints telling which columns actually carry meaning, so an exported
// event reads like an event instead of "first non-empty column". Column names
// are matched case-insensitively; missing columns are skipped, and a parser with
// no recipe (or no matching column) falls back to the generic heuristic.

interface TitleRecipe {
  /** Slots joined with ' — '. Within a slot, the first present & non-empty column wins. */
  title:   string[][]
  /** Columns listed as `name: value` lines in the default description. */
  detail?: string[]
}

const TITLE_RECIPES: Record<string, TitleRecipe> = {
  evtx_ez: {
    title:  [['Computer'], ['EventId', 'EventID'], ['MapDescription'], ['PayloadData1']],
    detail: ['Provider', 'Channel', 'Level', 'UserName', 'RemoteHost', 'ExecutableInfo',
             'PayloadData1', 'PayloadData2', 'PayloadData3'],
  },
  mft_ez: {
    title:  [['ParentPath'], ['FileName']],
    detail: ['Extension', 'FileSize', 'IsDirectory', 'HasAds', 'SiFlags', 'SI<FN'],
  },
  usn_ez: {
    title:  [['ParentPath'], ['Name'], ['UpdateReasons']],
    detail: ['Extension', 'FileAttributes', 'UpdateSequenceNumber', 'EntryNumber'],
  },
  mft_boot: {
    title:  [['SourceFile'], ['VolumeSerialNumber']],
    detail: ['BytesPerSector', 'SectorsPerCluster', 'TotalSectors'],
  },
  shimcache: {
    title:  [['Path'], ['Executed']],
    detail: ['ControlSet', 'CacheEntryPosition', 'Duplicate', 'SourceFile'],
  },
  amcache_unassociated: {
    title:  [['Name', 'ApplicationName'], ['FullPath']],
    detail: ['SHA1', 'FileExtension', 'ProductName', 'CompanyName', 'IsOsComponent'],
  },
  amcache_associated: {
    title:  [['Name', 'ApplicationName'], ['FullPath']],
    detail: ['SHA1', 'FileExtension', 'ProductName', 'CompanyName', 'ProgramId'],
  },
  amcache_programs: {
    title:  [['Name'], ['Version'], ['Publisher']],
    detail: ['ProgramId', 'InstallDate', 'RootDirPath', 'UninstallString'],
  },
  amcache_shortcuts: {
    title:  [['LnkName']],
    detail: ['ProgramId', 'KeyLastWriteTimestamp'],
  },
  amcache_drivers: {
    title:  [['DriverName'], ['Product']],
    detail: ['SHA1', 'Service', 'DriverCompany', 'Signed'],
  },
  amcache_devices: {
    title:  [['ModelName'], ['Manufacturer']],
    detail: ['Categories', 'PrimaryCategory', 'DiscoveryMethod'],
  },
  amcache_pnp: {
    title:  [['HWID'], ['Description']],
    detail: ['Manufacturer', 'Model', 'Service', 'ClassGuid'],
  },
  lnk_files: {
    title:  [['LocalPath', 'TargetIDAbsolutePath', 'CommonPath'], ['Arguments']],
    detail: ['SourceFile', 'WorkingDirectory', 'MachineID', 'MachineMACAddress',
             'VolumeSerialNumber', 'VolumeLabel', 'DriveType', 'FileSize'],
  },
  jump_lists_auto: {
    title:  [['AppIdDescription', 'AppId'], ['Path']],
    detail: ['SourceFile', 'Hostname', 'MacAddress', 'InteractionCount', 'EntryNumber'],
  },
  jump_lists_custom: {
    title:  [['AppIdDescription', 'AppId'], ['Path', 'LocalPath']],
    detail: ['SourceFile', 'Arguments', 'WorkingDirectory'],
  },
  recycle_bin: {
    title:  [['FileName']],
    detail: ['FileSize', 'FileType', 'SourceName'],
  },
  windows_timeline: {
    title:  [['Executable'], ['DisplayText'], ['ActivityType']],
    detail: ['AppId', 'ContentInfo', 'Duration', 'Payload'],
  },
  windows_timeline_pkg: {
    title:  [['Name'], ['Platform']],
    detail: ['Expires'],
  },
  shellbags: {
    title:  [['AbsolutePath', 'Value']],
    detail: ['BagPath', 'ShellType', 'MFTEntry', 'ChildBags'],
  },
  srum_app_usage: {
    title:  [['ExeInfo'], ['UserName']],
    detail: ['ExeInfoDescription', 'AppId', 'ForegroundCycleTime', 'BackgroundCycleTime',
             'BytesRead', 'BytesWritten'],
  },
  srum_network: {
    title:  [['ExeInfo'], ['UserName']],
    detail: ['BytesReceived', 'BytesSent', 'InterfaceLuid', 'L2ProfileId', 'AppId'],
  },
  srum_net_conn: {
    title:  [['ExeInfo'], ['UserName']],
    detail: ['InterfaceLuid', 'L2ProfileId', 'ConnectedTime', 'ConnectStartTime'],
  },
  srum_timeline: {
    title:  [['ExeInfo'], ['UserName']],
    detail: ['ExeInfoDescription', 'AppId', 'EndTime', 'DurationMs'],
  },
  srum_energy: {
    title:  [['ExeInfo'], ['UserName']],
    detail: ['AppId', 'ChargeLevel', 'EventTimestamp'],
  },
  registry_batch: {
    title:  [['KeyPath'], ['ValueName'], ['ValueData']],
    detail: ['HivePath', 'HiveType', 'Description', 'Category', 'ValueType', 'Comment'],
  },
  registry_plugin: {
    title:  [['KeyPath', 'ValueName'], ['ValueData', 'Value']],
    detail: ['HivePath', 'Description', 'Comment'],
  },
}

/** Case-insensitive column lookup returning the trimmed cell value, or ''. */
function pickCol(row: Record<string, string>, candidates: string[]): string {
  const lower = new Map(Object.keys(row).map(k => [k.toLowerCase(), k]))
  for (const cand of candidates) {
    const key = lower.get(cand.toLowerCase())
    const val = key !== undefined ? (row[key] ?? '').trim() : ''
    if (val) return val
  }
  return ''
}

/**
 * Build the default timeline title for a pinned row.
 * Uses the parser recipe when one matches, otherwise the legacy heuristic
 * (artifact label + first non-empty non-date column).
 */
function buildDefaultTitle(item: Omit<PinnedRow, 'title' | 'description'>): string {
  const prefix = item.ezLabel ?? item.artifactName
  const recipe = item.ezCategory ? TITLE_RECIPES[item.ezCategory] : undefined

  if (recipe) {
    const parts = recipe.title.map(slot => pickCol(item.row, slot)).filter(Boolean)
    if (parts.length) return `${prefix} — ${parts.join(' — ')}`.slice(0, 120)
  }

  const fallback = Object.entries(item.row).find(([k, v]) => k !== item.dateColumn && v?.trim())
  return (prefix + (fallback ? ' — ' + fallback[1] : '')).slice(0, 120)
}

/**
 * Build the default timeline description. The full record always ships in
 * raw_payload, so this stays a short readable summary of the useful columns.
 */
function buildDefaultDescription(item: Omit<PinnedRow, 'title' | 'description'>): string {
  const recipe = item.ezCategory ? TITLE_RECIPES[item.ezCategory] : undefined

  if (recipe?.detail) {
    const lines = recipe.detail
      .map(col => [col, pickCol(item.row, [col])] as const)
      .filter(([, v]) => v)
      .map(([k, v]) => `${k}: ${v}`)
    if (lines.length) return lines.join('\n')
  }

  return Object.entries(item.row)
    .filter(([k, v]) => k !== item.dateColumn && v?.trim())
    .slice(0, 8)
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n')
}

type FlatItem =
  | {
      type:       'group'
      depth:      number
      key:        string
      groupCol:   string
      groupVal:   string
      count:      number
      isExpanded: boolean
      isLeaf:     boolean
      filters:    Record<string, string>  // accumulated col=val for this group path
    }
  | {
      type:         'group-rows'
      groupKey:     string
      groupFilters: Record<string, string>
      depth:        number
    }

/** Stable unique key using all row values. */
function makeRowKey(artifactId: string, row: Record<string, string>): string {
  return `${artifactId}\x1f${Object.values(row).join('\x1e')}`
}

/**
 * Build a flat list for rendering from backend group results.
 * Groups are only the aggregation layer — rows are fetched lazily on expand.
 */
function buildGroupTree(
  groups:     GroupResult[],
  groupCols:  string[],
  expanded:   Set<string>,
  depth = 0,
  prefix = '',
  parentFilters: Record<string, string> = {},
): FlatItem[] {
  if (!groupCols.length) return []
  const col  = groupCols[depth]
  const isLeaf = depth === groupCols.length - 1

  // Collect unique values at this depth and their summed counts
  const byVal = new Map<string, { count: number; sub: GroupResult[] }>()
  for (const g of groups) {
    const val = g.values[col] ?? ''
    if (!byVal.has(val)) byVal.set(val, { count: 0, sub: [] })
    const entry = byVal.get(val)!
    entry.count += g.count
    entry.sub.push(g)
  }

  const sorted = [...byVal.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  const result: FlatItem[] = []

  for (const [val, { count, sub }] of sorted) {
    const key        = `${prefix}\x1f${val}`
    const isExpanded = expanded.has(key)
    const filters    = { ...parentFilters, [col]: val }

    result.push({ type: 'group', depth, key, groupCol: col, groupVal: val, count, isExpanded, isLeaf, filters })

    if (isExpanded) {
      if (isLeaf) {
        result.push({ type: 'group-rows', groupKey: key, groupFilters: filters, depth: depth + 1 })
      } else {
        result.push(...buildGroupTree(sub, groupCols, expanded, depth + 1, key, filters))
      }
    }
  }
  return result
}

const MODES: FilterMode[] = ['contains', '=', '!contains', '!=']
const MODE_LABEL: Record<FilterMode, string> = { 'contains': '~', '=': '=', '!contains': '!~', '!=': '≠' }

// ── EZ Badge ──────────────────────────────────────────────────────────────────

function EZBadge({ label }: { label: string }) {
  return (
    <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded border bg-blue-500/10 text-blue-400 border-blue-500/20 whitespace-nowrap">
      {label}
    </span>
  )
}

// ── ColFilterInput ─────────────────────────────────────────────────────────────

function ColFilterInput({ filter, onChange }: {
  colKey: string; filter: ColFilter; onChange: (f: ColFilter) => void
}) {
  const cycleMode = (e: React.MouseEvent) => {
    e.stopPropagation()
    const next = MODES[(MODES.indexOf(filter.mode) + 1) % MODES.length]
    onChange({ ...filter, mode: next })
  }
  const active = filter.value.trim() !== ''
  return (
    <div
      className={`flex items-center h-6 rounded border overflow-hidden transition-colors ${active ? 'border-accent-green/50 bg-accent-green/5' : 'border-white/8 bg-white/[0.03]'}`}
      onClick={e => e.stopPropagation()}
    >
      <button onClick={cycleMode} title={`Mode: ${filter.mode}`}
        className={`flex items-center justify-center shrink-0 w-6 h-full border-r text-[9px] font-mono font-bold transition-colors select-none ${active ? 'border-accent-green/30 text-accent-green hover:bg-accent-green/10' : 'border-white/8 text-accent-muted/50 hover:text-white hover:bg-white/5'}`}>
        {MODE_LABEL[filter.mode]}
      </button>
      <input value={filter.value} onChange={e => onChange({ ...filter, value: e.target.value })}
        onClick={e => e.stopPropagation()} placeholder="filter…"
        className={`flex-1 min-w-0 px-1.5 text-[10px] bg-transparent outline-none placeholder:text-white/15 ${active ? 'text-white/90' : 'text-white/60'}`}
        style={{ height: '100%' }} />
      {active && (
        <button onClick={e => { e.stopPropagation(); onChange({ ...filter, value: '' }) }}
          className="shrink-0 pr-1 text-accent-muted/40 hover:text-severity-critical transition-colors">
          <X size={8} />
        </button>
      )}
    </div>
  )
}

// ── ColumnToggler ─────────────────────────────────────────────────────────────

function ColumnToggler({ columns, hidden, onChange }: {
  columns: string[]; hidden: string[]; onChange: (h: string[]) => void
}) {
  const [open, setOpen] = useState(false)
  const hiddenSet = new Set(hidden)
  const visibleCount = columns.length - hidden.length

  return (
    <div className="relative">
      <button onClick={() => setOpen(o => !o)}
        className={`flex items-center gap-1.5 px-2 py-1.5 rounded border text-[10px] transition-colors ${hidden.length > 0 ? 'border-accent-green/30 text-accent-green bg-accent-green/5' : 'border-white/8 text-accent-muted hover:text-white hover:border-white/20'}`}>
        <Columns3 size={10} />
        <span>{visibleCount}/{columns.length} cols</span>
        <ChevronDown size={9} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-1 z-50 bg-bg-card border border-white/10 rounded-lg shadow-xl w-64 max-h-72 overflow-y-auto py-1">
            <div className="flex items-center justify-between px-3 py-1.5 border-b border-white/5">
              <span className="text-[9px] uppercase tracking-widest text-accent-muted/40">Columns</span>
              <div className="flex gap-2">
                <button onClick={() => onChange([])} className="text-[9px] text-accent-green/60 hover:text-accent-green">All</button>
                <button onClick={() => onChange([...columns])} className="text-[9px] text-accent-muted/40 hover:text-white">None</button>
              </div>
            </div>
            {columns.map(col => (
              <label key={col} className="flex items-center gap-2.5 px-3 py-1.5 hover:bg-white/[0.03] cursor-pointer">
                <input type="checkbox" checked={!hiddenSet.has(col)}
                  onChange={e => {
                    const next = e.target.checked
                      ? hidden.filter(h => h !== col)
                      : [...hidden, col]
                    onChange(next)
                  }}
                  className="accent-accent-green w-3 h-3" />
                <span className="text-[11px] text-white/70 font-mono truncate">{col}</span>
              </label>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

// ── PaginationBar ─────────────────────────────────────────────────────────────

function PaginationBar({ page, pages, total, pageSize, onPage, onPageSize }: {
  page: number; pages: number; total: number; pageSize: number
  onPage: (p: number) => void; onPageSize: (s: number) => void
}) {
  const from = (page - 1) * pageSize + 1
  const to   = Math.min(page * pageSize, total)
  return (
    <div className="flex items-center gap-3 px-3 py-2 border-t border-white/5 bg-bg-secondary/30 shrink-0">
      <select value={pageSize} onChange={e => onPageSize(Number(e.target.value))}
        className="bg-white/5 border border-white/8 rounded px-2 py-1 text-[10px] text-accent-muted outline-none">
        {[50, 100, 200, 500].map(s => <option key={s} value={s}>{s} / page</option>)}
      </select>
      <span className="text-[10px] text-accent-muted/40">{from.toLocaleString()}–{to.toLocaleString()} of {total.toLocaleString()}</span>
      <div className="flex items-center gap-0.5 ml-auto">
        <button onClick={() => onPage(1)}        disabled={page === 1}     className="p-1 rounded text-accent-muted/40 hover:text-white disabled:opacity-20"><ChevronsLeft  size={13} /></button>
        <button onClick={() => onPage(page - 1)} disabled={page === 1}     className="p-1 rounded text-accent-muted/40 hover:text-white disabled:opacity-20"><ChevronLeft   size={13} /></button>
        {Array.from({ length: Math.min(7, pages) }, (_, i) => {
          let p: number
          if (pages <= 7)             p = i + 1
          else if (page <= 4)         p = i + 1
          else if (page >= pages - 3) p = pages - 6 + i
          else                        p = page - 3 + i
          return (
            <button key={p} onClick={() => onPage(p)}
              className={`w-6 h-6 rounded text-[10px] transition-colors ${p === page ? 'bg-accent-green/15 text-accent-green' : 'text-accent-muted/50 hover:text-white'}`}>{p}</button>
          )
        })}
        <button onClick={() => onPage(page + 1)} disabled={page === pages} className="p-1 rounded text-accent-muted/40 hover:text-white disabled:opacity-20"><ChevronRight  size={13} /></button>
        <button onClick={() => onPage(pages)}    disabled={page === pages} className="p-1 rounded text-accent-muted/40 hover:text-white disabled:opacity-20"><ChevronsRight size={13} /></button>
      </div>
    </div>
  )
}

// ── Row detail panel ──────────────────────────────────────────────────────────

function renderDetailValue(val: string): React.ReactNode {
  if (!val) return <span className="opacity-20 italic">empty</span>
  const trimmed = val.trimStart()
  if ((trimmed.startsWith('{') || trimmed.startsWith('[')) && val.trimEnd().endsWith(trimmed.startsWith('{') ? '}' : ']')) {
    try {
      const parsed = JSON.parse(val)
      return (
        <pre className="text-[10px] font-mono text-white/70 whitespace-pre-wrap break-all leading-relaxed">
          {JSON.stringify(parsed, null, 2)}
        </pre>
      )
    } catch { /* fall through */ }
  }
  return <span className="font-mono break-all">{val}</span>
}

function RowDetail({ row, columns, onClose }: {
  row: Record<string, string>; columns: string[]; onClose: () => void
}) {
  const [search, setSearch] = useState('')
  const sq = search.toLowerCase()
  const filteredCols = sq
    ? columns.filter(c => c.toLowerCase().includes(sq) || (row[c] ?? '').toLowerCase().includes(sq))
    : columns

  return (
    <div className="border-t border-white/8 bg-bg-secondary/60 px-4 py-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] font-semibold text-accent-muted/60 uppercase tracking-widest">Row Detail</span>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search size={9} className="absolute left-2 top-1/2 -translate-y-1/2 text-accent-muted/30" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="filter fields…"
              className="bg-white/5 border border-white/8 rounded pl-5 pr-3 py-0.5 text-[10px] text-white placeholder:text-accent-muted/30 outline-none focus:border-white/20 w-36 transition-colors"
            />
            {search && (
              <button onClick={() => setSearch('')} className="absolute right-1.5 top-1/2 -translate-y-1/2 text-accent-muted/40 hover:text-white">
                <X size={8} />
              </button>
            )}
          </div>
          <button onClick={onClose} className="text-accent-muted/40 hover:text-white transition-colors"><X size={13} /></button>
        </div>
      </div>
      {sq && filteredCols.length === 0 && (
        <p className="text-[10px] text-accent-muted/30 italic py-1">No fields match "{search}"</p>
      )}
      <div className="rounded border border-white/8 overflow-hidden">
        {filteredCols.map((col, i) => (
          <div key={col} className={`flex text-[11px] ${i % 2 === 0 ? 'bg-white/[0.02]' : ''}`}>
            <span className="w-52 shrink-0 px-3 py-1 text-accent-muted/50 border-r border-white/5 font-mono truncate" title={col}>{col}</span>
            <span className="flex-1 px-3 py-1 text-white/70">
              {renderDetailValue(row[col] ?? '')}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── ColResizeHandle ───────────────────────────────────────────────────────────

function ColResizeHandle({ col, onStart, onReset }: {
  col:     string
  onStart: (e: React.MouseEvent, col: string) => void
  onReset?: (col: string) => void
}) {
  return (
    <div
      className="absolute right-0 top-0 bottom-0 w-2 cursor-col-resize z-10 group/rh flex items-center justify-end"
      draggable={false}
      onMouseDown={e => { e.stopPropagation(); e.preventDefault(); onStart(e, col) }}
      onClick={e => { e.stopPropagation(); e.preventDefault() }}
      onDoubleClick={e => { e.stopPropagation(); e.preventDefault(); onReset?.(col) }}
      title="Drag to resize · Double-click to auto-fit"
    >
      <div className="w-px h-4 bg-white/10 group-hover/rh:bg-accent-green/50 transition-colors" />
    </div>
  )
}

// ── GroupByBar ────────────────────────────────────────────────────────────────

function GroupByBar({ groupByCols, onRemove, onAdd, onClear, isDragging }: {
  groupByCols: string[]
  onRemove:    (col: string) => void
  onAdd:       (col: string) => void
  onClear:     () => void
  isDragging:  boolean
}) {
  const [isOver, setIsOver] = useState(false)
  const hasGroups = groupByCols.length > 0

  return (
    <div
      className={`flex items-center gap-1.5 px-3 py-1.5 border-b shrink-0 min-h-[34px] transition-all duration-150 ${
        isOver
          ? 'border-accent-green/40 bg-accent-green/[0.06]'
          : isDragging
          ? 'border-accent-green/20 bg-accent-green/[0.02]'
          : 'border-white/5'
      }`}
      onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setIsOver(true) }}
      onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setIsOver(false) }}
      onDrop={e => {
        e.preventDefault()
        setIsOver(false)
        const col = e.dataTransfer.getData('column')
        if (col) onAdd(col)
      }}
    >
      <span className="text-[9px] text-accent-muted/30 uppercase tracking-widest shrink-0 select-none flex items-center gap-1">
        <Layers size={9} />
        Group by
      </span>

      {hasGroups && groupByCols.map((col, i) => (
        <span key={col}
          className="flex items-center gap-0.5 px-1.5 py-0.5 rounded border border-accent-green/30 bg-accent-green/[0.08] text-[10px] text-accent-green shrink-0 select-none">
          {i > 0 && <ChevronRightIcon size={8} className="text-accent-green/30 mx-0.5" />}
          <span>{col}</span>
          <button
            onClick={() => onRemove(col)}
            className="text-accent-green/40 hover:text-red-400 transition-colors ml-1">
            <X size={7} />
          </button>
        </span>
      ))}

      <span className={`text-[9px] italic select-none pointer-events-none ${
        isOver ? 'text-accent-green/60' : isDragging ? 'text-accent-green/40' : 'text-accent-muted/20'
      }`}>
        {isOver
          ? 'Release to group'
          : isDragging
          ? hasGroups ? '+ add to group' : '<- drop here to group'
          : hasGroups ? '' : 'drag a column header here'}
      </span>

      {hasGroups && (
        <button
          onClick={onClear}
          className="ml-auto text-[9px] text-accent-muted/30 hover:text-red-400 transition-colors shrink-0 flex items-center gap-0.5">
          <X size={8} /> Effacer
        </button>
      )}
    </div>
  )
}

// ── GroupRowsFetcher ──────────────────────────────────────────────────────────
// Fetches and renders rows for a single expanded leaf group inside a <tbody>.

function GroupRowsFetcher({ caseId, meta, baseFilters, groupFilters, orderedCols, colW, depth, pinnedKeys, exportedKeys, onPinToggle }: {
  caseId:       string
  meta:         CsvArtifactMeta
  baseFilters:  ArtifactRowFilters
  groupFilters: Record<string, string>
  orderedCols:  string[]
  colW:         (col: string) => number
  depth:        number
  pinnedKeys:   Set<string>
  exportedKeys: Set<string>
  onPinToggle:  (key: string, row: Record<string, string>) => void
}) {
  const [page, setPage] = useState(1)
  const PAGE_SIZE = 100

  // Merge group equality filters into existing col_filters, preserving rql
  const mergedFilters = useMemo((): ArtifactRowFilters => {
    const existing: Record<string, { mode: string; value: string }> = baseFilters.col_filters
      ? (() => { try { return JSON.parse(baseFilters.col_filters!) } catch { return {} } })()
      : {}
    const groupCF = Object.fromEntries(
      Object.entries(groupFilters).map(([k, v]) => [k, { mode: '=', value: v }])
    )
    return {
      q:           baseFilters.q,
      sort_col:    baseFilters.sort_col,
      sort_dir:    baseFilters.sort_dir ?? 'asc',
      col_filters: JSON.stringify({ ...existing, ...groupCF }),
      rql:         baseFilters.rql,
      page,
      page_size:   PAGE_SIZE,
    }
  }, [baseFilters, groupFilters, page])

  const { data, isLoading } = useQuery({
    queryKey: ['csv-group-rows', caseId, meta.id, mergedFilters],
    queryFn:  () => csvArtifactsApi.getRows(caseId, meta.id, mergedFilters),
    placeholderData: prev => prev,
  })

  const indent = depth * 20
  const colSpanAll = orderedCols.length + 1

  if (isLoading) return (
    <tr>
      <td colSpan={colSpanAll} className="px-3 py-2">
        <div className="flex items-center gap-1.5" style={{ paddingLeft: indent }}>
          <Loader2 size={10} className="animate-spin text-accent-muted/30" />
          <span className="text-[10px] text-accent-muted/30">Loading...</span>
        </div>
      </td>
    </tr>
  )

  const rows  = data?.items  ?? []
  const total = data?.total  ?? 0
  const pages = data?.pages  ?? 1

  return (
    <>
      {rows.map((row, idx) => {
        const key        = makeRowKey(meta.id, row)
        const isPinned   = pinnedKeys.has(key)
        const isExported = exportedKeys.has(key)
        return (
          <tr key={`${key}-${idx}`}
            className={`border-b border-white/[0.03] transition-colors group ${
              isPinned ? 'bg-accent-green/[0.04]' : isExported ? 'bg-blue-500/[0.02]' : 'hover:bg-white/[0.02]'
            }`}>
            <td className={`w-8 shrink-0 px-1 py-1 text-center sticky left-0 z-[4] shadow-[1px_0_0_rgba(255,255,255,0.04)] ${isPinned ? 'bg-accent-green/[0.04]' : isExported ? 'bg-blue-500/[0.02]' : 'bg-bg-primary'}`}
              onClick={e => { e.stopPropagation(); onPinToggle(key, row) }}
              title={isExported && !isPinned ? 'Exported to the Timeline' : undefined}>
              {isPinned
                ? <BookmarkCheck size={12} className="mx-auto text-accent-green/60" />
                : isExported
                  ? <BookmarkCheck size={12} className="mx-auto text-blue-400/50" />
                  : <BookmarkPlus size={12} className="mx-auto text-accent-muted/15 group-hover:text-accent-muted/40 hover:!text-accent-green transition-colors cursor-pointer" />
              }
            </td>
            {orderedCols.map((col, ci) => (
              <td key={col}
                className={`py-1 truncate text-[10px] ${col === meta.date_column ? 'font-mono text-white/40 whitespace-nowrap' : Object.keys(groupFilters).includes(col) ? 'text-white/30' : 'text-white/60'}`}
                style={{ paddingLeft: ci === 0 ? indent + 12 : 12, paddingRight: 12, width: colW(col), minWidth: 60, maxWidth: colW(col) }}
                title={row[col] ?? ''}>
                {row[col] ?? ''}
              </td>
            ))}
          </tr>
        )
      })}

      {/* Mini-pagination for this group */}
      {pages > 1 && (
        <tr>
          <td colSpan={colSpanAll} className="py-1 border-b border-white/[0.03]">
            <div className="flex items-center gap-1.5 text-[9px] text-accent-muted/40" style={{ paddingLeft: indent + 12 }}>
              <span>{total.toLocaleString()} lignes</span>
              <div className="flex items-center gap-0.5 ml-2">
                <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
                  className="p-0.5 rounded hover:text-white disabled:opacity-20"><ChevronLeft size={10} /></button>
                <span className="text-accent-green/60">{page}/{pages}</span>
                <button onClick={() => setPage(p => Math.min(pages, p + 1))} disabled={page === pages}
                  className="p-0.5 rounded hover:text-white disabled:opacity-20"><ChevronRight size={10} /></button>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  )
}

// ── RQL syntax highlighter (client-side, lightweight) ─────────────────────────

const RQL_KW_BOOL    = new Set(['AND','OR','NOT'])
const RQL_KW_OP      = new Set(['IN','BETWEEN','CONTAINS','STARTSWITH','ENDSWITH','REGEX','CIDR','LAST'])
const RQL_TOK_RE     = /("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|\b(?:AND|OR|NOT|IN|BETWEEN|CONTAINS|STARTSWITH|ENDSWITH|REGEX|CIDR|LAST|NULL|TRUE|FALSE)\b|>=|<=|!=|[><=~()*,.]+|\d+\.?\d*|[\w@][\w.\-@]*|\s+)/gi

function highlightRQL(q: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = []
  let last = 0
  for (const m of q.matchAll(RQL_TOK_RE)) {
    if (m.index! > last) nodes.push(<span key={last} className="text-red-400">{q.slice(last, m.index)}</span>)
    const tok = m[0]; const up = tok.trim().toUpperCase()
    let cls = 'text-white/80'
    if (/^["']/.test(tok))           cls = 'text-yellow-300'
    else if (/^\d/.test(tok))        cls = 'text-green-400'
    else if (RQL_KW_BOOL.has(up))    cls = 'text-purple-400 font-semibold'
    else if (RQL_KW_OP.has(up))      cls = 'text-orange-400'
    else if (up === '~')             cls = 'text-accent-green'
    else if (/^[><=!]+$/.test(tok))  cls = 'text-blue-400'
    else if (/^[(),.]+$/.test(tok))  cls = 'text-white/40'
    else if (/^[\w@]/.test(tok) && tok.trim()) cls = 'text-cyan-300'
    nodes.push(<span key={m.index} className={cls}>{tok}</span>)
    last = m.index! + tok.length
  }
  if (last < q.length) nodes.push(<span key={last} className="text-red-400">{q.slice(last)}</span>)
  return nodes
}

const RQL_EXAMPLES = [
  { label: 'Equality',       q: 'EventID = "4624"' },
  { label: 'ET / OU',        q: 'EventID = "4624" AND Channel = "Security"' },
  { label: 'Contient',       q: 'Computer contains "DC" AND CommandLine contains "powershell"' },
  { label: 'Liste IN',       q: 'EventID IN ("4624", "4625", "4648", "4768")' },
  { label: 'NOT IN',         q: 'EventID NOT IN ("4634", "4647")' },
  { label: 'Wildcard',       q: 'Computer = "DC-*" AND User = "adm?n"' },
  { label: 'Numeric range',  q: 'EventID BETWEEN 4600 AND 4700' },
  { label: 'Comparaison',    q: 'ProcessId > 1000 AND ProcessId <= 9999' },
  { label: 'Regex',          q: 'CommandLine REGEX "powershell.*-enc.*"' },
  { label: 'CIDR',           q: 'IpAddress CIDR "10.0.0.0/8"' },
  { label: 'Dernier 2h',     q: '@timestamp LAST 2 h' },
  { label: 'Full-text',      q: '~ "mimikatz"' },
  { label: 'Wildcard col',  q: '* contains "mimikatz"' },
  { label: 'Wildcard REGEX',q: '* REGEX "^\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}$"' },
  { label: 'Grouped',       q: '(EventID = "4624" OR EventID = "4625") AND NOT Computer = "WORKSTATION01"' },
]

/** Tallest the query box grows before it starts scrolling (≈6 lines). */
const RQL_MAX_HEIGHT = 120

// ── RQLBar ────────────────────────────────────────────────────────────────────

function RQLBar({ value, onChange, onRun, error, columns, hasActiveFilters }: {
  value:            string
  onChange:         (v: string) => void
  onRun:            (v: string) => void
  error:            string | null
  columns:          string[]
  hasActiveFilters: boolean
}) {
  const [showHelp, setShowHelp] = useState(false)
  const [autocomplete, setAutocomplete] = useState<string[]>([])
  const [acIndex, setAcIndex]   = useState(-1)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const mirrorRef = useRef<HTMLDivElement>(null)

  // Keep the highlight mirror glued to the textarea on both axes — past the
  // 120 px cap the textarea scrolls, and an unsynced mirror would leave the
  // visible lines unpainted (the textarea's own text is transparent).
  const syncScroll = () => {
    if (inputRef.current && mirrorRef.current) {
      mirrorRef.current.scrollTop  = inputRef.current.scrollTop
      mirrorRef.current.scrollLeft = inputRef.current.scrollLeft
    }
  }

  // Auto-height, capped — then re-sync so the mirror matches the new box
  useEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, RQL_MAX_HEIGHT) + 'px'
    syncScroll()
  }, [value])

  // Column autocomplete — show when last word looks like an identifier start
  useEffect(() => {
    if (!columns.length) return
    const before = value.slice(0, inputRef.current?.selectionStart ?? value.length)
    const lastWord = before.match(/[\w@][\w.\-@]*$/)?.[0] ?? ''
    if (lastWord.length < 1) { setAutocomplete([]); return }
    const matches = columns.filter(c => c.toLowerCase().startsWith(lastWord.toLowerCase()) && c !== lastWord)
    setAutocomplete(matches.slice(0, 8))
    setAcIndex(-1)
  }, [value, columns])

  const applyAutocomplete = (col: string) => {
    const pos = inputRef.current?.selectionStart ?? value.length
    const lastWord = value.slice(0, pos).match(/[\w@][\w.\-@]*$/)?.[0] ?? ''
    const newVal = value.slice(0, pos - lastWord.length) + col + value.slice(pos)
    onChange(newVal)
    setAutocomplete([])
    setTimeout(() => inputRef.current?.focus(), 0)
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (autocomplete.length > 0) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setAcIndex(i => Math.min(i + 1, autocomplete.length - 1)); return }
      if (e.key === 'ArrowUp')   { e.preventDefault(); setAcIndex(i => Math.max(i - 1, 0)); return }
      if (e.key === 'Tab' || e.key === 'Enter') {
        if (acIndex >= 0) { e.preventDefault(); applyAutocomplete(autocomplete[acIndex]); return }
        if (e.key === 'Tab') { e.preventDefault(); applyAutocomplete(autocomplete[0]); return }
      }
      if (e.key === 'Escape') { setAutocomplete([]); return }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      onRun(value)
    }
  }

  const highlighted = useMemo(() => highlightRQL(value), [value])

  return (
    <div className="border-b border-white/5 bg-bg-secondary/20 shrink-0">
      {/* Bar header */}
      <div className="flex items-center gap-2 px-3 pt-2 pb-1">
        <Terminal size={10} className="text-accent-green/60 shrink-0" />
        <span className="text-[9px] font-semibold uppercase tracking-widest text-accent-green/60">RQL Query</span>
        <span className="text-[8px] text-accent-muted/25 ml-1">Enter to run - Tab to complete</span>
        <div className="ml-auto flex items-center gap-1">
          {value && (
            <button onClick={() => { onChange(''); onRun('') }}
              className="p-1 text-accent-muted/30 hover:text-white transition-colors" title="Effacer">
              <X size={10} />
            </button>
          )}
          <button onClick={() => setShowHelp(h => !h)}
            className={`p-1 transition-colors ${showHelp ? 'text-accent-green' : 'text-accent-muted/40 hover:text-white'}`}
            title="Exemples">
            <HelpCircle size={12} />
          </button>
        </div>
      </div>

      {/* Input area with syntax-highlight overlay.
          The mirror paints the colours and the textarea's own glyphs are
          transparent, so both boxes must wrap identically — same padding, same
          1 px border, same `pre-wrap`. A `whitespace-pre` mirror is exactly why
          a query wrapping onto a second line used to render invisible. */}
      <div className="relative mx-3 mb-2 rounded bg-white/[0.04]">
        {/* Mirror div for syntax highlighting */}
        <div ref={mirrorRef} aria-hidden
          className="absolute inset-0 px-2.5 py-1.5 font-mono text-[11px] leading-relaxed overflow-hidden pointer-events-none select-none border border-transparent rounded"
          style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', overflowWrap: 'anywhere' }}>
          {value ? highlighted : null}
        </div>
        {/* Actual textarea */}
        <textarea
          ref={inputRef}
          value={value}
          onChange={e => { onChange(e.target.value); syncScroll() }}
          onKeyDown={handleKeyDown}
          onScroll={syncScroll}
          placeholder='EventID = "4624" AND Computer contains "DC" ...'
          rows={1}
          className={`rql-input relative w-full resize-none font-mono text-[11px] leading-relaxed bg-transparent border rounded px-2.5 py-1.5 outline-none transition-colors placeholder:text-accent-muted/20 overflow-y-auto overflow-x-hidden
            ${error ? 'border-red-500/40 text-transparent caret-red-400' : value ? 'border-accent-green/25 text-transparent caret-white' : 'border-white/8 text-white/80'}`}
          style={{
            minHeight:    32,
            maxHeight:    RQL_MAX_HEIGHT,
            whiteSpace:   'pre-wrap',
            wordBreak:    'break-word',
            overflowWrap: 'anywhere',
          }}
          spellCheck={false}
        />

        {/* Autocomplete dropdown */}
        {autocomplete.length > 0 && (
          <div className="absolute left-0 top-full mt-0.5 z-50 bg-bg-card border border-white/12 rounded-lg shadow-xl overflow-hidden min-w-[160px]">
            {autocomplete.map((col, i) => (
              <button key={col} onClick={() => applyAutocomplete(col)}
                className={`flex items-center gap-2 w-full px-3 py-1.5 text-left text-[11px] font-mono transition-colors ${i === acIndex ? 'bg-accent-green/10 text-accent-green' : 'text-white/70 hover:bg-white/5'}`}>
                <span className="text-[8px] text-accent-muted/30 font-sans">col</span>
                {col}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="flex items-center gap-1.5 mx-3 mb-2 px-2 py-1 rounded bg-red-500/10 border border-red-500/20 text-[10px] text-red-400">
          <AlertCircle size={10} className="shrink-0" />
          {error}
        </div>
      )}

      {/* Warning: column filters + RQL are ANDed — can narrow OR results unexpectedly */}
      {value && hasActiveFilters && !error && (
        <div className="flex items-center gap-1.5 mx-3 mb-2 px-2 py-1 rounded bg-yellow-500/8 border border-yellow-500/20 text-[10px] text-yellow-400/80">
          <AlertCircle size={10} className="shrink-0" />
          Column filters are active and apply as AND alongside the RQL query - OR results may be narrowed.
        </div>
      )}

      {/* Help / examples panel */}
      {showHelp && (
        <div className="mx-3 mb-2 border border-white/8 rounded-lg overflow-hidden">
          <div className="px-3 py-1.5 bg-white/[0.02] border-b border-white/5">
            <p className="text-[9px] uppercase tracking-widest text-accent-muted/40">Query examples - click to insert</p>
          </div>
          <div className="grid grid-cols-2 gap-0 max-h-52 overflow-y-auto">
            {RQL_EXAMPLES.map(ex => (
              <button key={ex.q} onClick={() => { onChange(ex.q); onRun(ex.q); setShowHelp(false) }}
                className="flex flex-col items-start px-3 py-2 hover:bg-white/[0.04] transition-colors border-b border-r border-white/[0.04] text-left">
                <span className="text-[8px] text-accent-muted/40 uppercase tracking-wider">{ex.label}</span>
                <span className="text-[9px] font-mono text-accent-green/70 mt-0.5 truncate w-full">{ex.q}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ── File type detection ────────────────────────────────────────────────────────

type ArtifactFileType = 'csv' | 'txt' | 'json' | 'evtx' | 'eml'

function getFileType(name: string): ArtifactFileType {
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  if (ext === 'evtx')           return 'evtx'
  if (ext === 'eml')            return 'eml'
  if (ext === 'json')           return 'json'
  if (ext === 'txt' || ext === 'log') return 'txt'
  return 'csv'
}

// ── Redirect banner for EVTX / EML ────────────────────────────────────────────

function ArtifactRedirectView({ meta, caseId, type }: { meta: CsvArtifactMeta; caseId: string; type: 'evtx' | 'eml' }) {
  const navigate = useNavigate()
  const { setCurrentCase } = useCurrentCase()
  const isEvtx = type === 'evtx'
  const dest   = isEvtx ? '/artifacts/filesystem' : '/artifacts/email'
  const label  = isEvtx ? 'Module Logs / EVTX' : 'Email Analysis'
  const icon   = isEvtx ? '🗂️' : '📧'
  const color  = isEvtx ? 'text-orange-400 bg-orange-500/8 border-orange-500/20' : 'text-blue-400 bg-blue-500/8 border-blue-500/20'
  const hint   = isEvtx
    ? 'This EVTX file was registered in the Logs module. Open the Logs page to review it and run Chainsaw.'
    : 'This EML file was registered in the Email Analysis module. Open the Email Analysis page to analyse it.'
  return (
    <div className="flex flex-col items-center justify-center h-full gap-6 px-8">
      <div className="text-5xl opacity-60">{icon}</div>
      <div className={`flex flex-col items-center gap-3 text-center max-w-md p-6 rounded-xl border ${color}`}>
        <p className="text-sm font-medium">{meta.original_name}</p>
        <p className="text-xs text-accent-muted/60 leading-relaxed">{hint}</p>
        <button
          onClick={() => { setCurrentCase({ id: caseId, title: '' }); navigate(dest) }}
          className="mt-2 px-4 py-2 rounded-lg text-xs font-medium bg-white/[0.05] border border-white/15 hover:bg-white/[0.08] transition-colors"
        >
          Ouvrir {label} →
        </button>
      </div>
    </div>
  )
}

// ── TXT / LOG viewer ───────────────────────────────────────────────────────────

function TextArtifactView({ meta, caseId }: { meta: CsvArtifactMeta; caseId: string }) {
  const [search, setSearch] = useState('')
  const { data, isLoading } = useQuery({
    queryKey: ['artifact-raw', caseId, meta.id],
    queryFn:  () => csvArtifactsApi.getRaw(caseId, meta.id),
    staleTime: 60_000,
  })

  const lines = useMemo(() => {
    const raw = data?.content ?? ''
    const all = raw.split('\n')
    if (!search.trim()) return all
    const q = search.toLowerCase()
    return all.filter(l => l.toLowerCase().includes(q))
  }, [data?.content, search])

  if (isLoading) {
    return <div className="flex items-center justify-center h-full text-accent-muted/30 text-sm animate-pulse">Loading...</div>
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center gap-3 px-4 py-2.5 border-b border-white/5 shrink-0 bg-bg-secondary/30">
        <FileText size={13} className="text-accent-muted/40" />
        <span className="text-xs font-medium text-white/70 flex-1 truncate font-mono">{meta.original_name}</span>
        <div className="relative">
          <Search size={11} className="absolute left-2 top-1/2 -translate-y-1/2 text-accent-muted/30" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Filter rows..."
            className="bg-white/5 border border-white/10 rounded pl-6 pr-3 py-1 text-[11px] text-white placeholder:text-accent-muted/30 outline-none focus:border-white/20 w-52"
          />
        </div>
        <span className="text-[10px] text-accent-muted/30 shrink-0">{lines.length.toLocaleString()} lignes</span>
      </div>
      <div className="flex-1 overflow-y-auto overflow-x-auto font-mono text-[11px] text-white/65 leading-5 px-4 py-3 bg-bg-primary">
        {lines.map((line, i) => (
          <div key={i} className="flex gap-3 hover:bg-white/[0.02] rounded px-1 group">
            <span className="text-accent-muted/20 select-none w-10 text-right shrink-0">{i + 1}</span>
            <span className="break-all">{line || ' '}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── JSON viewer ───────────────────────────────────────────────────────────────

function JsonNode({ data, depth = 0 }: { data: unknown; depth?: number }) {
  const [open, setOpen] = useState(depth < 2)
  if (data === null) return <span className="text-accent-muted/40">null</span>
  if (typeof data === 'boolean') return <span className="text-purple-300">{String(data)}</span>
  if (typeof data === 'number')  return <span className="text-blue-300">{String(data)}</span>
  if (typeof data === 'string')  return <span className="text-accent-green/80">"{data}"</span>

  const isArr = Array.isArray(data)
  const entries = isArr
    ? (data as unknown[]).map((v, i) => [String(i), v] as [string, unknown])
    : Object.entries(data as Record<string, unknown>)

  if (entries.length === 0) return <span className="text-accent-muted/30">{isArr ? '[]' : '{}'}</span>

  const bracket = isArr ? ['[', ']'] : ['{', '}']
  const indent  = depth * 16

  return (
    <span>
      <button onClick={() => setOpen(o => !o)} className="text-accent-muted/40 hover:text-white transition-colors font-mono">
        {open ? '▾' : '▸'}
      </button>
      <span className="text-accent-muted/30 ml-0.5">{bracket[0]}</span>
      {!open && (
        <span className="text-accent-muted/30 cursor-pointer hover:text-white" onClick={() => setOpen(true)}>
          {' '}…{entries.length}{' '}
        </span>
      )}
      {open && (
        <span>
          {entries.map(([k, v]) => (
            <div key={k} style={{ paddingLeft: indent + 16 }}>
              {!isArr && <span className="text-cyan-300/70">"{k}"</span>}
              {!isArr && <span className="text-accent-muted/30">: </span>}
              <JsonNode data={v} depth={depth + 1} />
              <span className="text-accent-muted/20">,</span>
            </div>
          ))}
          <div style={{ paddingLeft: indent }}><span className="text-accent-muted/30">{bracket[1]}</span></div>
        </span>
      )}
      {!open && <span className="text-accent-muted/30">{bracket[1]}</span>}
    </span>
  )
}

function JsonArtifactView({ meta, caseId }: { meta: CsvArtifactMeta; caseId: string }) {
  const [search, setSearch] = useState('')
  const [mode, setMode]     = useState<'tree' | 'raw'>('tree')
  const { data, isLoading } = useQuery({
    queryKey: ['artifact-raw', caseId, meta.id],
    queryFn:  () => csvArtifactsApi.getRaw(caseId, meta.id),
    staleTime: 60_000,
  })

  const parsed = useMemo(() => {
    if (!data?.content) return null
    try { return JSON.parse(data.content) }
    catch { return null }
  }, [data?.content])

  const rawLines = useMemo(() => {
    if (!data?.content) return []
    const all = data.content.split('\n')
    if (!search.trim()) return all
    const q = search.toLowerCase()
    return all.filter(l => l.toLowerCase().includes(q))
  }, [data?.content, search])

  if (isLoading) {
    return <div className="flex items-center justify-center h-full text-accent-muted/30 text-sm animate-pulse">Loading...</div>
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center gap-3 px-4 py-2.5 border-b border-white/5 shrink-0 bg-bg-secondary/30">
        <FileText size={13} className="text-accent-muted/40" />
        <span className="text-xs font-medium text-white/70 flex-1 truncate font-mono">{meta.original_name}</span>
        {mode === 'raw' && (
          <div className="relative">
            <Search size={11} className="absolute left-2 top-1/2 -translate-y-1/2 text-accent-muted/30" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Filter rows..."
              className="bg-white/5 border border-white/10 rounded pl-6 pr-3 py-1 text-[11px] text-white placeholder:text-accent-muted/30 outline-none focus:border-white/20 w-52"
            />
          </div>
        )}
        <div className="flex rounded border border-white/10 overflow-hidden">
          <button onClick={() => setMode('tree')} className={`text-[10px] px-2 py-1 transition-colors ${mode === 'tree' ? 'bg-accent-green/10 text-accent-green' : 'text-accent-muted hover:text-white'}`}>Tree</button>
          <button onClick={() => setMode('raw')}  className={`text-[10px] px-2 py-1 transition-colors ${mode === 'raw'  ? 'bg-accent-green/10 text-accent-green' : 'text-accent-muted hover:text-white'}`}>Raw</button>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto overflow-x-auto font-mono text-[11px] px-4 py-3 bg-bg-primary">
        {mode === 'tree' ? (
          parsed !== null
            ? <JsonNode data={parsed} depth={0} />
            : <p className="text-red-400/60 text-xs">Invalid JSON - cannot parse the file.</p>
        ) : (
          rawLines.map((line, i) => (
            <div key={i} className="flex gap-3 hover:bg-white/[0.02] rounded px-1">
              <span className="text-accent-muted/20 select-none w-10 text-right shrink-0">{i + 1}</span>
              <span className="text-white/65 break-all">{line || ' '}</span>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

// ── ArtifactTableView ─────────────────────────────────────────────────────────

function ArtifactTableView({ caseId, meta, state, onStateChange, pinnedKeys, exportedKeys, onPinToggle }: {
  caseId:        string
  meta:          CsvArtifactMeta
  state:         TabState
  onStateChange: (patch: Partial<TabState>) => void
  pinnedKeys:    Set<string>
  exportedKeys:  Set<string>
  onPinToggle:   (key: string, row: Record<string, string>) => void
}) {
  const [expandedRow,    setExpandedRow]    = useState<string | null>(null)
  const [showFilters,    setShowFilters]    = useState(false)
  const [localSearch,    setLocalSearch]    = useState(state.filters.q ?? '')
  const [draggingCol,    setDraggingCol]    = useState<string | null>(null)
  const [dragOverCol,    setDragOverCol]    = useState<string | null>(null)
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set())
  const [localRql,       setLocalRql]       = useState(state.rql ?? '')
  const [rqlError,       setRqlError]       = useState<string | null>(null)
  const rqlTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const colDebounce = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingCols = useRef<ColFilters>({})

  // ── Column resize ─────────────────────────────────────────────────────────
  const colResizing  = useRef<{ col: string; startX: number; startW: number } | null>(null)
  const colWidthsRef = useRef<Record<string, number>>(state.colWidths ?? {})
  const onStateRef   = useRef(onStateChange)
  const rowsRef      = useRef<Record<string, string>[]>([])
  useEffect(() => { onStateRef.current   = onStateChange }, [onStateChange])
  useEffect(() => { colWidthsRef.current = state.colWidths ?? {} }, [state.colWidths])

  const startColResize = useCallback((e: React.MouseEvent, col: string) => {
    const defaultW = col === meta.date_column ? 168 : 160
    const startW   = (state.colWidths ?? {})[col] ?? defaultW
    colResizing.current = { col, startX: e.clientX, startW }
    document.body.style.cursor     = 'col-resize'
    document.body.style.userSelect = 'none'
  }, [state.colWidths, meta.date_column])

  const resetColWidth = useCallback((col: string) => {
    // Auto-fit: measure header + visible row content, pick max
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')
    if (ctx) ctx.font = '11px ui-sans-serif, system-ui, sans-serif'
    const measure = (text: string) => ctx ? ctx.measureText(text).width : text.length * 7
    const headerW = measure(col)
    const maxDataW = rowsRef.current.reduce((max, row) => {
      const w = measure(String(row[col] ?? ''))
      return w > max ? w : max
    }, 0)
    const fitted = Math.min(600, Math.max(80, Math.max(headerW, maxDataW) + 28))
    onStateChange({ colWidths: { ...colWidthsRef.current, [col]: fitted } })
  }, [onStateChange])

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!colResizing.current) return
      const { col, startX, startW } = colResizing.current
      const newW = Math.max(60, startW + e.clientX - startX)
      onStateRef.current({ colWidths: { ...colWidthsRef.current, [col]: newW } })
    }
    const onUp = () => {
      if (colResizing.current) {
        colResizing.current            = null
        document.body.style.cursor    = ''
        document.body.style.userSelect = ''
      }
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup',   onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup',   onUp)
    }
  }, [])

  const colW = (col: string) =>
    (state.colWidths ?? {})[col] ?? (col === meta.date_column ? 168 : 160)

  // ── Regular paginated fetch ───────────────────────────────────────────────
  const groupByCols = useMemo(() =>
    (state.groupByCols ?? []),
    [state.groupByCols]
  )
  const groupActive = groupByCols.length > 0

  const activeFilters = useMemo(() => ({
    ...state.filters,
    rql: state.rql || undefined,
  }), [state.filters, state.rql])

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['csv-rows', caseId, meta.id, activeFilters],
    queryFn:  () => csvArtifactsApi.getRows(caseId, meta.id, activeFilters),
    placeholderData: prev => prev,
    enabled: !groupActive,
  })

  // ── GROUP BY fetch — server-side aggregation, no row limit ───────────────
  const { data: groupData, isLoading: groupLoading, isFetching: groupFetching } = useQuery({
    queryKey: ['csv-groups', caseId, meta.id, groupByCols, state.filters.q, state.filters.col_filters, state.rql],
    queryFn:  () => csvArtifactsApi.getGroups(caseId, meta.id, groupByCols, {
      q:           state.filters.q,
      col_filters: state.filters.col_filters,
      rql:         state.rql || undefined,
    }),
    placeholderData: prev => prev,
    enabled: groupActive,
  })

  const rows    = data?.items   ?? []
  const total   = data?.total   ?? 0
  const pages   = data?.pages   ?? 1
  const allCols = data?.columns ?? meta.columns
  useEffect(() => { rowsRef.current = rows }, [rows])

  // ── Column ordering ───────────────────────────────────────────────────────
  const hiddenSet   = useMemo(() => new Set(state.hiddenCols), [state.hiddenCols])
  const visibleCols = useMemo(() => allCols.filter(c => !hiddenSet.has(c)), [allCols, hiddenSet])

  // validGroupCols must be declared before orderedCols (used to exclude grouped cols)
  const validGroupCols = useMemo(() =>
    groupByCols.filter(c => allCols.includes(c)),
    [groupByCols, allCols]
  )

  const groupedSet = useMemo(() => new Set(validGroupCols), [validGroupCols])

  const orderedCols = useMemo(() => {
    // When grouping is active, exclude grouped columns from the row display —
    // their values are already shown in the group header rows.
    const baseCols = groupActive
      ? visibleCols.filter(c => !groupedSet.has(c))
      : visibleCols
    if (!state.colOrder?.length) return baseCols
    const inOrder = state.colOrder.filter(c => baseCols.includes(c))
    const rest    = baseCols.filter(c => !inOrder.includes(c))
    // Deduplicate defensively (guards against stale localStorage state)
    return [...new Set([...inOrder, ...rest])]
  }, [visibleCols, state.colOrder, groupActive, groupedSet])

  // ── Search-term highlight (orange) ───────────────────────────────────────
  const highlightQuery = (state.filters.q ?? '').toLowerCase()
  const highlightCell = useMemo(() => (text: string): React.ReactNode => {
    if (!highlightQuery || text === '') return text
    const idx = text.toLowerCase().indexOf(highlightQuery)
    if (idx === -1) return text
    return (
      <>
        {text.slice(0, idx)}
        <mark style={{ background: 'rgba(251,146,60,0.28)', color: '#fb923c', borderRadius: 2, padding: '0 1px' }}>
          {text.slice(idx, idx + highlightQuery.length)}
        </mark>
        {text.slice(idx + highlightQuery.length)}
      </>
    )
  }, [highlightQuery])

  // ── Grouped flat list ─────────────────────────────────────────────────────

  const backendGroups = groupData?.groups ?? []

  const flatItems = useMemo(() =>
    groupActive && !groupLoading
      ? buildGroupTree(backendGroups, validGroupCols, expandedGroups)
      : null,
    [backendGroups, validGroupCols, expandedGroups, groupActive, groupLoading]
  )

  const toggleGroup = useCallback((key: string) => {
    setExpandedGroups(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [])

  // All group keys present in the current flat list (for expand/collapse all)
  const allGroupKeys = useMemo(() =>
    flatItems
      ? new Set(flatItems.filter((i): i is Extract<FlatItem, { type: 'group' }> => i.type === 'group').map(i => i.key))
      : new Set<string>(),
    [flatItems]
  )

  const allExpanded = allGroupKeys.size > 0 && allGroupKeys.size === expandedGroups.size

  const toggleAllGroups = useCallback(() => {
    if (allExpanded) {
      setExpandedGroups(new Set())
    } else {
      // Collect all group keys recursively from backend groups
      const allKeys = new Set<string>()
      function collectKeys(groups: GroupResult[], cols: string[], depth: number, prefix: string) {
        if (depth >= cols.length) return
        const col = cols[depth]
        const byVal = new Map<string, GroupResult[]>()
        for (const g of groups) {
          const val = g.values[col] ?? ''
          if (!byVal.has(val)) byVal.set(val, [])
          byVal.get(val)!.push(g)
        }
        for (const [val, sub] of byVal) {
          const key = `${prefix}\x1f${val}`
          allKeys.add(key)
          collectKeys(sub, cols, depth + 1, key)
        }
      }
      collectKeys(backendGroups, validGroupCols, 0, '')
      setExpandedGroups(allKeys)
    }
  }, [allExpanded, backendGroups, validGroupCols])

  // Reset expanded groups when group columns change
  const groupColsKey = groupByCols.join(',')
  useEffect(() => {
    setExpandedGroups(new Set())
  }, [groupColsKey])

  // ── RQL handlers ──────────────────────────────────────────────────────────
  const handleRqlChange = useCallback((val: string) => {
    setLocalRql(val)
    setRqlError(null)
    if (rqlTimer.current) clearTimeout(rqlTimer.current)
    if (!val.trim()) {
      onStateChange({ rql: '' })
      return
    }
    // Debounce 600ms
    rqlTimer.current = setTimeout(() => {
      onStateChange({ rql: val, filters: { ...state.filters, page: 1 } })
    }, 600)
  }, [onStateChange, state.filters])

  const handleRqlRun = useCallback((val: string) => {
    if (rqlTimer.current) clearTimeout(rqlTimer.current)
    setLocalRql(val)
    setRqlError(null)
    onStateChange({ rql: val, filters: { ...state.filters, page: 1 } })
  }, [onStateChange, state.filters])

  // Propagate backend RQL errors to the bar
  useEffect(() => {
    const err = (data as any)?.detail?.rql_error ?? (groupData as any)?.detail?.rql_error
    if (err) setRqlError(err)
  }, [data, groupData])

  // ── Column drag handlers ──────────────────────────────────────────────────
  const handleColDragStart = useCallback((e: React.DragEvent, col: string) => {
    if (colResizing.current) { e.preventDefault(); return }
    setDraggingCol(col)
    e.dataTransfer.setData('column', col)
    e.dataTransfer.effectAllowed = 'move'
  }, [])

  const handleColDragOver = useCallback((e: React.DragEvent, col: string) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDragOverCol(col)
  }, [])

  const handleColDrop = useCallback((e: React.DragEvent, targetCol: string) => {
    e.preventDefault()
    const srcCol = e.dataTransfer.getData('column')
    if (!srcCol || srcCol === targetCol) { setDragOverCol(null); return }
    const newOrder = [...orderedCols]
    const srcIdx   = newOrder.indexOf(srcCol)
    const tgtIdx   = newOrder.indexOf(targetCol)
    if (srcIdx !== -1 && tgtIdx !== -1) {
      newOrder.splice(srcIdx, 1)
      newOrder.splice(tgtIdx, 0, srcCol)
    }
    onStateChange({ colOrder: newOrder })
    setDragOverCol(null)
    setDraggingCol(null)
  }, [orderedCols, onStateChange])

  const handleColDragEnd = useCallback(() => {
    setDraggingCol(null)
    setDragOverCol(null)
  }, [])

  // ── Filter helpers ────────────────────────────────────────────────────────
  const updateFilters = useCallback((patch: Partial<ArtifactRowFilters>) => {
    onStateChange({ filters: { ...state.filters, ...patch } })
    setExpandedRow(null)
  }, [state.filters, onStateChange])

  const handleSearch = (val: string) => {
    setLocalSearch(val)
    if (searchTimer.current) clearTimeout(searchTimer.current)
    searchTimer.current = setTimeout(() => {
      updateFilters({ q: val || undefined, page: 1 })
    }, 400)
  }

  const handleColFilterChange = useCallback((col: string, cf: ColFilter) => {
    const next = { ...pendingCols.current, [col]: cf }
    Object.keys(next).forEach(k => { if (!next[k].value.trim()) delete next[k] })
    pendingCols.current = next
    onStateChange({ colFilters: next })
    if (colDebounce.current) clearTimeout(colDebounce.current)
    colDebounce.current = setTimeout(() => {
      const active = Object.fromEntries(Object.entries(pendingCols.current).filter(([, f]) => f.value.trim()))
      updateFilters({ col_filters: Object.keys(active).length ? JSON.stringify(active) : undefined, page: 1 })
    }, 350)
  }, [onStateChange, updateFilters])

  const handleSort = (col: string) => {
    if (state.filters.sort_col === col) {
      updateFilters({ sort_dir: state.filters.sort_dir === 'asc' ? 'desc' : 'asc', page: 1 })
    } else {
      updateFilters({ sort_col: col, sort_dir: 'asc', page: 1 })
    }
  }

  const handleReset = () => {
    setLocalSearch('')
    pendingCols.current = {}
    onStateChange({ filters: { page: 1, page_size: state.filters.page_size ?? 100, sort_dir: 'asc' }, colFilters: {} })
  }

  const handlePin = (row: Record<string, string>) => {
    onPinToggle(makeRowKey(meta.id, row), row)
  }

  // ── Export filtered CSV ────────────────────────────────────────────────────
  const handleExport = async () => {
    const { q, col_filters, sort_col, sort_dir } = state.filters
    const all = await csvArtifactsApi.getAllRows(caseId, meta.id, { q, col_filters, sort_col, sort_dir, rql: state.rql || undefined })
    const header = allCols.join(',')
    const csvRows = all.items.map(r => allCols.map(c => `"${(r[c] ?? '').replace(/"/g, '""')}"`).join(','))
    const blob = new Blob([[header, ...csvRows].join('\n')], { type: 'text/csv' })
    const url  = URL.createObjectURL(blob)
    Object.assign(document.createElement('a'), {
      href: url, download: meta.original_name,
    }).click()
    URL.revokeObjectURL(url)
  }

  const activeColCount = Object.values(state.colFilters).filter(f => f.value.trim()).length
  const activeTotal    = activeColCount + (state.filters.q ? 1 : 0)
  const defaultSort    = meta.date_column
  const sortCol        = state.filters.sort_col ?? defaultSort

  const isAnythingLoading  = groupActive ? groupLoading  : isLoading
  const isAnythingFetching = groupActive ? groupFetching : isFetching

  return (
    <div className="flex flex-col h-full">

      {/* ── RQL Query Bar ───────────────────────────────────────────────── */}
      <RQLBar
        value={localRql}
        onChange={handleRqlChange}
        onRun={handleRqlRun}
        error={rqlError}
        columns={allCols}
        hasActiveFilters={activeColCount > 0 || !!state.filters.q}
      />

      {/* ── Group-by drop zone ──────────────────────────────────────────── */}
      <GroupByBar
        groupByCols={validGroupCols}
        onRemove={col => onStateChange({ groupByCols: groupByCols.filter(c => c !== col) })}
        onAdd={col => {
          if (!groupByCols.includes(col)) onStateChange({ groupByCols: [...groupByCols, col] })
        }}
        onClear={() => onStateChange({ groupByCols: [] })}
        isDragging={draggingCol !== null}
      />

      {/* ── Toolbar ─────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-white/5 bg-bg-secondary/30 shrink-0 flex-wrap">
        <div className="relative flex-1 min-w-[160px] max-w-xs">
          <Search size={11} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-accent-muted/30" />
          <input value={localSearch} onChange={e => handleSearch(e.target.value)}
            placeholder="Search all columns…"
            className="w-full bg-white/5 border border-white/8 rounded pl-7 pr-3 py-1.5 text-[11px] text-white placeholder:text-accent-muted/30 outline-none focus:border-accent-green/30 transition-colors" />
          {localSearch && (
            <button onClick={() => { setLocalSearch(''); updateFilters({ q: undefined, page: 1 }) }}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-accent-muted/40 hover:text-white"><X size={10} /></button>
          )}
        </div>

        {!groupActive && (
          <button onClick={() => updateFilters({ sort_dir: state.filters.sort_dir === 'asc' ? 'desc' : 'asc', page: 1 })}
            className="flex items-center gap-1 px-2 py-1.5 rounded border border-white/8 text-[10px] text-accent-muted hover:text-white hover:border-white/20 transition-colors" title="Toggle sort direction">
            {state.filters.sort_dir === 'asc' ? <ArrowUp size={10} /> : <ArrowDown size={10} />}
            <span>{state.filters.sort_dir === 'asc' ? 'Oldest first' : 'Newest first'}</span>
          </button>
        )}

        <button onClick={() => setShowFilters(s => !s)}
          className={`flex items-center gap-1 px-2 py-1.5 rounded border text-[10px] transition-colors ${activeTotal > 0 ? 'border-accent-green/30 text-accent-green bg-accent-green/5' : 'border-white/8 text-accent-muted hover:text-white hover:border-white/20'}`}>
          <SlidersHorizontal size={10} />
          Filters {activeTotal > 0 && `(${activeTotal})`}
          <ChevronDown size={9} className={`transition-transform ${showFilters ? 'rotate-180' : ''}`} />
        </button>

        {activeTotal > 0 && (
          <button onClick={handleReset} className="text-[10px] text-accent-muted/50 hover:text-severity-critical transition-colors">Reset</button>
        )}

        <ColumnToggler columns={allCols} hidden={state.hiddenCols}
          onChange={h => onStateChange({ hiddenCols: h })} />

        {groupActive && !groupLoading && (
          <button onClick={toggleAllGroups}
            className="flex items-center gap-1 px-2 py-1.5 rounded border border-white/8 text-[10px] text-accent-muted hover:text-white hover:border-white/20 transition-colors">
            {allExpanded
              ? <><ChevronsLeft size={10} className="rotate-90" /> Replier tout</>
              : <><ChevronsRight size={10} className="rotate-90" /> Expand all</>
            }
          </button>
        )}

        {state.colOrder?.length > 0 && (
          <button onClick={() => onStateChange({ colOrder: [] })}
            className="text-[10px] text-accent-muted/40 hover:text-white border border-white/8 px-2 py-1.5 rounded transition-colors">
            Reset order
          </button>
        )}

        <button onClick={handleExport} title="Export filtered CSV"
          className="flex items-center gap-1 px-2 py-1.5 rounded border border-white/8 text-[10px] text-accent-muted hover:text-white hover:border-white/20 transition-colors">
          <Download size={10} /> Export
        </button>

        <div className="ml-auto text-[10px] text-accent-muted/40 whitespace-nowrap">
          {groupActive
            ? <><span className="text-white/60">{(groupData?.total_groups ?? 0).toLocaleString()}</span> groupes · {meta.row_count.toLocaleString()} lignes</>
            : total < meta.row_count
            ? <><span className="text-white/60">{total.toLocaleString()}</span> / {meta.row_count.toLocaleString()} rows</>
            : <><span className="text-white/60">{total.toLocaleString()}</span> rows</>
          }
        </div>
      </div>

      {/* Refetch progress bar */}
      <div className={`h-0.5 shrink-0 overflow-hidden transition-opacity duration-150 ${isAnythingFetching && !isAnythingLoading ? 'opacity-100' : 'opacity-0'}`}>
        <div className="h-full bg-accent-green/50 animate-[shimmer_1.4s_ease-in-out_infinite]"
          style={{ background: 'linear-gradient(90deg, transparent 0%, #2DD4BF 40%, #2DD4BF 60%, transparent 100%)', backgroundSize: '200% 100%', animation: 'shimmer 1.4s ease-in-out infinite' }} />
      </div>


      {/* Table area */}
      <div className={`flex-1 overflow-auto relative transition-opacity duration-150 ${isAnythingFetching && !isAnythingLoading ? 'opacity-50' : 'opacity-100'}`}>
        <table className="w-full border-collapse text-[11px]"
          style={{ minWidth: Math.max(800, orderedCols.length * 160 + 32) + 'px' }}>
          <thead className="sticky top-0 z-10 bg-bg-secondary">
            {/* Column name row */}
            <tr className="border-b border-white/8">
              <th className="w-8 shrink-0 px-1 pt-2 pb-1 sticky left-0 z-[12] bg-bg-secondary after:content-[''] after:absolute after:right-0 after:top-0 after:bottom-0 after:w-px after:bg-white/8" />
              {orderedCols.map(col => {
                const isSort    = sortCol === col && !groupActive
                const w         = colW(col)
                const isDragSrc = draggingCol === col
                const isDragTgt = dragOverCol === col && draggingCol !== col
                return (
                  <th key={col}
                    draggable
                    onDragStart={e => handleColDragStart(e, col)}
                    onDragOver={e => handleColDragOver(e, col)}
                    onDrop={e => handleColDrop(e, col)}
                    onDragEnd={handleColDragEnd}
                    onClick={() => { if (!groupActive) handleSort(col) }}
                    className={`relative px-3 pt-2 pb-1 text-left font-medium text-[9px] uppercase tracking-widest whitespace-nowrap transition-colors select-none
                      ${groupActive ? 'cursor-grab active:cursor-grabbing text-accent-muted/40' : 'cursor-pointer hover:text-white/60 text-accent-muted/40'}
                      ${isDragSrc ? 'opacity-40' : ''}
                      ${isDragTgt ? 'border-l-2 border-l-accent-green/60' : ''}
                    `}
                    style={{ width: w, minWidth: 60 }}>
                    <span className="flex items-center gap-1 pr-2">
                      <GripVertical size={8} className="text-accent-muted/20 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
                      {col}
                      {isSort && (state.filters.sort_dir === 'asc' ? <ArrowUp size={9} className="text-accent-green" /> : <ArrowDown size={9} className="text-accent-green" />)}
                    </span>
                    <ColResizeHandle col={col} onStart={startColResize} onReset={resetColWidth} />
                  </th>
                )
              })}
            </tr>
            {/* Per-column filter row */}
            {showFilters && (
              <tr className="border-b border-white/5 bg-bg-secondary/80">
                <th className="w-8 shrink-0 px-1 py-1.5 sticky left-0 z-[12] bg-bg-secondary/80" />
                {orderedCols.map(col => (
                  <th key={`${col}-f`} className="px-2 py-1.5" style={{ width: colW(col), minWidth: 60 }}>
                    <ColFilterInput colKey={col}
                      filter={state.colFilters[col] ?? { mode: 'contains', value: '' }}
                      onChange={cf => handleColFilterChange(col, cf)} />
                  </th>
                ))}
              </tr>
            )}
          </thead>

          <tbody>
            {/* Loading skeleton */}
            {isAnythingLoading && Array.from({ length: 8 }).map((_, i) => (
              <tr key={i} className="border-b border-white/[0.04]">
                <td className="w-8 px-1 py-2 sticky left-0 z-[4] bg-bg-primary" />
                {orderedCols.map(col => (
                  <td key={col} className="px-3 py-2">
                    <div className="h-3 rounded bg-white/5 animate-pulse" style={{ width: `${45 + (i * 11) % 40}%` }} />
                  </td>
                ))}
              </tr>
            ))}

            {/* Empty state */}
            {!isAnythingLoading && !groupActive && rows.length === 0 && (
              <tr>
                <td colSpan={orderedCols.length + 1} className="px-3 py-12 text-center text-[11px] text-accent-muted/30 italic">
                  No rows match the current filters
                </td>
              </tr>
            )}

            {/* ── Grouped rendering ──────────────────────────────────────── */}
            {!isAnythingLoading && groupActive && flatItems && flatItems.map(item => {
              if (item.type === 'group') {
                const indent = item.depth * 20
                return (
                  <tr key={`h:${item.key}`}
                    onClick={() => toggleGroup(item.key)}
                    className="border-b border-white/[0.06] cursor-pointer select-none hover:bg-white/[0.03] transition-colors"
                    style={{ background: item.depth === 0 ? 'rgba(255,255,255,0.025)' : item.depth === 1 ? 'rgba(255,255,255,0.015)' : undefined }}>
                    <td className="w-8 px-1 py-1.5 text-center sticky left-0 z-[4] bg-inherit">
                      <div className={`transition-transform duration-150 text-accent-muted/40 mx-auto w-fit ${item.isExpanded ? 'rotate-90' : ''}`}>
                        <ChevronRightIcon size={12} />
                      </div>
                    </td>
                    <td colSpan={orderedCols.length} className="px-3 py-1.5">
                      <div className="flex items-center gap-2" style={{ paddingLeft: indent }}>
                        <span className="text-[9px] text-accent-muted/30 font-mono">{item.groupCol}:</span>
                        <span className={`text-[11px] font-medium ${item.depth === 0 ? 'text-white/80' : 'text-white/65'}`}>
                          {item.groupVal === '' ? <span className="italic text-accent-muted/30">(empty)</span> : item.groupVal}
                        </span>
                        <span className="text-[9px] px-1.5 py-0.5 rounded border border-accent-green/20 bg-accent-green/5 text-accent-green/70 ml-1">
                          {item.count.toLocaleString()}
                        </span>
                      </div>
                    </td>
                  </tr>
                )
              }

              // type === 'group-rows' — lazy-loaded rows for this leaf group
              return (
                <GroupRowsFetcher
                  key={item.groupKey}
                  caseId={caseId}
                  meta={meta}
                  baseFilters={activeFilters}
                  groupFilters={item.groupFilters}
                  orderedCols={orderedCols}
                  colW={colW}
                  depth={item.depth}
                  pinnedKeys={pinnedKeys}
                  exportedKeys={exportedKeys}
                  onPinToggle={onPinToggle}
                />
              )
            })}

            {/* ── Flat rendering ─────────────────────────────────────────── */}
            {!isAnythingLoading && !groupActive && rows.map((row, idx) => {
              const key        = makeRowKey(meta.id, row)
              const isPinned   = pinnedKeys.has(key)
              const isExported = exportedKeys.has(key)
              const rowKey     = `${idx}`
              return (
                <>
                  <tr key={idx}
                    onClick={() => setExpandedRow(r => r === rowKey ? null : rowKey)}
                    className={`border-b cursor-pointer transition-colors group ${
                      isPinned
                        ? 'border-accent-green/20 bg-accent-green/[0.04] hover:bg-accent-green/[0.07]'
                        : isExported
                          ? 'border-blue-500/10 bg-blue-500/[0.02] hover:bg-blue-500/[0.04]'
                          : expandedRow === rowKey
                            ? 'border-white/[0.04] bg-accent-green/5'
                            : 'border-white/[0.04] hover:bg-white/[0.025]'
                    }`}>
                    <td className={`w-8 shrink-0 px-1 py-1.5 text-center sticky left-0 z-[4] shadow-[1px_0_0_rgba(255,255,255,0.04)] ${isPinned ? 'bg-accent-green/[0.04]' : isExported ? 'bg-blue-500/[0.02]' : 'bg-bg-primary'}`}
                      onClick={e => { e.stopPropagation(); handlePin(row) }}
                      title={isExported && !isPinned ? 'Exported to the Timeline' : undefined}>
                      {isPinned
                        ? <BookmarkCheck size={13} className="mx-auto text-accent-green/60" />
                        : isExported
                          ? <BookmarkCheck size={13} className="mx-auto text-blue-400/50" />
                          : <BookmarkPlus size={13} className="mx-auto text-accent-muted/20 group-hover:text-accent-muted/50 hover:!text-accent-green transition-colors" />
                      }
                    </td>
                    {orderedCols.map(col => (
                      <td key={col}
                        className={`px-3 py-1.5 truncate ${col === meta.date_column ? 'font-mono text-[10px] text-white/45 whitespace-nowrap' : 'text-white/65'}`}
                        style={{ width: colW(col), minWidth: 60, maxWidth: colW(col) }}
                        title={row[col] ?? ''}>
                        {highlightCell(row[col] ?? '')}
                      </td>
                    ))}
                  </tr>
                  {expandedRow === rowKey && (
                    <tr key={`${rowKey}-detail`}>
                      <td colSpan={orderedCols.length + 1} className="p-0">
                        <RowDetail row={row} columns={allCols} onClose={() => setExpandedRow(null)} />
                      </td>
                    </tr>
                  )}
                </>
              )
            })}

            {/* Grouped empty state */}
            {!isAnythingLoading && groupActive && flatItems?.length === 0 && (
              <tr>
                <td colSpan={orderedCols.length + 1} className="px-3 py-12 text-center text-[11px] text-accent-muted/30 italic">
                  No rows match the current filters
                </td>
              </tr>
            )}

          </tbody>
        </table>
      </div>

      {/* Pagination — hidden when grouping is active */}
      {!groupActive && data && (
        <PaginationBar page={data.page} pages={pages} total={total} pageSize={data.page_size}
          onPage={p => updateFilters({ page: p })}
          onPageSize={s => updateFilters({ page_size: s, page: 1 })} />
      )}
    </div>
  )
}

// ── OmniSearchView ─────────────────────────────────────────────────────────────

function OmniSearchView({ caseId, query, regex, onOpenFile }: {
  caseId: string; query: string; regex: boolean; onOpenFile: (id: string) => void
}) {
  const { data, isLoading } = useQuery({
    queryKey: ['csv-omni', caseId, query, regex],
    queryFn:  () => csvArtifactsApi.search(caseId, query, 15, regex),
    enabled:  query.length >= 2,
    staleTime: 10_000,
  })

  if (query.length < 2) {
    return (
      <div className="flex items-center justify-center h-full text-accent-muted/30 text-sm">
        Type at least 2 characters to search across all CSV files
      </div>
    )
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full gap-2 text-accent-muted/40 text-sm">
        <Loader2 size={16} className="animate-spin" /> Searching all files…
      </div>
    )
  }

  if (!data || data.total_hits === 0) {
    return (
      <div className="flex items-center justify-center h-full text-accent-muted/30 text-sm">
        No results for "<span className="font-mono text-white/40">{query}</span>"
      </div>
    )
  }

  return (
    <div className="p-4 space-y-4 overflow-y-auto h-full">
      <p className="text-[11px] text-accent-muted/50">
        <span className="text-white/70 font-semibold">{data.total_hits.toLocaleString()}</span> match{data.total_hits !== 1 ? 'es' : ''} in {data.files.length} file{data.files.length !== 1 ? 's' : ''} for "<span className="font-mono text-accent-green">{data.query}</span>"
      </p>
      {data.files.map((file: OmniSearchFile) => (
        <OmniFileGroup key={file.id} file={file} query={query} onOpen={() => onOpenFile(file.id)} />
      ))}
    </div>
  )
}

function OmniFileGroup({ file, query, onOpen }: {
  file: OmniSearchFile; query: string; onOpen: () => void
}) {
  const [expanded, setExpanded] = useState(false)
  const displayRows = expanded ? file.rows : file.rows.slice(0, 8)
  const ql = query.toLowerCase()

  function highlight(text: string) {
    const idx = text.toLowerCase().indexOf(ql)
    if (idx === -1) return <span>{text}</span>
    return (
      <span>
        {text.slice(0, idx)}
        <mark className="bg-accent-green/20 text-accent-green rounded px-0.5">{text.slice(idx, idx + ql.length)}</mark>
        {text.slice(idx + ql.length)}
      </span>
    )
  }

  return (
    <div className="rounded-xl border border-white/8 bg-bg-secondary overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2.5 bg-white/[0.02] border-b border-white/5">
        <div className="flex items-center gap-2">
          <FileText size={13} className="text-accent-muted/40" />
          <span className="text-[12px] font-medium text-white/80">{file.original_name}</span>
          {file.ez_label && <EZBadge label={file.ez_label} />}
        </div>
        <div className="flex items-center gap-3">
          <span className="text-[10px] text-accent-green/70 bg-accent-green/8 border border-accent-green/20 px-2 py-0.5 rounded">
            {file.hit_count.toLocaleString()} hit{file.hit_count !== 1 ? 's' : ''}
          </span>
          <button onClick={onOpen}
            className="text-[10px] text-accent-muted hover:text-accent-green border border-white/10 hover:border-accent-green/30 px-2 py-0.5 rounded transition-colors">
            Open the file →
          </button>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="text-[10px]" style={{ minWidth: Math.max(600, file.columns.length * 140) + 'px' }}>
          <thead>
            <tr className="border-b border-white/5">
              {file.columns.map(col => (
                <th key={col} className="px-3 py-1.5 text-left font-medium text-accent-muted/30 uppercase tracking-widest whitespace-nowrap">{col}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {displayRows.map((row, i) => (
              <tr key={i} className={`border-b border-white/[0.03] ${i % 2 === 0 ? '' : 'bg-white/[0.015]'}`}>
                {file.columns.map(col => (
                  <td key={col} className="px-3 py-1.5 text-white/60 font-mono truncate" style={{ maxWidth: 240 }}>
                    {highlight(row[col] ?? '')}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {file.rows.length > 8 && (
        <button
          onClick={() => setExpanded(e => !e)}
          className="w-full py-1.5 text-[10px] text-accent-muted/40 hover:text-accent-green/60 hover:bg-white/[0.01] transition-colors border-t border-white/5"
        >
          {expanded
            ? 'Collapse'
            : `▼ Voir ${file.rows.length - 8} ligne${file.rows.length - 8 > 1 ? 's' : ''} de plus (${file.rows.length} au total)`
          }
        </button>
      )}
    </div>
  )
}

// ── Pinned panel ──────────────────────────────────────────────────────────────

function PinnedPanel({ pinned, onUnpin, onClear, onExport, onEdit, onReset, exporting }: {
  pinned:    PinnedRow[]
  onUnpin:   (key: string) => void
  onClear:   () => void
  onExport:  () => void
  onEdit:    (key: string, patch: Partial<Pick<PinnedRow, 'title' | 'description'>>) => void
  onReset:   (key: string) => void
  exporting: boolean
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const toggleExpanded = (key: string) => setExpanded(prev => {
    const next = new Set(prev)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    return next
  })

  const sorted = useMemo(() => [...pinned].sort((a, b) => {
    const ta = a.dateColumn ? a.row[a.dateColumn] ?? '' : ''
    const tb = b.dateColumn ? b.row[b.dateColumn] ?? '' : ''
    return ta.localeCompare(tb)
  }), [pinned])

  return (
    <div className="w-72 shrink-0 border-l border-white/5 bg-bg-card flex flex-col overflow-hidden">
      <div className="flex items-center justify-between px-3 py-3 border-b border-white/5 shrink-0">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-accent-muted/50 flex items-center gap-1.5">
          <BookmarkCheck size={10} />
          Selection
          {pinned.length > 0 && (
            <span className="ml-1 bg-accent-green/15 text-accent-green border border-accent-green/30 rounded px-1.5 py-0.5 text-[9px] font-bold">
              {pinned.length}
            </span>
          )}
        </p>
        {pinned.length > 0 && (
          <button onClick={onClear} title="Clear all"
            className="text-accent-muted/30 hover:text-severity-critical transition-colors">
            <X size={12} />
          </button>
        )}
      </div>

      {pinned.length === 0 && (
        <div className="flex-1 flex flex-col items-center justify-center gap-2 px-4 text-center">
          <BookmarkPlus size={22} className="text-accent-muted/15" />
          <p className="text-[10px] text-accent-muted/30 leading-relaxed">
            Click <BookmarkPlus size={9} className="inline" /> on a row to pin it here
          </p>
        </div>
      )}

      {pinned.length > 0 && (
        <div className="flex-1 overflow-y-auto divide-y divide-white/[0.04]">
          {sorted.map(item => {
            const ts     = item.dateColumn ? item.row[item.dateColumn] : null
            const isOpen = expanded.has(item.key)

            return (
              <div key={item.key} className="group relative px-3 py-2.5 hover:bg-white/[0.02] transition-colors">
                <div className="flex items-start gap-2 pr-5">
                  <button
                    onClick={() => toggleExpanded(item.key)}
                    title={isOpen ? 'Replier' : 'Éditer titre et description'}
                    className="mt-0.5 shrink-0 text-accent-muted/30 hover:text-accent-green transition-colors"
                  >
                    <ChevronRightIcon size={11} className={`transition-transform ${isOpen ? 'rotate-90' : ''}`} />
                  </button>
                  <div className="flex-1 min-w-0">
                    {item.ezLabel
                      ? <span className="text-[8px] font-semibold px-1.5 py-0.5 rounded border bg-blue-500/10 text-blue-400 border-blue-500/20">{item.ezLabel}</span>
                      : <span className="text-[8px] text-accent-muted/30 font-mono truncate block">{item.artifactName}</span>
                    }
                    {ts && (
                      <p className="text-[10px] font-mono text-white/50 mt-0.5 truncate">{ts}</p>
                    )}
                    <p className="text-[10px] text-white/70 mt-0.5 leading-snug line-clamp-2">
                      {item.title || <span className="text-accent-muted/30 italic">Sans titre</span>}
                    </p>
                    {!isOpen && item.description && (
                      <p className="text-[9px] text-accent-muted/35 truncate leading-snug">
                        {item.description.split('\n')[0]}
                      </p>
                    )}
                  </div>
                </div>

                {isOpen && (
                  <div className="mt-2 pl-[19px] space-y-1.5">
                    <div>
                      <label className="text-[8px] uppercase tracking-widest text-accent-muted/40">Title</label>
                      <input
                        value={item.title}
                        onChange={e => onEdit(item.key, { title: e.target.value })}
                        placeholder="Event title..."
                        className="w-full mt-0.5 bg-black/30 border border-white/10 rounded px-1.5 py-1 text-[10px] text-white/90 focus:border-accent-green/40 focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="text-[8px] uppercase tracking-widest text-accent-muted/40">Description</label>
                      <textarea
                        value={item.description}
                        onChange={e => onEdit(item.key, { description: e.target.value })}
                        rows={4}
                        placeholder="Description…"
                        className="w-full mt-0.5 bg-black/30 border border-white/10 rounded px-1.5 py-1 text-[10px] font-mono text-accent-muted resize-y focus:border-accent-green/40 focus:outline-none"
                      />
                    </div>
                    <div className="flex items-center justify-between">
                      <button
                        onClick={() => onReset(item.key)}
                        className="text-[9px] text-accent-muted/40 hover:text-accent-green transition-colors"
                      >
                        Reset
                      </button>
                      <span className="text-[8px] text-accent-muted/25">
                        {item.columns.length} fields kept
                      </span>
                    </div>
                  </div>
                )}

                <button onClick={() => onUnpin(item.key)}
                  className="absolute right-2 top-2.5 opacity-0 group-hover:opacity-100 text-accent-muted/30 hover:text-severity-critical transition-all">
                  <X size={10} />
                </button>
              </div>
            )
          })}
        </div>
      )}

      <div className="px-3 py-3 border-t border-white/5 shrink-0">
        <button
          onClick={onExport}
          disabled={pinned.length === 0 || exporting}
          className="w-full flex items-center justify-center gap-1.5 text-[11px] py-2 rounded border border-accent-green/30 text-accent-green bg-accent-green/5 hover:bg-accent-green/10 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        >
          {exporting
            ? <><Loader2 size={11} className="animate-spin" /> Envoi…</>
            : <><Download size={11} /> Exporter {pinned.length > 0 ? `${pinned.length} → ` : ''}Timeline</>
          }
        </button>
        {pinned.length > 0 && (
          <p className="text-[9px] text-accent-muted/25 mt-1.5 text-center">
            {pinned.length} event{pinned.length > 1 ? 's' : ''}, sorted chronologically
          </p>
        )}
      </div>
    </div>
  )
}

// ── Sidebar file row ──────────────────────────────────────────────────────────

function FileSidebarRow({ meta, isOpen, onOpen, onDelete, onAddEvidence, addingEvidence }: {
  meta: CsvArtifactMeta
  isOpen: boolean
  onOpen: () => void
  onDelete: () => void
  onAddEvidence: () => void
  addingEvidence: boolean
}) {
  const hasEvidence = !!meta.evidence_id
  return (
    <div onClick={onOpen}
      className={`group relative px-3 py-2.5 cursor-pointer border-l-2 transition-colors ${isOpen ? 'bg-accent-green/5 border-l-accent-green/40' : 'border-l-transparent hover:bg-white/[0.03]'}`}>
      <div className="flex items-start gap-2 pr-12">
        <FileText size={12} className="mt-0.5 shrink-0 text-accent-muted/30" />
        <div className="flex-1 min-w-0">
          <p className="text-[11px] text-white/80 truncate leading-snug font-mono">{meta.original_name}</p>
          <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
            {meta.ez_label
              ? <EZBadge label={meta.ez_label} />
              : <span className="text-[8px] font-semibold px-1.5 py-0.5 rounded border bg-gray-500/10 text-gray-500 border-gray-500/20">unknown</span>
            }
            {meta.source_timezone && (
              <span className="flex items-center gap-0.5 text-[8px] font-semibold px-1.5 py-0.5 rounded border border-blue-500/30 bg-blue-500/10 text-blue-400">
                <Globe size={7} />
                {meta.source_timezone.split('/').pop()?.replace('_', ' ') ?? meta.source_timezone}
              </span>
            )}
            <span className="text-[9px] text-accent-muted/40">{meta.row_count.toLocaleString()} rows</span>
          </div>
          <p className="text-[9px] text-accent-muted/25 mt-0.5">{fmtRelative(meta.uploaded_at)}</p>
        </div>
      </div>
      {/* Add to Evidence button */}
      <button
        onClick={e => { e.stopPropagation(); if (!hasEvidence) onAddEvidence() }}
        title={hasEvidence ? 'Linked to the chain of custody' : 'Add to the chain of custody'}
        disabled={addingEvidence}
        className={`absolute right-7 top-2.5 transition-all ${
          hasEvidence
            ? 'opacity-100 text-blue-400/70 cursor-default'
            : 'opacity-0 group-hover:opacity-100 text-accent-muted/40 hover:text-blue-400 cursor-pointer'
        } disabled:opacity-40`}
      >
        {addingEvidence
          ? <Loader2 size={11} className="animate-spin" />
          : hasEvidence
            ? <ShieldCheck size={11} />
            : <Shield size={11} />
        }
      </button>
      <button onClick={e => { e.stopPropagation(); onDelete() }}
        className="absolute right-2 top-2.5 opacity-0 group-hover:opacity-100 text-accent-muted/40 hover:text-severity-critical transition-all">
        <Trash2 size={11} />
      </button>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function ArtifactExplorer() {
  const { currentCase } = useCurrentCase()
  const caseId = currentCase?.id
  const qc     = useQueryClient()
  const [searchParams, setSearchParams] = useSearchParams()

  const { data: files = [], isLoading: filesLoading } = useQuery({
    queryKey: ['csv-artifacts', caseId],
    queryFn:  () => csvArtifactsApi.list(caseId!),
    enabled:  !!caseId,
  })

  const [openTabs,  setOpenTabs]  = useState<string[]>([])
  const [activeTab, setActiveTab] = useState<string | null>(null)
  const [tabStates, setTabStates] = useState<Record<string, TabState>>({})

  // ── Persistence: load per-case state from localStorage on mount ───────────
  const loadedCaseRef = useRef<string | null>(null)
  useEffect(() => {
    if (!caseId || loadedCaseRef.current === caseId) return
    loadedCaseRef.current = caseId
    try {
      const raw = localStorage.getItem(`ae-state-${caseId}`)
      if (!raw) return
      const { openTabs: ot, activeTab: at, tabStates: ts } = JSON.parse(raw)
      if (Array.isArray(ot)) setOpenTabs(ot)
      if (at === null || typeof at === 'string') setActiveTab(at)
      if (ts && typeof ts === 'object') setTabStates(ts)
    } catch { /* ignore malformed data */ }
  }, [caseId])

  // ── Persistence: save on change ───────────────────────────────────────────
  useEffect(() => {
    if (!caseId) return
    try {
      localStorage.setItem(`ae-state-${caseId}`, JSON.stringify({ openTabs, activeTab, tabStates }))
    } catch { /* storage quota */ }
  }, [caseId, openTabs, activeTab, tabStates])

  // ── Validate persisted tabs against server file list ─────────────────────
  useEffect(() => {
    if (!files.length) return
    const validIds = new Set(files.map(f => f.id))
    setOpenTabs(prev => {
      const next = prev.filter(id => validIds.has(id))
      return next.length !== prev.length ? next : prev
    })
    setActiveTab(prev => (prev && !validIds.has(prev) ? null : prev))
  }, [files])

  const openFile = useCallback((id: string) => {
    setOpenTabs(prev => prev.includes(id) ? prev : [...prev, id])
    setActiveTab(id)
    setOmniQuery('')
  }, [])

  useEffect(() => {
    const openParam = searchParams.get('open')
    if (!openParam || files.length === 0) return
    const name  = decodeURIComponent(openParam)
    const match = files.find(f => f.original_name === name)
    if (match) {
      openFile(match.id)
      setSearchParams({}, { replace: true })
    }
  }, [files, searchParams, openFile, setSearchParams])

  const [sidebarWidth, setSidebarWidth] = useState<number>(() =>
    parseInt(localStorage.getItem('ae-sidebar-w') ?? '240', 10)
  )
  const isResizing  = useRef(false)
  const resizeStart = useRef({ x: 0, w: 0 })

  const onResizeStart = (e: React.MouseEvent) => {
    e.preventDefault()
    isResizing.current  = true
    resizeStart.current = { x: e.clientX, w: sidebarWidth }
    document.body.style.cursor     = 'col-resize'
    document.body.style.userSelect = 'none'
  }

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!isResizing.current) return
      const w = Math.max(160, Math.min(520, resizeStart.current.w + e.clientX - resizeStart.current.x))
      setSidebarWidth(w)
    }
    const onUp = () => {
      if (!isResizing.current) return
      isResizing.current = false
      document.body.style.cursor     = ''
      document.body.style.userSelect = ''
      setSidebarWidth(w => { localStorage.setItem('ae-sidebar-w', String(w)); return w })
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup',   onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup',   onUp)
    }
  }, [])

  const [fileSearch, setFileSearch] = useState('')
  const filteredSidebarFiles = useMemo(() => {
    if (!fileSearch.trim()) return files
    const q = fileSearch.toLowerCase()
    return files.filter(f =>
      f.original_name.toLowerCase().includes(q) ||
      (f.ez_label ?? '').toLowerCase().includes(q)
    )
  }, [files, fileSearch])

  const closeTab = (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    setOpenTabs(prev => {
      const next = prev.filter(t => t !== id)
      if (activeTab === id) setActiveTab(next[next.length - 1] ?? null)
      return next
    })
  }

  const updateTabState = useCallback((id: string, patch: Partial<TabState>) => {
    setTabStates(prev => ({ ...prev, [id]: { ...(prev[id] ?? defaultTabState()), ...patch } }))
  }, [])

  const [uploading, setUploading] = useState(false)
  const [uploadErr, setUploadErr] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const SUPPORTED_EXTS = ['.csv', '.json', '.txt', '.log']

  const handleFiles = async (fileList: FileList | null) => {
    if (!fileList || !caseId) return
    setUploadErr(null)
    setUploading(true)
    let lastId: string | null = null
    for (const file of Array.from(fileList)) {
      const ext = '.' + (file.name.split('.').pop() ?? '').toLowerCase()
      if (!SUPPORTED_EXTS.includes(ext)) {
        setUploadErr(`Unsupported type: ${ext}. Accepted: ${SUPPORTED_EXTS.join(', ')}`)
        continue
      }
      try {
        const meta = await csvArtifactsApi.upload(caseId, file)
        lastId = meta.id
      } catch (e: unknown) {
        const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? 'Upload failed'
        setUploadErr(String(msg))
      }
    }
    qc.invalidateQueries({ queryKey: ['csv-artifacts', caseId] })
    if (lastId) openFile(lastId)
    setUploading(false)
  }

  const deleteMutation = useMutation({
    mutationFn: (id: string) => csvArtifactsApi.delete(caseId!, id),
    onSuccess: (_, id) => {
      qc.invalidateQueries({ queryKey: ['csv-artifacts', caseId] })
      setOpenTabs(prev => {
        const next = prev.filter(t => t !== id)
        if (activeTab === id) setActiveTab(next[next.length - 1] ?? null)
        return next
      })
    },
  })

  const [addingEvidenceId, setAddingEvidenceId] = useState<string | null>(null)

  const handleAddEvidence = useCallback(async (artifactId: string) => {
    if (!caseId) return
    setAddingEvidenceId(artifactId)
    try {
      await csvArtifactsApi.addEvidence(caseId, artifactId)
      qc.invalidateQueries({ queryKey: ['csv-artifacts', caseId] })
    } catch { /* silently ignore errors */ }
    finally { setAddingEvidenceId(null) }
  }, [caseId, qc])

  const [pinnedRows,   setPinnedRows]   = useState<PinnedRow[]>([])
  const [exporting,    setExporting]    = useState(false)
  const [exportedKeys, setExportedKeys] = useState<Set<string>>(new Set())

  const pinnedKeySet = useMemo(() => new Set(pinnedRows.map(p => p.key)), [pinnedRows])

  const handlePinToggle = useCallback((key: string, row: Record<string, string>, meta: CsvArtifactMeta) => {
    setPinnedRows(prev => {
      if (prev.some(p => p.key === key)) return prev.filter(p => p.key !== key)
      const base = {
        key,
        artifactId:     meta.id,
        artifactName:   meta.original_name,
        ezLabel:        meta.ez_label,
        ezCategory:     meta.ez_category,
        dateColumn:     meta.date_column,
        sourceTimezone: meta.source_timezone ?? null,
        columns:        meta.columns,
        row,
      }
      return [...prev, {
        ...base,
        title:       buildDefaultTitle(base),
        description: buildDefaultDescription(base),
      }]
    })
  }, [])

  /** Analyst edits to a pinned row's title/description, before export. */
  const handlePinEdit = useCallback((key: string, patch: Partial<Pick<PinnedRow, 'title' | 'description'>>) => {
    setPinnedRows(prev => prev.map(p => (p.key === key ? { ...p, ...patch } : p)))
  }, [])

  /** Restore the auto-generated title/description for one pinned row. */
  const handlePinReset = useCallback((key: string) => {
    setPinnedRows(prev => prev.map(p =>
      p.key === key
        ? { ...p, title: buildDefaultTitle(p), description: buildDefaultDescription(p) }
        : p
    ))
  }, [])

  const exportToTimeline = useCallback(async () => {
    if (!caseId || pinnedRows.length === 0) return
    setExporting(true)
    try {
      const sorted = [...pinnedRows].sort((a, b) => {
        const ta = a.dateColumn ? a.row[a.dateColumn] ?? '' : ''
        const tb = b.dateColumn ? b.row[b.dateColumn] ?? '' : ''
        return ta.localeCompare(tb)
      })
      for (const item of sorted) {
        const dateVal = item.dateColumn ? item.row[item.dateColumn] ?? '' : ''
        const ts = dateVal
          ? parseArtifactTimestamp(dateVal, item.sourceTimezone)
          : new Date().toISOString()
        const source = item.ezLabel ?? item.artifactName
        await timelineApi.create(caseId, {
          event_ts: ts,
          title:       item.title.trim() || buildDefaultTitle(item),
          description: item.description,
          actor: '', source, tags: '',
          // Full untouched record — rendered under a chevron in the Timeline
          // tab so the analyst can rewrite title/description freely without
          // ever losing the underlying evidence.
          origin:      'artifact',
          raw_payload: JSON.stringify(item.row),
          raw_source:  `${source} · ${item.artifactName}`,
        })
      }
      qc.invalidateQueries({ queryKey: ['timeline', caseId] })

      // Append CoC note on each artifact that has a linked evidence record
      const countByArtifact = sorted.reduce<Record<string, number>>((acc, p) => {
        acc[p.artifactId] = (acc[p.artifactId] ?? 0) + 1
        return acc
      }, {})
      await Promise.allSettled(
        Object.entries(countByArtifact).map(([artifactId, count]) =>
          csvArtifactsApi.cocNote(caseId, artifactId,
            `${count} event(s) exported to the Timeline`
          )
        )
      )

      setExportedKeys(prev => new Set([...prev, ...sorted.map(s => s.key)]))
      setPinnedRows([])
    } finally {
      setExporting(false)
    }
  }, [caseId, pinnedRows, qc])

  const [omniQuery,     setOmniQuery]     = useState('')
  const [omniDebounced, setOmniDebounced] = useState('')
  const [omniRegex,     setOmniRegex]     = useState(false)
  const omniTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const handleOmniChange = (val: string) => {
    setOmniQuery(val)
    if (omniTimer.current) clearTimeout(omniTimer.current)
    omniTimer.current = setTimeout(() => setOmniDebounced(val), 450)
  }

  const showOmni = omniDebounced.length >= 2

  const [dragging, setDragging] = useState(false)

  if (!caseId) {
    return (
      <div className="p-6 max-w-xl mx-auto mt-20 text-center space-y-4">
        <Table2 size={40} className="mx-auto text-accent-muted/20" />
        <h1 className="text-lg font-bold text-white">Artifact Explorer</h1>
        <p className="text-accent-muted text-sm">No active case. Set a current case from the top bar to explore CSV artifacts.</p>
        <div className="flex items-center gap-2 text-[11px] text-accent-muted/60 bg-white/[0.02] border border-white/8 rounded-lg px-3 py-2 justify-center">
          <Info size={12} /> Select a case to upload and browse EZ Tools CSV exports
        </div>
      </div>
    )
  }

  const activeMeta = activeTab ? files.find(f => f.id === activeTab) ?? null : null

  const activeView = (() => {
    if (!activeTab || !activeMeta) return null
    const ft = getFileType(activeMeta.original_name)
    if (ft === 'evtx') return <ArtifactRedirectView key={activeTab} meta={activeMeta} caseId={caseId} type="evtx" />
    if (ft === 'eml')  return <ArtifactRedirectView key={activeTab} meta={activeMeta} caseId={caseId} type="eml" />
    if (ft === 'txt')  return <TextArtifactView key={activeTab} meta={activeMeta} caseId={caseId} />
    if (ft === 'json') return <JsonArtifactView key={activeTab} meta={activeMeta} caseId={caseId} />
    return (
      <ArtifactTableView key={activeTab} caseId={caseId} meta={activeMeta}
        state={tabStates[activeTab] ?? defaultTabState()}
        onStateChange={patch => updateTabState(activeTab, patch)}
        pinnedKeys={pinnedKeySet}
        exportedKeys={exportedKeys}
        onPinToggle={(key, row) => handlePinToggle(key, row, activeMeta)} />
    )
  })()

  return (
    <div className="flex h-full overflow-hidden" data-no-select={isResizing.current || undefined}
      onDragOver={e => { e.preventDefault(); setDragging(true) }}
      onDragLeave={() => setDragging(false)}
      onDrop={e => { e.preventDefault(); setDragging(false); handleFiles(e.dataTransfer.files) }}>

      {/* ── Left sidebar ─────────────────────────────────────────────────── */}
      <div
        className="relative shrink-0 border-r border-white/5 bg-bg-card flex flex-col overflow-hidden"
        style={{ width: sidebarWidth }}
      >
        <div className="px-3 py-3 border-b border-white/5 shrink-0">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-accent-muted/50 flex items-center gap-1.5">
            <Table2 size={10} /> Artifact Explorer
          </p>
          <p className="text-[9px] text-accent-muted/25 mt-0.5 truncate">{currentCase?.title}</p>
        </div>

        <div className="px-3 py-2 border-b border-white/5 shrink-0">
          <div className="relative">
            <Globe size={11} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-accent-muted/30" />
            <input value={omniQuery} onChange={e => handleOmniChange(e.target.value)}
              placeholder="Omnisearch all files…"
              className={`w-full bg-white/5 border rounded pl-7 pr-14 py-1.5 text-[11px] text-white placeholder:text-accent-muted/30 outline-none transition-colors ${omniQuery ? 'border-blue-400/30 bg-blue-500/5' : 'border-white/8 focus:border-white/20'}`} />
            <div className="absolute right-1.5 top-1/2 -translate-y-1/2 flex items-center gap-1">
              <button
                onClick={() => setOmniRegex(r => !r)}
                title={omniRegex ? 'Disable regex' : 'Enable regex'}
                className={`px-1 py-0.5 rounded text-[9px] font-mono border transition-colors ${omniRegex ? 'border-accent-green/40 text-accent-green bg-accent-green/10' : 'border-white/10 text-accent-muted/40 hover:text-white hover:border-white/20'}`}
              >.*</button>
              {omniQuery && (
                <button onClick={() => { setOmniQuery(''); setOmniDebounced('') }}
                  className="text-accent-muted/40 hover:text-white"><X size={10} /></button>
              )}
            </div>
          </div>
        </div>

        <div className="px-3 py-2 border-b border-white/5 shrink-0">
          <input ref={fileRef} type="file" accept=".csv,.json,.txt,.log,text/csv,application/json" multiple className="sr-only"
            onChange={e => handleFiles(e.target.files)} />
          <button onClick={() => fileRef.current?.click()} disabled={uploading}
            className="w-full flex items-center justify-center gap-1.5 text-[11px] py-1.5 rounded border border-dashed border-white/15 text-accent-muted hover:text-accent-green hover:border-accent-green/30 transition-colors disabled:opacity-40">
            {uploading ? <Loader2 size={11} className="animate-spin" /> : <Upload size={11} />}
            {uploading ? 'Uploading…' : 'Upload file…'}
          </button>
          {uploadErr && <p className="text-[10px] text-severity-critical mt-1">{uploadErr}</p>}
        </div>

        {files.length > 3 && (
          <div className="px-3 py-2 border-b border-white/5 shrink-0">
            <div className="relative">
              <Search size={10} className="absolute left-2 top-1/2 -translate-y-1/2 text-accent-muted/30" />
              <input
                value={fileSearch}
                onChange={e => setFileSearch(e.target.value)}
                placeholder="Filter files…"
                className="w-full bg-white/5 border border-white/8 rounded pl-6 pr-5 py-1 text-[11px] text-white placeholder:text-accent-muted/30 outline-none focus:border-white/20 transition-colors"
              />
              {fileSearch && (
                <button onClick={() => setFileSearch('')}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 text-accent-muted/40 hover:text-white">
                  <X size={9} />
                </button>
              )}
            </div>
          </div>
        )}

        <div className="flex-1 overflow-y-auto">
          {filesLoading && (
            <div className="flex items-center justify-center py-8">
              <Loader2 size={16} className="animate-spin text-accent-muted/30" />
            </div>
          )}
          {!filesLoading && files.length === 0 && (
            <p className="text-[10px] text-accent-muted/30 text-center py-8 px-3">
              No CSV files yet.<br />Upload EZ Tools output files to start.
            </p>
          )}
          {!filesLoading && files.length > 0 && filteredSidebarFiles.length === 0 && (
            <p className="text-[10px] text-accent-muted/30 text-center py-6 px-3 italic">
              No files match "{fileSearch}"
            </p>
          )}
          {filteredSidebarFiles.map(f => (
            <FileSidebarRow key={f.id} meta={f}
              isOpen={openTabs.includes(f.id)}
              onOpen={() => openFile(f.id)}
              onDelete={() => deleteMutation.mutate(f.id)}
              onAddEvidence={() => handleAddEvidence(f.id)}
              addingEvidence={addingEvidenceId === f.id} />
          ))}
        </div>

        <div
          onMouseDown={onResizeStart}
          className="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize z-10 group flex items-center justify-center"
          title="Drag to resize sidebar"
        >
          <div className="w-0.5 h-12 rounded-full bg-white/10 group-hover:bg-accent-green/40 transition-colors" />
        </div>
      </div>

      {/* ── Main area ────────────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col overflow-hidden">

        {openTabs.length > 0 && (
          <div className="flex items-center gap-0 border-b border-white/5 bg-bg-secondary/50 shrink-0 overflow-x-auto">
            {openTabs.map(tabId => {
              const f    = files.find(x => x.id === tabId)
              const name = f?.original_name ?? tabId
              const isActive = tabId === activeTab && !showOmni
              return (
                <button key={tabId} onClick={() => { setActiveTab(tabId); setOmniQuery(''); setOmniDebounced('') }}
                  className={`flex items-center gap-1.5 px-3 py-2.5 text-[11px] border-r border-white/5 shrink-0 transition-colors max-w-[200px] ${isActive ? 'bg-bg-primary text-white border-t-2 border-t-accent-green/50' : 'text-accent-muted hover:text-white hover:bg-white/[0.03]'}`}>
                  <FileText size={11} className="shrink-0" />
                  <span className="truncate font-mono">{name}</span>
                  {f?.ez_label && <span className="text-[8px] text-blue-400/60 border border-blue-400/20 px-1 rounded shrink-0">EZ</span>}
                  <span onClick={e => closeTab(tabId, e)}
                    className="ml-0.5 text-accent-muted/30 hover:text-severity-critical transition-colors shrink-0">
                    <X size={10} />
                  </span>
                </button>
              )
            })}
          </div>
        )}

        {showOmni ? (
          <OmniSearchView caseId={caseId} query={omniDebounced} regex={omniRegex} onOpenFile={openFile} />
        ) : activeView ? (
          activeView
        ) : (
          <div className={`flex-1 flex flex-col items-center justify-center gap-4 transition-colors ${dragging ? 'bg-accent-green/5' : ''}`}>
            <Table2 size={48} className="text-accent-muted/15" />
            <div className="text-center">
              <p className="text-white/40 text-sm">Select a file from the sidebar</p>
              <p className="text-accent-muted/30 text-xs mt-1">or drop .csv / .json / .txt / .log files here to upload</p>
            </div>
            {dragging && (
              <div className="border-2 border-dashed border-accent-green/40 rounded-xl px-12 py-6 text-accent-green/60 text-sm">
                Drop files to upload (.csv, .json, .txt, .log)
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Right pinned panel ───────────────────────────────────────────── */}
      <PinnedPanel
        pinned={pinnedRows}
        onUnpin={key => setPinnedRows(prev => prev.filter(p => p.key !== key))}
        onClear={() => setPinnedRows([])}
        onExport={exportToTimeline}
        onEdit={handlePinEdit}
        onReset={handlePinReset}
        exporting={exporting}
      />
    </div>
  )
}
