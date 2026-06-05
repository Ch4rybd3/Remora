import { useState, useCallback, useRef, useEffect, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Upload, Search, X, ChevronDown, ChevronLeft, ChevronRight,
  ChevronsLeft, ChevronsRight, ArrowUp, ArrowDown, SlidersHorizontal,
  BookmarkPlus, BookmarkCheck, Download, Columns3, Trash2, FileText,
  Loader2, Info, Table2, Globe, Layers, GripVertical, ChevronRight as ChevronRightIcon,
} from 'lucide-react'
import { csvArtifactsApi, type CsvArtifactMeta, type ArtifactRowFilters, type OmniSearchFile } from '../api/csvArtifacts'
import { timelineApi } from '../api/timeline'
import { useCurrentCase } from '../context/CurrentCaseContext'
import { fmtRelative } from '../utils/dateUtils'

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
}

const defaultTabState = (): TabState => ({
  filters:     { page: 1, page_size: 100, sort_dir: 'asc' },
  colFilters:  {},
  hiddenCols:  [],
  colWidths:   {},
  groupByCols: [],
  colOrder:    [],
})

interface PinnedRow {
  key:          string
  artifactId:   string
  artifactName: string
  ezLabel:      string | null
  dateColumn:   string | null
  columns:      string[]
  row:          Record<string, string>
}

type FlatItem =
  | { type: 'group'; depth: number; key: string; groupCol: string; groupVal: string; count: number; isExpanded: boolean }
  | { type: 'row';   row: Record<string, string>; rowIdx: number }

/** Stable unique key using all row values. */
function makeRowKey(artifactId: string, row: Record<string, string>): string {
  return `${artifactId}\x1f${Object.values(row).join('\x1e')}`
}

function buildFlatList(
  rows: Record<string, string>[],
  groupCols: string[],
  expanded: Set<string>,
  depth = 0,
  prefix = '',
): FlatItem[] {
  if (depth >= groupCols.length) {
    return rows.map((row, i) => ({ type: 'row', row, rowIdx: i }))
  }
  const col = groupCols[depth]
  const grouped = new Map<string, Record<string, string>[]>()
  for (const row of rows) {
    const val = row[col] ?? ''
    if (!grouped.has(val)) grouped.set(val, [])
    grouped.get(val)!.push(row)
  }
  const sorted = [...grouped.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  const result: FlatItem[] = []
  for (const [val, groupRows] of sorted) {
    const key = `${prefix}\x1f${val}`
    const isExpanded = expanded.has(key)
    result.push({ type: 'group', depth, key, groupCol: col, groupVal: val, count: groupRows.length, isExpanded })
    if (isExpanded) {
      result.push(...buildFlatList(groupRows, groupCols, expanded, depth + 1, key))
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

function ColFilterInput({ colKey, filter, onChange }: {
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

function RowDetail({ row, columns, onClose }: {
  row: Record<string, string>; columns: string[]; onClose: () => void
}) {
  return (
    <div className="border-t border-white/8 bg-bg-secondary/60 px-4 py-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] font-semibold text-accent-muted/60 uppercase tracking-widest">Row Detail</span>
        <button onClick={onClose} className="text-accent-muted/40 hover:text-white transition-colors"><X size={13} /></button>
      </div>
      <div className="rounded border border-white/8 overflow-hidden">
        {columns.map((col, i) => (
          <div key={col} className={`flex text-[11px] ${i % 2 === 0 ? 'bg-white/[0.02]' : ''}`}>
            <span className="w-52 shrink-0 px-3 py-1 text-accent-muted/50 border-r border-white/5 font-mono truncate" title={col}>{col}</span>
            <span className="flex-1 px-3 py-1 text-white/70 font-mono break-all">
              {row[col] || <span className="opacity-20 italic">empty</span>}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── ColResizeHandle ───────────────────────────────────────────────────────────

function ColResizeHandle({ col, onStart }: {
  col:     string
  onStart: (e: React.MouseEvent, col: string) => void
}) {
  return (
    <div
      className="absolute right-0 top-0 bottom-0 w-2 cursor-col-resize z-10 group/rh flex items-center justify-end"
      draggable={false}
      onMouseDown={e => { e.stopPropagation(); e.preventDefault(); onStart(e, col) }}
    >
      <div className="w-px h-4 bg-white/10 group-hover/rh:bg-accent-green/50 transition-colors" />
    </div>
  )
}

// ── GroupByBar ────────────────────────────────────────────────────────────────

function GroupByBar({ groupByCols, onChange, isDragging }: {
  groupByCols: string[]
  onChange:    (cols: string[]) => void
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
        if (col && !groupByCols.includes(col)) onChange([...groupByCols, col])
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
            onClick={() => onChange(groupByCols.filter(c => c !== col))}
            className="text-accent-green/40 hover:text-red-400 transition-colors ml-1">
            <X size={7} />
          </button>
        </span>
      ))}

      <span className={`text-[9px] italic select-none pointer-events-none ${
        isOver ? 'text-accent-green/60' : isDragging ? 'text-accent-green/40' : 'text-accent-muted/20'
      }`}>
        {isOver
          ? 'Relâchez pour grouper'
          : isDragging
          ? hasGroups ? '+ ajouter au groupe' : '← déposez ici pour grouper'
          : hasGroups ? '' : 'glissez un en-tête de colonne ici'}
      </span>

      {hasGroups && (
        <button
          onClick={() => onChange([])}
          className="ml-auto text-[9px] text-accent-muted/30 hover:text-red-400 transition-colors shrink-0 flex items-center gap-0.5">
          <X size={8} /> Effacer
        </button>
      )}
    </div>
  )
}

// ── ArtifactTableView ─────────────────────────────────────────────────────────

function ArtifactTableView({ caseId, meta, state, onStateChange, pinnedKeys, onPinToggle }: {
  caseId:        string
  meta:          CsvArtifactMeta
  state:         TabState
  onStateChange: (patch: Partial<TabState>) => void
  pinnedKeys:    Set<string>
  onPinToggle:   (key: string, row: Record<string, string>) => void
}) {
  const [expandedRow,    setExpandedRow]    = useState<string | null>(null)
  const [showFilters,    setShowFilters]    = useState(false)
  const [localSearch,    setLocalSearch]    = useState(state.filters.q ?? '')
  const [draggingCol,    setDraggingCol]    = useState<string | null>(null)
  const [dragOverCol,    setDragOverCol]    = useState<string | null>(null)
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set())

  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const colDebounce = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingCols = useRef<ColFilters>({})

  // ── Column resize ─────────────────────────────────────────────────────────
  const colResizing  = useRef<{ col: string; startX: number; startW: number } | null>(null)
  const colWidthsRef = useRef<Record<string, number>>(state.colWidths ?? {})
  const onStateRef   = useRef(onStateChange)
  useEffect(() => { onStateRef.current   = onStateChange }, [onStateChange])
  useEffect(() => { colWidthsRef.current = state.colWidths ?? {} }, [state.colWidths])

  const startColResize = useCallback((e: React.MouseEvent, col: string) => {
    const defaultW = col === meta.date_column ? 168 : 160
    const startW   = (state.colWidths ?? {})[col] ?? defaultW
    colResizing.current = { col, startX: e.clientX, startW }
    document.body.style.cursor     = 'col-resize'
    document.body.style.userSelect = 'none'
  }, [state.colWidths, meta.date_column])

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

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['csv-rows', caseId, meta.id, state.filters],
    queryFn:  () => csvArtifactsApi.getRows(caseId, meta.id, state.filters),
    placeholderData: prev => prev,
    enabled: !groupActive,
  })

  // ── All-rows fetch for grouping (backend max = 5000) ─────────────────────
  const { data: groupData, isLoading: groupLoading, isFetching: groupFetching } = useQuery({
    queryKey: ['csv-rows-grouped', caseId, meta.id, state.filters],
    queryFn:  () => csvArtifactsApi.getRows(caseId, meta.id, {
      ...state.filters,
      page: 1,
      page_size: 5000,
    }),
    placeholderData: prev => prev,
    enabled: groupActive,
  })

  const rows    = data?.items   ?? []
  const total   = data?.total   ?? 0
  const pages   = data?.pages   ?? 1
  const allCols = (groupActive ? groupData?.columns : data?.columns) ?? meta.columns

  const isCapped = groupActive && (groupData?.total ?? 0) > 5000

  // ── Column ordering ───────────────────────────────────────────────────────
  const hiddenSet   = useMemo(() => new Set(state.hiddenCols), [state.hiddenCols])
  const visibleCols = useMemo(() => allCols.filter(c => !hiddenSet.has(c)), [allCols, hiddenSet])

  const orderedCols = useMemo(() => {
    if (!state.colOrder?.length) return visibleCols
    const inOrder = state.colOrder.filter(c => visibleCols.includes(c))
    const rest    = visibleCols.filter(c => !inOrder.includes(c))
    return [...inOrder, ...rest]
  }, [visibleCols, state.colOrder])

  // ── Grouped flat list ─────────────────────────────────────────────────────
  const validGroupCols = useMemo(() =>
    groupByCols.filter(c => allCols.includes(c)),
    [groupByCols, allCols]
  )

  const allGroupRows = groupData?.items ?? []

  const flatItems = useMemo(() =>
    groupActive && !groupLoading
      ? buildFlatList(allGroupRows, validGroupCols, expandedGroups)
      : null,
    [allGroupRows, validGroupCols, expandedGroups, groupActive, groupLoading]
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
      // Expand all group keys reachable from current flat list, then rebuild
      // We need all keys including nested ones — build the fully-expanded list
      const allKeys = new Set<string>()
      function collectKeys(rows: Record<string, string>[], cols: string[], depth: number, prefix: string) {
        if (depth >= cols.length) return
        const col = cols[depth]
        const grouped = new Map<string, Record<string, string>[]>()
        for (const row of rows) {
          const val = row[col] ?? ''
          if (!grouped.has(val)) grouped.set(val, [])
          grouped.get(val)!.push(row)
        }
        for (const [val, groupRows] of grouped) {
          const key = `${prefix}\x1f${val}`
          allKeys.add(key)
          collectKeys(groupRows, cols, depth + 1, key)
        }
      }
      collectKeys(allGroupRows, validGroupCols, 0, '')
      setExpandedGroups(allKeys)
    }
  }, [allExpanded, allGroupRows, validGroupCols])

  // Reset expanded groups when group columns change
  const groupColsKey = groupByCols.join(',')
  useEffect(() => {
    setExpandedGroups(new Set())
  }, [groupColsKey])

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
    const all = await csvArtifactsApi.getAllRows(caseId, meta.id, { q, col_filters, sort_col, sort_dir })
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

  // ── Grouped stats ─────────────────────────────────────────────────────────
  const groupTotal    = groupData?.total ?? 0
  const groupRowCount = flatItems?.filter(i => i.type === 'row').length ?? 0

  return (
    <div className="flex flex-col h-full">

      {/* ── Group-by drop zone ──────────────────────────────────────────── */}
      <GroupByBar
        groupByCols={validGroupCols}
        onChange={cols => onStateChange({ groupByCols: cols })}
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
              : <><ChevronsRight size={10} className="rotate-90" /> Développer tout</>
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
            ? isCapped
              ? <><span className="text-yellow-400/70">5 000</span>/{meta.row_count.toLocaleString()} rows (capped)</>
              : <><span className="text-white/60">{groupTotal.toLocaleString()}</span> rows grouped</>
            : total < meta.row_count
            ? <><span className="text-white/60">{total.toLocaleString()}</span> / {meta.row_count.toLocaleString()} rows</>
            : <><span className="text-white/60">{total.toLocaleString()}</span> rows</>
          }
        </div>
      </div>

      {/* Refetch progress bar */}
      <div className={`h-0.5 shrink-0 overflow-hidden transition-opacity duration-150 ${isAnythingFetching && !isAnythingLoading ? 'opacity-100' : 'opacity-0'}`}>
        <div className="h-full bg-accent-green/50 animate-[shimmer_1.4s_ease-in-out_infinite]"
          style={{ background: 'linear-gradient(90deg, transparent 0%, #9FEF00 40%, #9FEF00 60%, transparent 100%)', backgroundSize: '200% 100%', animation: 'shimmer 1.4s ease-in-out infinite' }} />
      </div>

      {/* Capped warning */}
      {isCapped && (
        <div className="px-3 py-1.5 bg-yellow-400/5 border-b border-yellow-400/20 text-[10px] text-yellow-400/70 shrink-0">
          Les résultats sont limités à 5 000 lignes pour le groupement. Affinez vos filtres pour voir toutes les données.
        </div>
      )}

      {/* Table area */}
      <div className={`flex-1 overflow-auto relative transition-opacity duration-150 ${isAnythingFetching && !isAnythingLoading ? 'opacity-50' : 'opacity-100'}`}>
        <table className="w-full border-collapse text-[11px]"
          style={{ minWidth: Math.max(800, orderedCols.length * 160 + 32) + 'px' }}>
          <thead className="sticky top-0 z-10 bg-bg-secondary">
            {/* Column name row */}
            <tr className="border-b border-white/8">
              <th className="w-8 shrink-0 px-1 pt-2 pb-1" />
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
                    <ColResizeHandle col={col} onStart={startColResize} />
                  </th>
                )
              })}
            </tr>
            {/* Per-column filter row */}
            {showFilters && (
              <tr className="border-b border-white/5 bg-bg-secondary/80">
                <th className="w-8 shrink-0 px-1 py-1.5" />
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
                <td className="w-8 px-1 py-2" />
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
            {!isAnythingLoading && groupActive && flatItems && flatItems.map((item, idx) => {
              if (item.type === 'group') {
                const indent = item.depth * 20
                return (
                  <tr key={item.key}
                    onClick={() => toggleGroup(item.key)}
                    className="border-b border-white/[0.06] cursor-pointer select-none hover:bg-white/[0.03] transition-colors"
                    style={{ background: item.depth === 0 ? 'rgba(255,255,255,0.025)' : item.depth === 1 ? 'rgba(255,255,255,0.015)' : undefined }}>
                    <td className="w-8 px-1 py-1.5 text-center">
                      <div className={`transition-transform duration-150 text-accent-muted/40 mx-auto w-fit ${item.isExpanded ? 'rotate-90' : ''}`}>
                        <ChevronRightIcon size={12} />
                      </div>
                    </td>
                    <td colSpan={orderedCols.length} className="px-3 py-1.5">
                      <div className="flex items-center gap-2" style={{ paddingLeft: indent }}>
                        <span className="text-[9px] text-accent-muted/30 font-mono">{item.groupCol}:</span>
                        <span className={`text-[11px] font-medium ${item.depth === 0 ? 'text-white/80' : 'text-white/65'}`}>
                          {item.groupVal === '' ? <span className="italic text-accent-muted/30">(vide)</span> : item.groupVal}
                        </span>
                        <span className="text-[9px] px-1.5 py-0.5 rounded border border-accent-green/20 bg-accent-green/5 text-accent-green/70 ml-1">
                          {item.count.toLocaleString()}
                        </span>
                      </div>
                    </td>
                  </tr>
                )
              }

              // type === 'row'
              const row    = item.row
              const key    = makeRowKey(meta.id, row)
              const isPinned = pinnedKeys.has(key)
              const rowKey = `${key}-${idx}`
              return (
                <>
                  <tr key={rowKey}
                    onClick={() => setExpandedRow(r => r === rowKey ? null : rowKey)}
                    className={`border-b border-white/[0.04] cursor-pointer transition-colors group ${expandedRow === rowKey ? 'bg-accent-green/5' : 'hover:bg-white/[0.025]'}`}>
                    <td className="w-8 shrink-0 px-1 py-1.5 text-center"
                      onClick={e => { e.stopPropagation(); handlePin(row) }}>
                      {isPinned
                        ? <BookmarkCheck size={13} className="mx-auto text-accent-green/60" />
                        : <BookmarkPlus size={13} className="mx-auto text-accent-muted/20 group-hover:text-accent-muted/50 hover:!text-accent-green transition-colors" />
                      }
                    </td>
                    {orderedCols.map(col => (
                      <td key={col}
                        className={`px-3 py-1.5 truncate ${col === meta.date_column ? 'font-mono text-[10px] text-white/45 whitespace-nowrap' : validGroupCols.includes(col) ? 'text-white/35' : 'text-white/65'}`}
                        style={{ width: colW(col), minWidth: 60, maxWidth: colW(col) }}
                        title={row[col] ?? ''}>
                        {row[col] ?? ''}
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

            {/* ── Flat rendering ─────────────────────────────────────────── */}
            {!isAnythingLoading && !groupActive && rows.map((row, idx) => {
              const key      = makeRowKey(meta.id, row)
              const isPinned = pinnedKeys.has(key)
              const rowKey   = `${idx}`
              return (
                <>
                  <tr key={idx}
                    onClick={() => setExpandedRow(r => r === rowKey ? null : rowKey)}
                    className={`border-b border-white/[0.04] cursor-pointer transition-colors group ${expandedRow === rowKey ? 'bg-accent-green/5' : 'hover:bg-white/[0.025]'}`}>
                    <td className="w-8 shrink-0 px-1 py-1.5 text-center"
                      onClick={e => { e.stopPropagation(); handlePin(row) }}>
                      {isPinned
                        ? <BookmarkCheck size={13} className="mx-auto text-accent-green/60" />
                        : <BookmarkPlus size={13} className="mx-auto text-accent-muted/20 group-hover:text-accent-muted/50 hover:!text-accent-green transition-colors" />
                      }
                    </td>
                    {orderedCols.map(col => (
                      <td key={col}
                        className={`px-3 py-1.5 truncate ${col === meta.date_column ? 'font-mono text-[10px] text-white/45 whitespace-nowrap' : 'text-white/65'}`}
                        style={{ width: colW(col), minWidth: 60, maxWidth: colW(col) }}
                        title={row[col] ?? ''}>
                        {row[col] ?? ''}
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

            {/* Grouped row count footer */}
            {!isAnythingLoading && groupActive && flatItems && flatItems.length > 0 && groupRowCount > 0 && (
              <tr className="border-t border-white/5">
                <td colSpan={orderedCols.length + 1} className="px-3 py-1.5 text-[9px] text-accent-muted/25 text-right">
                  {groupRowCount.toLocaleString()} lignes affichées
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

function OmniSearchView({ caseId, query, onOpenFile }: {
  caseId: string; query: string; onOpenFile: (id: string) => void
}) {
  const { data, isLoading } = useQuery({
    queryKey: ['csv-omni', caseId, query],
    queryFn:  () => csvArtifactsApi.search(caseId, query),
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
  const previewCols = file.columns.slice(0, 6)
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
            Open file →
          </button>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-[10px]" style={{ minWidth: previewCols.length * 160 + 'px' }}>
          <thead>
            <tr className="border-b border-white/5">
              {previewCols.map(col => (
                <th key={col} className="px-3 py-1.5 text-left font-medium text-accent-muted/30 uppercase tracking-widest whitespace-nowrap">{col}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {file.rows.slice(0, 5).map((row, i) => (
              <tr key={i} className={`border-b border-white/[0.03] ${i % 2 === 0 ? '' : 'bg-white/[0.015]'}`}>
                {previewCols.map(col => (
                  <td key={col} className="px-3 py-1.5 text-white/60 font-mono truncate" style={{ maxWidth: 200 }}>
                    {highlight(row[col] ?? '')}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── Pinned panel ──────────────────────────────────────────────────────────────

function PinnedPanel({ pinned, onUnpin, onClear, onExport, exporting }: {
  pinned:    PinnedRow[]
  onUnpin:   (key: string) => void
  onClear:   () => void
  onExport:  () => void
  exporting: boolean
}) {
  const sorted = useMemo(() => [...pinned].sort((a, b) => {
    const ta = a.dateColumn ? a.row[a.dateColumn] ?? '' : ''
    const tb = b.dateColumn ? b.row[b.dateColumn] ?? '' : ''
    return ta.localeCompare(tb)
  }), [pinned])

  return (
    <div className="w-64 shrink-0 border-l border-white/5 bg-bg-card flex flex-col overflow-hidden">
      <div className="flex items-center justify-between px-3 py-3 border-b border-white/5 shrink-0">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-accent-muted/50 flex items-center gap-1.5">
          <BookmarkCheck size={10} />
          Sélection
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
            Cliquez sur <BookmarkPlus size={9} className="inline" /> dans une ligne pour l'épingler ici
          </p>
        </div>
      )}

      {pinned.length > 0 && (
        <div className="flex-1 overflow-y-auto divide-y divide-white/[0.04]">
          {sorted.map(item => {
            const ts = item.dateColumn ? item.row[item.dateColumn] : null
            const mainVal = Object.entries(item.row)
              .filter(([k]) => k !== item.dateColumn)
              .find(([, v]) => v?.trim())?.[1] ?? ''
            const secondVal = Object.entries(item.row)
              .filter(([k]) => k !== item.dateColumn)
              .find(([, v], i) => i > 0 && v?.trim())?.[1] ?? ''

            return (
              <div key={item.key} className="group relative px-3 py-2.5 hover:bg-white/[0.02] transition-colors">
                <div className="flex items-start gap-2 pr-5">
                  <div className="flex-1 min-w-0">
                    {item.ezLabel
                      ? <span className="text-[8px] font-semibold px-1.5 py-0.5 rounded border bg-blue-500/10 text-blue-400 border-blue-500/20">{item.ezLabel}</span>
                      : <span className="text-[8px] text-accent-muted/30 font-mono truncate block">{item.artifactName}</span>
                    }
                    {ts && (
                      <p className="text-[10px] font-mono text-white/50 mt-0.5 truncate">{ts}</p>
                    )}
                    {mainVal && (
                      <p className="text-[10px] text-white/70 mt-0.5 truncate leading-snug">{mainVal}</p>
                    )}
                    {secondVal && (
                      <p className="text-[9px] text-accent-muted/35 truncate leading-snug">{secondVal}</p>
                    )}
                  </div>
                </div>
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
            {pinned.length} événement{pinned.length > 1 ? 's' : ''} trié{pinned.length > 1 ? 's' : ''} chronologiquement
          </p>
        )}
      </div>
    </div>
  )
}

// ── Sidebar file row ──────────────────────────────────────────────────────────

function FileSidebarRow({ meta, isOpen, onOpen, onDelete }: {
  meta: CsvArtifactMeta; isOpen: boolean; onOpen: () => void; onDelete: () => void
}) {
  return (
    <div onClick={onOpen}
      className={`group relative px-3 py-2.5 cursor-pointer border-l-2 transition-colors ${isOpen ? 'bg-accent-green/5 border-l-accent-green/40' : 'border-l-transparent hover:bg-white/[0.03]'}`}>
      <div className="flex items-start gap-2 pr-5">
        <FileText size={12} className="mt-0.5 shrink-0 text-accent-muted/30" />
        <div className="flex-1 min-w-0">
          <p className="text-[11px] text-white/80 truncate leading-snug font-mono">{meta.original_name}</p>
          <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
            {meta.ez_label
              ? <EZBadge label={meta.ez_label} />
              : <span className="text-[8px] font-semibold px-1.5 py-0.5 rounded border bg-gray-500/10 text-gray-500 border-gray-500/20">unknown</span>
            }
            <span className="text-[9px] text-accent-muted/40">{meta.row_count.toLocaleString()} rows</span>
          </div>
          <p className="text-[9px] text-accent-muted/25 mt-0.5">{fmtRelative(meta.uploaded_at)}</p>
        </div>
      </div>
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

  const handleFiles = async (fileList: FileList | null) => {
    if (!fileList || !caseId) return
    setUploadErr(null)
    setUploading(true)
    let lastId: string | null = null
    for (const file of Array.from(fileList)) {
      if (!file.name.endsWith('.csv') && file.type !== 'text/csv') {
        setUploadErr('Only .csv files are supported.')
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

  const [pinnedRows, setPinnedRows] = useState<PinnedRow[]>([])
  const [exporting,  setExporting]  = useState(false)

  const pinnedKeySet = useMemo(() => new Set(pinnedRows.map(p => p.key)), [pinnedRows])

  const handlePinToggle = useCallback((key: string, row: Record<string, string>, meta: CsvArtifactMeta) => {
    setPinnedRows(prev => {
      if (prev.some(p => p.key === key)) return prev.filter(p => p.key !== key)
      return [...prev, {
        key,
        artifactId:   meta.id,
        artifactName: meta.original_name,
        ezLabel:      meta.ez_label,
        dateColumn:   meta.date_column,
        columns:      meta.columns,
        row,
      }]
    })
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
          ? (() => { try { return new Date(dateVal.replace(' ', 'T')).toISOString() } catch { return new Date().toISOString() } })()
          : new Date().toISOString()
        const mainEntry = Object.entries(item.row).find(([k, v]) => k !== item.dateColumn && v?.trim())
        const title = ((item.ezLabel ?? item.artifactName) + (mainEntry ? ' — ' + mainEntry[1] : '')).slice(0, 120)
        const description = Object.entries(item.row)
          .filter(([k]) => k !== item.dateColumn)
          .slice(0, 8)
          .map(([k, v]) => `${k}: ${v}`)
          .join('\n')
        await timelineApi.create(caseId, {
          event_ts: ts, title, actor: '',
          source: item.ezLabel ?? item.artifactName,
          description, tags: '',
        })
      }
      qc.invalidateQueries({ queryKey: ['timeline', caseId] })
      setPinnedRows([])
    } finally {
      setExporting(false)
    }
  }, [caseId, pinnedRows, qc])

  const [omniQuery,     setOmniQuery]     = useState('')
  const [omniDebounced, setOmniDebounced] = useState('')
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
              className={`w-full bg-white/5 border rounded pl-7 pr-6 py-1.5 text-[11px] text-white placeholder:text-accent-muted/30 outline-none transition-colors ${omniQuery ? 'border-blue-400/30 bg-blue-500/5' : 'border-white/8 focus:border-white/20'}`} />
            {omniQuery && (
              <button onClick={() => { setOmniQuery(''); setOmniDebounced('') }}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-accent-muted/40 hover:text-white"><X size={10} /></button>
            )}
          </div>
        </div>

        <div className="px-3 py-2 border-b border-white/5 shrink-0">
          <input ref={fileRef} type="file" accept=".csv,text/csv" multiple className="sr-only"
            onChange={e => handleFiles(e.target.files)} />
          <button onClick={() => fileRef.current?.click()} disabled={uploading}
            className="w-full flex items-center justify-center gap-1.5 text-[11px] py-1.5 rounded border border-dashed border-white/15 text-accent-muted hover:text-accent-green hover:border-accent-green/30 transition-colors disabled:opacity-40">
            {uploading ? <Loader2 size={11} className="animate-spin" /> : <Upload size={11} />}
            {uploading ? 'Uploading…' : 'Upload .csv'}
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
              onDelete={() => deleteMutation.mutate(f.id)} />
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
          <OmniSearchView caseId={caseId} query={omniDebounced} onOpenFile={openFile} />
        ) : activeTab && activeMeta ? (
          <ArtifactTableView key={activeTab} caseId={caseId} meta={activeMeta}
            state={tabStates[activeTab] ?? defaultTabState()}
            onStateChange={patch => updateTabState(activeTab, patch)}
            pinnedKeys={pinnedKeySet}
            onPinToggle={(key, row) => handlePinToggle(key, row, activeMeta)} />
        ) : (
          <div className={`flex-1 flex flex-col items-center justify-center gap-4 transition-colors ${dragging ? 'bg-accent-green/5' : ''}`}>
            <Table2 size={48} className="text-accent-muted/15" />
            <div className="text-center">
              <p className="text-white/40 text-sm">Select a file from the sidebar</p>
              <p className="text-accent-muted/30 text-xs mt-1">or drop CSV files here to upload</p>
            </div>
            {dragging && (
              <div className="border-2 border-dashed border-accent-green/40 rounded-xl px-12 py-6 text-accent-green/60 text-sm">
                Drop CSV files to upload
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
        exporting={exporting}
      />
    </div>
  )
}
