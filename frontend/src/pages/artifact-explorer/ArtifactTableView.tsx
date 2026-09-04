/**
 * The Artifact Explorer grid.
 *
 * This is the one table in the product that does not go through the DataTable
 * primitive, and that is a decision rather than an omission.
 *
 * Its columns are resizable, reorderable by dragging their header, and
 * droppable onto the group-by bar; its rows are a lazily-fetched tree of group
 * headers and leaves; its first column is sticky across a horizontal scroll of
 * arbitrary width. Fourteen other tables need none of that. Pushing it into the
 * shared primitive would add drag-and-drop, resizing and tree rendering to a
 * component whose whole value is that it is small enough to be predictable —
 * making it worse for every other consumer to serve this one screen.
 *
 * What it does share is the *contract*: hairline row separators and no zebra,
 * mono uppercase headers, a sticky header, the pin as the first column, filters
 * in the header under the thing they filter, and detail in a row beneath its
 * parent. If that contract changes in docs/UI_PATTERNS.md, it changes here too.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'

import {
  csvArtifactsApi,
  type ArtifactRowFilters, type CsvArtifactMeta, type GroupResult,
} from '../../api/csvArtifacts'
import {
  ArrowDown, ArrowUp, BookmarkCheck, BookmarkPlus, ChevronDown, ChevronLeft,
  ChevronRight, ChevronRight as ChevronRightIcon, ChevronsLeft, ChevronsRight,
  Columns3, Download, GripVertical, Layers, Loader2, Search, SlidersHorizontal, X,
} from '../../ui/icons'
import { color } from '../../styles/tokens'
import { RQLBar } from './RQLBar'
import type { ColFilter, ColFilters, FilterMode, FlatItem, TabState } from './types'

export function makeRowKey(artifactId: string, row: Record<string, string>): string {
  return `${artifactId}\x1f${Object.values(row).join('\x1e')}`
}

/**
 * Build a flat list for rendering from backend group results.
 * Groups are only the aggregation layer — rows are fetched lazily on expand.
 */
export function buildGroupTree(
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

export const MODES: FilterMode[] = ['contains', '=', '!contains', '!=']
export const MODE_LABEL: Record<FilterMode, string> = { 'contains': '~', '=': '=', '!contains': '!~', '!=': '≠' }

// ── ColFilterInput ─────────────────────────────────────────────────────────────

export function ColFilterInput({ filter, onChange }: {
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
      className={`flex items-center h-6 rounded-control border overflow-hidden transition-colors ${active ? 'border-accent/50 bg-accent/5' : 'border-hairline bg-white/[0.03]'}`}
      onClick={e => e.stopPropagation()}
    >
      <button onClick={cycleMode} title={`Mode: ${filter.mode}`}
        className={`flex items-center justify-center shrink-0 w-6 h-full border-r text-label font-mono font-bold transition-colors select-none ${active ? 'border-accent/30 text-accent hover:bg-accent/10' : 'border-hairline text-fg-secondary/50 hover:text-fg hover:bg-fg/5'}`}>
        {MODE_LABEL[filter.mode]}
      </button>
      <input value={filter.value} onChange={e => onChange({ ...filter, value: e.target.value })}
        onClick={e => e.stopPropagation()} placeholder="filter…"
        className={`flex-1 min-w-0 px-1.5 text-label bg-transparent outline-none placeholder:text-fg/15 ${active ? 'text-fg/90' : 'text-fg/60'}`}
        style={{ height: '100%' }} />
      {active && (
        <button onClick={e => { e.stopPropagation(); onChange({ ...filter, value: '' }) }}
          className="shrink-0 pr-1 text-fg-secondary/40 hover:text-severity-critical transition-colors">
          <X size={8} />
        </button>
      )}
    </div>
  )
}

// ── ColumnToggler ─────────────────────────────────────────────────────────────

export function ColumnToggler({ columns, hidden, onChange }: {
  columns: string[]; hidden: string[]; onChange: (h: string[]) => void
}) {
  const [open, setOpen] = useState(false)
  const hiddenSet = new Set(hidden)
  const visibleCount = columns.length - hidden.length

  return (
    <div className="relative">
      <button onClick={() => setOpen(o => !o)}
        className={`flex items-center gap-1.5 px-2 py-1.5 rounded-control border text-label transition-colors ${hidden.length > 0 ? 'border-accent/30 text-accent bg-accent/5' : 'border-hairline text-fg-secondary hover:text-fg hover:border-strong'}`}>
        <Columns3 size={10} />
        <span>{visibleCount}/{columns.length} cols</span>
        <ChevronDown size={9} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-1 z-50 bg-panel border border-hairline shadow-xl w-64 max-h-72 overflow-y-auto py-1">
            <div className="flex items-center justify-between px-3 py-1.5 border-b border-hairline">
              <span className="text-label uppercase tracking-widest text-fg-secondary/40">Columns</span>
              <div className="flex gap-2">
                <button onClick={() => onChange([])} className="text-label text-accent/60 hover:text-accent">All</button>
                <button onClick={() => onChange([...columns])} className="text-label text-fg-secondary/40 hover:text-fg">None</button>
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
                  className="accent-accent w-3 h-3" />
                <span className="text-label text-fg/70 font-mono truncate">{col}</span>
              </label>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

// ── PaginationBar ─────────────────────────────────────────────────────────────

export function PaginationBar({ page, pages, total, pageSize, onPage, onPageSize }: {
  page: number; pages: number; total: number; pageSize: number
  onPage: (p: number) => void; onPageSize: (s: number) => void
}) {
  const from = (page - 1) * pageSize + 1
  const to   = Math.min(page * pageSize, total)
  return (
    <div className="flex items-center gap-3 px-3 py-2 border-t border-hairline bg-panel/30 shrink-0">
      <select value={pageSize} onChange={e => onPageSize(Number(e.target.value))}
        className="bg-fg/5 border border-hairline rounded-control px-2 py-1 text-label text-fg-secondary outline-none">
        {[50, 100, 200, 500].map(s => <option key={s} value={s}>{s} / page</option>)}
      </select>
      <span className="text-label text-fg-secondary/40">{from.toLocaleString()}–{to.toLocaleString()} of {total.toLocaleString()}</span>
      <div className="flex items-center gap-0.5 ml-auto">
        <button onClick={() => onPage(1)}        disabled={page === 1}     className="p-1 rounded-control text-fg-secondary/40 hover:text-fg disabled:opacity-20"><ChevronsLeft  size={13} /></button>
        <button onClick={() => onPage(page - 1)} disabled={page === 1}     className="p-1 rounded-control text-fg-secondary/40 hover:text-fg disabled:opacity-20"><ChevronLeft   size={13} /></button>
        {Array.from({ length: Math.min(7, pages) }, (_, i) => {
          let p: number
          if (pages <= 7)             p = i + 1
          else if (page <= 4)         p = i + 1
          else if (page >= pages - 3) p = pages - 6 + i
          else                        p = page - 3 + i
          return (
            <button key={p} onClick={() => onPage(p)}
              className={`w-6 h-6 rounded-control text-label transition-colors ${p === page ? 'bg-accent/15 text-accent' : 'text-fg-secondary/50 hover:text-fg'}`}>{p}</button>
          )
        })}
        <button onClick={() => onPage(page + 1)} disabled={page === pages} className="p-1 rounded-control text-fg-secondary/40 hover:text-fg disabled:opacity-20"><ChevronRight  size={13} /></button>
        <button onClick={() => onPage(pages)}    disabled={page === pages} className="p-1 rounded-control text-fg-secondary/40 hover:text-fg disabled:opacity-20"><ChevronsRight size={13} /></button>
      </div>
    </div>
  )
}

// ── ColResizeHandle ───────────────────────────────────────────────────────────

export function ColResizeHandle({ col, onStart, onReset }: {
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
      <div className="w-px h-4 bg-fg/10 group-hover/rh:bg-accent/50 transition-colors" />
    </div>
  )
}

// ── GroupByBar ────────────────────────────────────────────────────────────────

export function GroupByBar({ groupByCols, onRemove, onAdd, onClear, isDragging }: {
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
      className={`flex items-center gap-1.5 px-3 py-1.5 border-b shrink-0 min-h-[34px] transition-all duration-150 ${ isOver
          ? 'border-accent/40 bg-accent/[0.06]'
          : isDragging
          ? 'border-accent/20 bg-accent/[0.02]'
          : 'border-hairline'
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
      <span className="text-label text-fg-secondary/30 uppercase tracking-widest shrink-0 select-none flex items-center gap-1">
        <Layers size={9} />
        Group by
      </span>

      {hasGroups && groupByCols.map((col, i) => (
        <span key={col}
          className="flex items-center gap-0.5 px-1.5 py-0.5 rounded-control border border-accent/30 bg-accent/[0.08] text-label text-accent shrink-0 select-none">
          {i > 0 && <ChevronRightIcon size={8} className="text-accent/30 mx-0.5" />}
          <span>{col}</span>
          <button
            onClick={() => onRemove(col)}
            className="text-accent/40 hover:text-severity-critical transition-colors ml-1">
            <X size={7} />
          </button>
        </span>
      ))}

      <span className={`text-label italic select-none pointer-events-none ${ isOver ? 'text-accent/60' : isDragging ? 'text-accent/40' : 'text-fg-secondary/20'
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
          className="ml-auto text-label text-fg-secondary/30 hover:text-severity-critical transition-colors shrink-0 flex items-center gap-0.5">
          <X size={8} /> Clear
        </button>
      )}
    </div>
  )
}

// ── GroupRowsFetcher ──────────────────────────────────────────────────────────
// Fetches and renders rows for a single expanded leaf group inside a <tbody>.

export function GroupRowsFetcher({ caseId, meta, baseFilters, groupFilters, orderedCols, colW, depth, pinnedKeys, exportedKeys, onPinToggle }: {
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
          <Loader2 size={10} className="animate-spin text-fg-secondary/30" />
          <span className="text-label text-fg-secondary/30">Loading...</span>
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
            className={`border-b border-strong/[0.03] transition-colors group ${ isPinned ? 'bg-accent/[0.04]' : isExported ? 'bg-severity-low/[0.02]' : 'hover:bg-white/[0.02]'
            }`}>
            <td className={`w-8 shrink-0 px-1 py-1 text-center sticky left-0 z-[4] shadow-[1px_0_0_rgba(255,255,255,0.04)] ${isPinned ? 'bg-accent/[0.04]' : isExported ? 'bg-severity-low/[0.02]' : 'bg-canvas'}`}
              onClick={e => { e.stopPropagation(); onPinToggle(key, row) }}
              title={isExported && !isPinned ? 'Exported to the Timeline' : undefined}>
              {isPinned
                ? <BookmarkCheck size={12} className="mx-auto text-accent/60" />
                : isExported
                  ? <BookmarkCheck size={12} className="mx-auto text-severity-low/50" />
                  : <BookmarkPlus size={12} className="mx-auto text-fg-secondary/15 group-hover:text-fg-secondary/40 hover:!text-accent transition-colors cursor-pointer" />
              }
            </td>
            {orderedCols.map((col, ci) => (
              <td key={col}
                className={`py-1 truncate text-label ${col === meta.date_column ? 'font-mono text-fg/40 whitespace-nowrap' : Object.keys(groupFilters).includes(col) ? 'text-fg/30' : 'text-fg/60'}`}
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
          <td colSpan={colSpanAll} className="py-1 border-b border-strong/[0.03]">
            <div className="flex items-center gap-1.5 text-label text-fg-secondary/40" style={{ paddingLeft: indent + 12 }}>
              <span>{total.toLocaleString()} rows</span>
              <div className="flex items-center gap-0.5 ml-2">
                <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
                  className="p-0.5 rounded-control hover:text-fg disabled:opacity-20"><ChevronLeft size={10} /></button>
                <span className="text-accent/60">{page}/{pages}</span>
                <button onClick={() => setPage(p => Math.min(pages, p + 1))} disabled={page === pages}
                  className="p-0.5 rounded-control hover:text-fg disabled:opacity-20"><ChevronRight size={10} /></button>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  )
}

// ── ArtifactTableView ─────────────────────────────────────────────────────────

export function ArtifactTableView({
  caseId, meta, state, onStateChange, pinnedKeys, exportedKeys, onPinToggle,
  selectedKey, onSelectRow,
}: {
  caseId:        string
  meta:          CsvArtifactMeta
  state:         TabState
  onStateChange: (patch: Partial<TabState>) => void
  pinnedKeys:    Set<string>
  exportedKeys:  Set<string>
  onPinToggle:   (key: string, row: Record<string, string>) => void
  /** The row currently open in the detail panel, by its pin key. */
  selectedKey:   string | null
  /** Clicking a row hands it to the page, which shows it on the right. */
  onSelectRow:   (row: Record<string, string> | null, columns: string[], key: string) => void
}) {
  const [showFilters,    setShowFilters]    = useState(false)
  const [localSearch,    setLocalSearch]    = useState(state.filters.q ?? '')
  const [draggingCol,    setDraggingCol]    = useState<string | null>(null)
  const [dragOverCol,    setDragOverCol]    = useState<string | null>(null)
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set())
  const [localRql,       setLocalRql]       = useState(state.rql ?? '')
  const [rqlError,       setRqlError]       = useState<string | null>(null)

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
        <mark
          className="rounded-control px-px"
          style={{ background: color('--severity-high', 0.28), color: color('--severity-high') }}
        >
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
  // Typing is deliberately inert: a long query passes through many states that
  // are syntactically valid but semantically wrong, and running those would
  // throw away the very results being narrowed down. Only Enter commits.
  const handleRqlChange = useCallback((val: string) => {
    setLocalRql(val)
    setRqlError(null)
  }, [])

  const handleRqlRun = useCallback((val: string) => {
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
    // The open row is almost certainly no longer in the result set.
    onSelectRow(null, [], '')
  }, [state.filters, onStateChange, onSelectRow])

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
        dirty={localRql !== (state.rql ?? '')}
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
      <div className="flex items-center gap-2 px-3 py-2 border-b border-hairline bg-panel/30 shrink-0 flex-wrap">
        <div className="relative flex-1 min-w-[160px] max-w-xs">
          <Search size={11} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-secondary/30" />
          <input value={localSearch} onChange={e => handleSearch(e.target.value)}
            placeholder="Search all columns…"
            className="w-full bg-fg/5 border border-hairline rounded-control pl-7 pr-3 py-1.5 text-label text-fg placeholder:text-fg-secondary/30 outline-none focus:border-accent/30 transition-colors" />
          {localSearch && (
            <button onClick={() => { setLocalSearch(''); updateFilters({ q: undefined, page: 1 }) }}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-fg-secondary/40 hover:text-fg"><X size={10} /></button>
          )}
        </div>

        {!groupActive && (
          <button onClick={() => updateFilters({ sort_dir: state.filters.sort_dir === 'asc' ? 'desc' : 'asc', page: 1 })}
            className="flex items-center gap-1 px-2 py-1.5 rounded-control border border-hairline text-label text-fg-secondary hover:text-fg hover:border-strong transition-colors" title="Toggle sort direction">
            {state.filters.sort_dir === 'asc' ? <ArrowUp size={10} /> : <ArrowDown size={10} />}
            <span>{state.filters.sort_dir === 'asc' ? 'Oldest first' : 'Newest first'}</span>
          </button>
        )}

        <button onClick={() => setShowFilters(s => !s)}
          className={`flex items-center gap-1 px-2 py-1.5 rounded-control border text-label transition-colors ${activeTotal > 0 ? 'border-accent/30 text-accent bg-accent/5' : 'border-hairline text-fg-secondary hover:text-fg hover:border-strong'}`}>
          <SlidersHorizontal size={10} />
          Filters {activeTotal > 0 && `(${activeTotal})`}
          <ChevronDown size={9} className={`transition-transform ${showFilters ? 'rotate-180' : ''}`} />
        </button>

        {activeTotal > 0 && (
          <button onClick={handleReset} className="text-label text-fg-secondary/50 hover:text-severity-critical transition-colors">Reset</button>
        )}

        <ColumnToggler columns={allCols} hidden={state.hiddenCols}
          onChange={h => onStateChange({ hiddenCols: h })} />

        {groupActive && !groupLoading && (
          <button onClick={toggleAllGroups}
            className="flex items-center gap-1 px-2 py-1.5 rounded-control border border-hairline text-label text-fg-secondary hover:text-fg hover:border-strong transition-colors">
            {allExpanded
              ? <><ChevronsLeft size={10} className="rotate-90" /> Replier tout</>
              : <><ChevronsRight size={10} className="rotate-90" /> Expand all</>
            }
          </button>
        )}

        {state.colOrder?.length > 0 && (
          <button onClick={() => onStateChange({ colOrder: [] })}
            className="text-label text-fg-secondary/40 hover:text-fg border border-hairline px-2 py-1.5 rounded-control transition-colors">
            Reset order
          </button>
        )}

        <button onClick={handleExport} title="Export filtered CSV"
          className="flex items-center gap-1 px-2 py-1.5 rounded-control border border-hairline text-label text-fg-secondary hover:text-fg hover:border-strong transition-colors">
          <Download size={10} /> Export
        </button>

        <div className="ml-auto text-label text-fg-secondary/40 whitespace-nowrap">
          {groupActive
            ? <><span className="text-fg/60">{(groupData?.total_groups ?? 0).toLocaleString()}</span> groups · {meta.row_count.toLocaleString()} rows</>
            : total < meta.row_count
            ? <><span className="text-fg/60">{total.toLocaleString()}</span> / {meta.row_count.toLocaleString()} rows</>
            : <><span className="text-fg/60">{total.toLocaleString()}</span> rows</>
          }
        </div>
      </div>

      {/* Refetch progress bar */}
      <div className={`h-0.5 shrink-0 overflow-hidden transition-opacity duration-150 ${isAnythingFetching && !isAnythingLoading ? 'opacity-100' : 'opacity-0'}`}>
        <div className="h-full bg-accent/50 animate-[shimmer_1.4s_ease-in-out_infinite]"
          style={{
            background: `linear-gradient(90deg, transparent 0%, ${color('--accent')} 40%, ${color('--accent')} 60%, transparent 100%)`,
            backgroundSize: '200% 100%',
            animation: 'shimmer 1.4s ease-in-out infinite',
          }} />
      </div>


      {/* Table area */}
      <div className={`flex-1 overflow-auto relative transition-opacity duration-150 ${isAnythingFetching && !isAnythingLoading ? 'opacity-50' : 'opacity-100'}`}>
        <table className="w-full border-collapse text-label"
          style={{ minWidth: Math.max(800, orderedCols.length * 160 + 32) + 'px' }}>
          <thead className="sticky top-0 z-10 bg-panel">
            {/* Column name row */}
            <tr className="border-b border-hairline">
              <th className="w-8 shrink-0 px-1 pt-2 pb-1 sticky left-0 z-[12] bg-panel after:content-[''] after:absolute after:right-0 after:top-0 after:bottom-0 after:w-px after:bg-fg/8" />
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
                    className={`relative px-3 pt-2 pb-1 text-left font-medium text-label uppercase tracking-widest whitespace-nowrap transition-colors select-none ${groupActive ? 'cursor-grab active:cursor-grabbing text-fg-secondary/40' : 'cursor-pointer hover:text-fg/60 text-fg-secondary/40'}
                      ${isDragSrc ? 'opacity-40' : ''}
                      ${isDragTgt ? 'border-l-2 border-l-accent/60' : ''}
                    `}
                    style={{ width: w, minWidth: 60 }}>
                    <span className="flex items-center gap-1 pr-2">
                      <GripVertical size={8} className="text-fg-secondary/20 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
                      {col}
                      {isSort && (state.filters.sort_dir === 'asc' ? <ArrowUp size={9} className="text-accent" /> : <ArrowDown size={9} className="text-accent" />)}
                    </span>
                    <ColResizeHandle col={col} onStart={startColResize} onReset={resetColWidth} />
                  </th>
                )
              })}
            </tr>
            {/* Per-column filter row */}
            {showFilters && (
              <tr className="border-b border-hairline bg-panel/80">
                <th className="w-8 shrink-0 px-1 py-1.5 sticky left-0 z-[12] bg-panel/80" />
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
              <tr key={i} className="border-b border-strong/[0.04]">
                <td className="w-8 px-1 py-2 sticky left-0 z-[4] bg-canvas" />
                {orderedCols.map(col => (
                  <td key={col} className="px-3 py-2">
                    <div className="h-3 rounded-control bg-fg/5 animate-pulse" style={{ width: `${45 + (i * 11) % 40}%` }} />
                  </td>
                ))}
              </tr>
            ))}

            {/* Empty state */}
            {!isAnythingLoading && !groupActive && rows.length === 0 && (
              <tr>
                <td colSpan={orderedCols.length + 1} className="px-3 py-12 text-center text-label text-fg-secondary/30 italic">
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
                    className="border-b border-strong/[0.06] cursor-pointer select-none hover:bg-white/[0.03] transition-colors"
                    style={{ background: item.depth === 0 ? 'rgba(255,255,255,0.025)' : item.depth === 1 ? 'rgba(255,255,255,0.015)' : undefined }}>
                    <td className="w-8 px-1 py-1.5 text-center sticky left-0 z-[4] bg-inherit">
                      <div className={`transition-transform duration-150 text-fg-secondary/40 mx-auto w-fit ${item.isExpanded ? 'rotate-90' : ''}`}>
                        <ChevronRightIcon size={12} />
                      </div>
                    </td>
                    <td colSpan={orderedCols.length} className="px-3 py-1.5">
                      <div className="flex items-center gap-2" style={{ paddingLeft: indent }}>
                        <span className="text-label text-fg-secondary/30 font-mono">{item.groupCol}:</span>
                        <span className={`text-label font-medium ${item.depth === 0 ? 'text-fg/80' : 'text-fg/65'}`}>
                          {item.groupVal === '' ? <span className="italic text-fg-secondary/30">(empty)</span> : item.groupVal}
                        </span>
                        <span className="text-label px-1.5 py-0.5 rounded-control border border-accent/20 bg-accent/5 text-accent/70 ml-1">
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
              return (
                <>
                  <tr key={idx}
                    onClick={() => onSelectRow(selectedKey === key ? null : row, allCols, key)}
                    className={`border-b cursor-pointer transition-colors group ${ isPinned
                        ? 'border-accent/20 bg-accent/[0.04] hover:bg-accent/[0.07]'
                        : isExported
                          ? 'border-severity-low/10 bg-severity-low/[0.02] hover:bg-severity-low/[0.04]'
                          : selectedKey === key
                            ? 'border-strong/[0.04] bg-accent/5'
                            : 'border-strong/[0.04] hover:bg-white/[0.025]'
                    }`}>
                    <td className={`w-8 shrink-0 px-1 py-1.5 text-center sticky left-0 z-[4] shadow-[1px_0_0_rgba(255,255,255,0.04)] ${isPinned ? 'bg-accent/[0.04]' : isExported ? 'bg-severity-low/[0.02]' : 'bg-canvas'}`}
                      onClick={e => { e.stopPropagation(); handlePin(row) }}
                      title={isExported && !isPinned ? 'Exported to the Timeline' : undefined}>
                      {isPinned
                        ? <BookmarkCheck size={13} className="mx-auto text-accent/60" />
                        : isExported
                          ? <BookmarkCheck size={13} className="mx-auto text-severity-low/50" />
                          : <BookmarkPlus size={13} className="mx-auto text-fg-secondary/20 group-hover:text-fg-secondary/50 hover:!text-accent transition-colors" />
                      }
                    </td>
                    {orderedCols.map(col => (
                      <td key={col}
                        className={`px-3 py-1.5 truncate ${col === meta.date_column ? 'font-mono text-label text-fg/45 whitespace-nowrap' : 'text-fg/65'}`}
                        style={{ width: colW(col), minWidth: 60, maxWidth: colW(col) }}
                        title={row[col] ?? ''}>
                        {highlightCell(row[col] ?? '')}
                      </td>
                    ))}
                  </tr>
                </>
              )
            })}

            {/* Grouped empty state */}
            {!isAnythingLoading && groupActive && flatItems?.length === 0 && (
              <tr>
                <td colSpan={orderedCols.length + 1} className="px-3 py-12 text-center text-label text-fg-secondary/30 italic">
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
