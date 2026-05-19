import { useState, useEffect, useCallback, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Search, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight,
  ArrowUp, ArrowDown, SlidersHorizontal, X, ChevronDown, BookmarkPlus, BookmarkCheck,
} from 'lucide-react'
import { evtxApi, type EvtxEvent, type EventFilters, type FileSummary } from '../../api/evtx'
import { fmtDateTime } from '../../utils/dateUtils'

// ── Level styling ─────────────────────────────────────────────────────────────

const LEVEL_STYLE: Record<string, string> = {
  Critical:    'bg-severity-critical/15 text-severity-critical border-severity-critical/30',
  Error:       'bg-orange-500/15 text-orange-400 border-orange-500/30',
  Warning:     'bg-yellow-500/15 text-yellow-400 border-yellow-500/30',
  Information: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
  Verbose:     'bg-white/5 text-white/40 border-white/10',
}

function LevelBadge({ name }: { name: string | null }) {
  const label = name ?? 'Information'
  const cls   = LEVEL_STYLE[label] ?? LEVEL_STYLE.Information
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded border text-[9px] font-medium ${cls}`}>
      {label}
    </span>
  )
}

// ── Field filter (EventData key/value) ───────────────────────────────────────

type FieldMode = '=' | '~' | '!=' | '!~'

const FIELD_MODES: FieldMode[] = ['=', '~', '!=', '!~']

const FIELD_MODE_LABEL: Record<FieldMode, string> = {
  '=':  '=',
  '~':  '~',
  '!=': '≠',
  '!~': '!~',
}

const FIELD_MODE_TITLE: Record<FieldMode, string> = {
  '=':  'Equals',
  '~':  'Contains',
  '!=': 'Not equals',
  '!~': 'Not contains',
}

interface FieldFilter {
  id:    string
  key:   string
  mode:  FieldMode
  value: string
}

// ── Per-column filter ─────────────────────────────────────────────────────────

type FilterMode = 'contains' | '=' | '!contains' | '!='

const MODES: FilterMode[] = ['contains', '=', '!contains', '!=']

const MODE_LABEL: Record<FilterMode, string> = {
  'contains':  '~',
  '=':         '=',
  '!contains': '!~',
  '!=':        '≠',
}

const MODE_TITLE: Record<FilterMode, string> = {
  'contains':  'Contains',
  '=':         'Equals',
  '!contains': 'Not contains',
  '!=':        'Not equals',
}

interface ColFilter {
  mode:  FilterMode
  value: string
}

type ColFilters = Record<string, ColFilter>

function ColFilterInput({
  colKey,
  filter,
  onChange,
}: {
  colKey:   string
  filter:   ColFilter
  onChange: (f: ColFilter) => void
}) {
  const cycleMode = (e: React.MouseEvent) => {
    e.stopPropagation()
    const idx  = MODES.indexOf(filter.mode)
    const next = MODES[(idx + 1) % MODES.length]
    onChange({ ...filter, mode: next })
  }

  const active = filter.value.trim() !== ''

  return (
    <div
      className={`flex items-center h-6 rounded border overflow-hidden transition-colors ${
        active
          ? 'border-accent-green/50 bg-accent-green/5'
          : 'border-white/8 bg-white/[0.03]'
      }`}
      onClick={e => e.stopPropagation()}
    >
      {/* Mode toggle button */}
      <button
        onClick={cycleMode}
        title={`Mode: ${MODE_TITLE[filter.mode]} — click to change`}
        className={`
          flex items-center justify-center shrink-0 w-6 h-full border-r text-[9px] font-mono font-bold
          transition-colors select-none
          ${active
            ? 'border-accent-green/30 text-accent-green hover:bg-accent-green/10'
            : 'border-white/8 text-accent-muted/50 hover:text-white hover:bg-white/5'}
        `}
      >
        {MODE_LABEL[filter.mode]}
      </button>

      {/* Text input */}
      <input
        value={filter.value}
        onChange={e => onChange({ ...filter, value: e.target.value })}
        onClick={e => e.stopPropagation()}
        placeholder="filter…"
        className={`
          flex-1 min-w-0 px-1.5 text-[10px] bg-transparent outline-none
          placeholder:text-white/15
          ${active ? 'text-white/90' : 'text-white/60'}
        `}
        style={{ height: '100%' }}
      />

      {/* Clear button */}
      {active && (
        <button
          onClick={e => { e.stopPropagation(); onChange({ ...filter, value: '' }) }}
          className="shrink-0 pr-1 text-accent-muted/40 hover:text-severity-critical transition-colors"
        >
          <X size={8} />
        </button>
      )}
    </div>
  )
}

// ── Field filters section ─────────────────────────────────────────────────────

function FieldFiltersSection({
  filters,
  onChange,
}: {
  filters: FieldFilter[]
  onChange: (f: FieldFilter[]) => void
}) {
  const addRow = () =>
    onChange([...filters, { id: crypto.randomUUID(), key: '', mode: '=', value: '' }])

  const removeRow = (id: string) => onChange(filters.filter(f => f.id !== id))

  const updateRow = (id: string, patch: Partial<FieldFilter>) =>
    onChange(filters.map(f => f.id === id ? { ...f, ...patch } : f))

  const cycleMode = (id: string, current: FieldMode) => {
    const idx  = FIELD_MODES.indexOf(current)
    const next = FIELD_MODES[(idx + 1) % FIELD_MODES.length]
    updateRow(id, { mode: next })
  }

  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <p className="text-[9px] text-accent-muted/30 uppercase tracking-widest">
          EventData Field Filters
        </p>
        <button
          onClick={addRow}
          className="flex items-center gap-0.5 text-[9px] text-accent-green/60 hover:text-accent-green transition-colors"
        >
          + Add filter
        </button>
      </div>

      {filters.length === 0 && (
        <p className="text-[10px] text-accent-muted/25 italic">
          Filter on specific EventData fields — e.g. LogonType = 5
        </p>
      )}

      <div className="flex flex-col gap-1.5">
        {filters.map(f => (
          <div key={f.id} className="flex items-center gap-1.5">
            {/* Key input */}
            <input
              value={f.key}
              onChange={e => updateRow(f.id, { key: e.target.value })}
              placeholder="Field name (e.g. LogonType)"
              className="w-44 bg-white/5 border border-white/10 rounded px-2 py-1 text-[11px] text-white placeholder:text-white/15 outline-none focus:border-accent-green/40 font-mono"
            />

            {/* Mode toggle */}
            <button
              onClick={() => cycleMode(f.id, f.mode)}
              title={FIELD_MODE_TITLE[f.mode]}
              className="w-8 h-6 rounded border border-white/15 text-[10px] font-mono font-bold text-accent-muted hover:text-white hover:border-accent-green/40 hover:bg-accent-green/5 transition-colors shrink-0"
            >
              {FIELD_MODE_LABEL[f.mode]}
            </button>

            {/* Value input */}
            <input
              value={f.value}
              onChange={e => updateRow(f.id, { value: e.target.value })}
              placeholder="value"
              className="w-36 bg-white/5 border border-white/10 rounded px-2 py-1 text-[11px] text-white placeholder:text-white/15 outline-none focus:border-accent-green/40 font-mono"
            />

            {/* Remove */}
            <button
              onClick={() => removeRow(f.id)}
              className="text-accent-muted/30 hover:text-severity-critical transition-colors shrink-0"
            >
              <X size={11} />
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── EventData detail panel ────────────────────────────────────────────────────

function EventDetail({ event, onClose }: { event: EvtxEvent; onClose: () => void }) {
  return (
    <div className="border-t border-white/8 bg-bg-secondary/60 px-4 py-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] font-semibold text-accent-muted/60 uppercase tracking-widest">
          Event Detail — #{event.record_id ?? event.id}
        </span>
        <button onClick={onClose} className="text-accent-muted/40 hover:text-white transition-colors">
          <X size={13} />
        </button>
      </div>

      {/* Meta grid */}
      <div className="grid grid-cols-2 gap-x-6 gap-y-1 mb-3 text-[11px]">
        {([
          ['Time',     fmtDateTime(event.time_created)],
          ['Event ID', String(event.event_id ?? '—')],
          ['Level',    event.level_name ?? '—'],
          ['Channel',  event.channel ?? '—'],
          ['Provider', event.provider ?? '—'],
          ['Computer', event.computer ?? '—'],
          ['User ID',  event.user_id  ?? '—'],
          ['Record #', String(event.record_id ?? '—')],
        ] as [string, string][]).map(([k, v]) => (
          <div key={k} className="flex gap-2">
            <span className="text-accent-muted/40 w-16 shrink-0">{k}</span>
            <span className="text-white/70 font-mono break-all">{v}</span>
          </div>
        ))}
      </div>

      {/* EventData */}
      {event.event_data && Object.keys(event.event_data).length > 0 && (
        <>
          <p className="text-[9px] text-accent-muted/30 uppercase tracking-widest mb-1.5">Event Data</p>
          <div className="rounded border border-white/8 overflow-hidden">
            {Object.entries(event.event_data).map(([k, v], i) => (
              <div key={k} className={`flex text-[11px] ${i % 2 === 0 ? 'bg-white/[0.02]' : ''}`}>
                <span className="w-48 shrink-0 px-3 py-1 text-accent-muted/50 border-r border-white/5 font-mono truncate" title={k}>
                  {k}
                </span>
                <span className="flex-1 px-3 py-1 text-white/70 font-mono break-all">
                  {v || <span className="opacity-20 italic">empty</span>}
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

// ── Filter bar (global filters) ───────────────────────────────────────────────

interface FilterBarProps {
  summary:          FileSummary | undefined
  filters:          EventFilters
  onFilterChange:   (f: Partial<EventFilters>) => void
  total:            number
  filteredTotal:    number
  activeColCount:   number
  onClearCols:      () => void
  fieldFilters:     FieldFilter[]
  onFieldFilters:   (f: FieldFilter[]) => void
}

function FilterBar({
  summary, filters, onFilterChange, total, filteredTotal,
  activeColCount, onClearCols, fieldFilters, onFieldFilters,
}: FilterBarProps) {
  const [showFilters, setShowFilters] = useState(false)
  const [localSearch, setLocalSearch] = useState(filters.search ?? '')
  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)

  const handleSearch = (val: string) => {
    setLocalSearch(val)
    if (searchTimeout.current) clearTimeout(searchTimeout.current)
    searchTimeout.current = setTimeout(() => {
      onFilterChange({ search: val || undefined, page: 1 })
    }, 400)
  }

  const toggleChannel = (ch: string) => {
    const current = filters.channels ? filters.channels.split(',').filter(Boolean) : []
    const next    = current.includes(ch) ? current.filter(c => c !== ch) : [...current, ch]
    onFilterChange({ channels: next.join(',') || undefined, page: 1 })
  }

  const toggleLevel = (lv: string) => {
    const current = filters.levels ? filters.levels.split(',').filter(Boolean) : []
    const next    = current.includes(lv) ? current.filter(l => l !== lv) : [...current, lv]
    onFilterChange({ levels: next.join(',') || undefined, page: 1 })
  }

  const selectedChannels = filters.channels ? filters.channels.split(',').filter(Boolean) : []
  const selectedLevels   = filters.levels   ? filters.levels.split(',').filter(Boolean)   : []
  const activeField      = fieldFilters.filter(f => f.key.trim() && f.value.trim()).length
  const activeGlobal     = selectedChannels.length + selectedLevels.length + (filters.search ? 1 : 0)
  const activeTotal      = activeGlobal + activeColCount + activeField

  const handleReset = () => {
    setLocalSearch('')
    onFilterChange({
      search: undefined, channels: undefined, levels: undefined,
      event_ids: undefined, time_from: undefined, time_to: undefined, page: 1,
    })
    onClearCols()
    onFieldFilters([])
  }

  return (
    <div className="border-b border-white/5 bg-bg-secondary/30">
      <div className="flex items-center gap-2 px-3 py-2">
        {/* Search */}
        <div className="relative flex-1 max-w-xs">
          <Search size={11} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-accent-muted/30" />
          <input
            value={localSearch}
            onChange={e => handleSearch(e.target.value)}
            placeholder="Search all columns…"
            className="w-full bg-white/5 border border-white/8 rounded pl-7 pr-3 py-1.5 text-[11px] text-white placeholder:text-accent-muted/30 outline-none focus:border-accent-green/30 transition-colors"
          />
          {localSearch && (
            <button
              onClick={() => { setLocalSearch(''); onFilterChange({ search: undefined, page: 1 }) }}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-accent-muted/40 hover:text-white"
            ><X size={10} /></button>
          )}
        </div>

        {/* Sort direction */}
        <button
          onClick={() => onFilterChange({ sort_dir: filters.sort_dir === 'asc' ? 'desc' : 'asc', page: 1 })}
          className="flex items-center gap-1 px-2 py-1.5 rounded border border-white/8 text-[10px] text-accent-muted hover:text-white hover:border-white/20 transition-colors"
          title="Toggle sort direction"
        >
          {filters.sort_dir === 'asc' ? <ArrowUp size={10} /> : <ArrowDown size={10} />}
          <span>{filters.sort_dir === 'asc' ? 'Oldest first' : 'Newest first'}</span>
        </button>

        {/* Toggle advanced */}
        <button
          onClick={() => setShowFilters(s => !s)}
          className={`flex items-center gap-1 px-2 py-1.5 rounded border text-[10px] transition-colors ${
            activeGlobal > 0
              ? 'border-accent-green/30 text-accent-green bg-accent-green/5'
              : 'border-white/8 text-accent-muted hover:text-white hover:border-white/20'
          }`}
        >
          <SlidersHorizontal size={10} />
          Filters {activeTotal > 0 && `(${activeTotal})`}
          <ChevronDown size={9} className={`transition-transform ${showFilters ? 'rotate-180' : ''}`} />
        </button>

        {/* Column filter indicator */}
        {activeColCount > 0 && (
          <span className="text-[10px] text-accent-green/60 bg-accent-green/5 border border-accent-green/20 rounded px-2 py-1">
            {activeColCount} col filter{activeColCount > 1 ? 's' : ''}
          </span>
        )}

        {/* Field filter indicator */}
        {activeField > 0 && (
          <span className="text-[10px] text-blue-400/70 bg-blue-500/5 border border-blue-500/20 rounded px-2 py-1">
            {activeField} field filter{activeField > 1 ? 's' : ''}
          </span>
        )}

        {/* Reset all */}
        {activeTotal > 0 && (
          <button
            onClick={handleReset}
            className="text-[10px] text-accent-muted/50 hover:text-severity-critical transition-colors"
          >
            Reset all
          </button>
        )}

        {/* Stats */}
        <div className="ml-auto text-[10px] text-accent-muted/40 whitespace-nowrap">
          {filteredTotal < total
            ? <><span className="text-white/60">{filteredTotal.toLocaleString()}</span> / {total.toLocaleString()} events</>
            : <><span className="text-white/60">{total.toLocaleString()}</span> events</>
          }
        </div>
      </div>

      {/* Advanced panel */}
      {showFilters && summary && (
        <div className="px-3 pb-3 flex flex-wrap gap-4">
          {summary.channels.length > 0 && (
            <div>
              <p className="text-[9px] text-accent-muted/30 uppercase tracking-widest mb-1.5">Channel</p>
              <div className="flex flex-wrap gap-1">
                {summary.channels.map(ch => {
                  const active = selectedChannels.includes(ch.channel)
                  return (
                    <button key={ch.channel} onClick={() => toggleChannel(ch.channel)}
                      className={`px-2 py-0.5 rounded border text-[10px] transition-colors ${
                        active ? 'border-accent-green/50 bg-accent-green/10 text-accent-green'
                               : 'border-white/10 text-accent-muted hover:text-white hover:border-white/20'
                      }`}
                    >
                      {ch.channel} <span className="opacity-40">{ch.event_count.toLocaleString()}</span>
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {Object.keys(summary.levels).length > 0 && (
            <div>
              <p className="text-[9px] text-accent-muted/30 uppercase tracking-widest mb-1.5">Level</p>
              <div className="flex flex-wrap gap-1">
                {Object.entries(summary.levels).map(([lv, cnt]) => {
                  const active = selectedLevels.includes(lv)
                  const cls    = LEVEL_STYLE[lv] ?? LEVEL_STYLE.Information
                  return (
                    <button key={lv} onClick={() => toggleLevel(lv)}
                      className={`px-2 py-0.5 rounded border text-[10px] transition-colors ${
                        active ? cls : 'border-white/10 text-accent-muted hover:text-white'
                      }`}
                    >
                      {lv} <span className="opacity-40">{cnt.toLocaleString()}</span>
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          <div>
            <p className="text-[9px] text-accent-muted/30 uppercase tracking-widest mb-1.5">Event ID</p>
            <input
              value={filters.event_ids ?? ''}
              onChange={e => onFilterChange({ event_ids: e.target.value || undefined, page: 1 })}
              placeholder="e.g. 4624,4625"
              className="bg-white/5 border border-white/8 rounded px-2 py-1 text-[11px] text-white placeholder:text-accent-muted/30 outline-none focus:border-accent-green/30 w-36"
            />
          </div>

          <div>
            <p className="text-[9px] text-accent-muted/30 uppercase tracking-widest mb-1.5">Date range</p>
            <div className="flex items-center gap-2">
              <input type="datetime-local"
                value={filters.time_from?.slice(0, 16) ?? ''}
                onChange={e => onFilterChange({ time_from: e.target.value || undefined, page: 1 })}
                className="bg-white/5 border border-white/8 rounded px-2 py-1 text-[11px] text-white outline-none focus:border-accent-green/30 w-44"
              />
              <span className="text-accent-muted/30 text-[10px]">→</span>
              <input type="datetime-local"
                value={filters.time_to?.slice(0, 16) ?? ''}
                onChange={e => onFilterChange({ time_to: e.target.value || undefined, page: 1 })}
                className="bg-white/5 border border-white/8 rounded px-2 py-1 text-[11px] text-white outline-none focus:border-accent-green/30 w-44"
              />
            </div>
          </div>

          {/* EventData field filters */}
          <div className="w-full border-t border-white/5 pt-3 mt-1">
            <FieldFiltersSection filters={fieldFilters} onChange={onFieldFilters} />
          </div>
        </div>
      )}
    </div>
  )
}

// ── Pagination bar ────────────────────────────────────────────────────────────

function PaginationBar({
  page, pages, total, pageSize, onPage, onPageSize,
}: {
  page: number; pages: number; total: number; pageSize: number
  onPage: (p: number) => void; onPageSize: (s: number) => void
}) {
  const from = (page - 1) * pageSize + 1
  const to   = Math.min(page * pageSize, total)

  return (
    <div className="flex items-center gap-3 px-3 py-2 border-t border-white/5 bg-bg-secondary/30 shrink-0">
      <select
        value={pageSize}
        onChange={e => onPageSize(Number(e.target.value))}
        className="bg-white/5 border border-white/8 rounded px-2 py-1 text-[10px] text-accent-muted outline-none"
      >
        {[50, 100, 200, 500].map(s => (
          <option key={s} value={s}>{s} / page</option>
        ))}
      </select>

      <span className="text-[10px] text-accent-muted/40">
        {from.toLocaleString()}–{to.toLocaleString()} of {total.toLocaleString()}
      </span>

      <div className="flex items-center gap-0.5 ml-auto">
        <button onClick={() => onPage(1)}         disabled={page === 1}     className="p-1 rounded text-accent-muted/40 hover:text-white disabled:opacity-20 transition-colors"><ChevronsLeft  size={13} /></button>
        <button onClick={() => onPage(page - 1)}  disabled={page === 1}     className="p-1 rounded text-accent-muted/40 hover:text-white disabled:opacity-20 transition-colors"><ChevronLeft   size={13} /></button>

        {Array.from({ length: Math.min(7, pages) }, (_, i) => {
          let p: number
          if (pages <= 7)             p = i + 1
          else if (page <= 4)         p = i + 1
          else if (page >= pages - 3) p = pages - 6 + i
          else                        p = page - 3 + i
          return (
            <button key={p} onClick={() => onPage(p)}
              className={`w-6 h-6 rounded text-[10px] transition-colors ${
                p === page ? 'bg-accent-green/15 text-accent-green' : 'text-accent-muted/50 hover:text-white'
              }`}
            >{p}</button>
          )
        })}

        <button onClick={() => onPage(page + 1)}  disabled={page === pages} className="p-1 rounded text-accent-muted/40 hover:text-white disabled:opacity-20 transition-colors"><ChevronRight  size={13} /></button>
        <button onClick={() => onPage(pages)}     disabled={page === pages} className="p-1 rounded text-accent-muted/40 hover:text-white disabled:opacity-20 transition-colors"><ChevronsRight size={13} /></button>
      </div>
    </div>
  )
}

// ── Column config ─────────────────────────────────────────────────────────────

interface ColDef {
  key:         string
  label:       string
  cls:         string        // td/th width class
  filterKey?:  string        // backend column key (undefined = no filter)
}

const COLUMNS: ColDef[] = [
  { key: 'time_created', label: 'Time',     cls: 'w-44 shrink-0',       filterKey: undefined     },
  { key: 'event_id',     label: 'Event ID', cls: 'w-20 shrink-0',       filterKey: 'event_id'    },
  { key: 'level_name',   label: 'Level',    cls: 'w-26 shrink-0',       filterKey: 'level_name'  },
  { key: 'channel',      label: 'Channel',  cls: 'w-52 shrink-0',       filterKey: 'channel'     },
  { key: 'provider',     label: 'Provider', cls: 'flex-1 min-w-0',      filterKey: 'provider'    },
  { key: 'computer',     label: 'Computer', cls: 'w-36 shrink-0',       filterKey: 'computer'    },
  { key: 'preview',      label: 'Data',     cls: 'w-56 shrink-0',       filterKey: 'data'        },
]

function fmtTime(ts: string | null): string { return fmtDateTime(ts) }

function dataPreview(ev: EvtxEvent): string {
  if (!ev.event_data) return ''
  return Object.entries(ev.event_data).slice(0, 3).map(([k, v]) => `${k}=${v}`).join('  ')
}

// Default filter state for a column
const defaultColFilter = (): ColFilter => ({ mode: 'contains', value: '' })

// ── Main Explorer ─────────────────────────────────────────────────────────────

interface Props {
  caseId:     string
  fileId:     string
  filename?:  string                                  // name of the current EVTX file
  pinnedIds?: Set<number>
  onPin?:     (ev: EvtxEvent, filename: string) => void
}

export default function TimelineExplorer({ caseId, fileId, filename = '', pinnedIds, onPin }: Props) {
  const [filters, setFilters]           = useState<EventFilters>({ page: 1, page_size: 100, sort_dir: 'asc' })
  const [colFilters, setColFilters]     = useState<ColFilters>({})
  const [fieldFilters, setFieldFilters] = useState<FieldFilter[]>([])
  const [expandedId, setExpandedId]     = useState<number | null>(null)

  // Debounce col filter application
  const colDebounce   = useRef<ReturnType<typeof setTimeout> | null>(null)
  const fieldDebounce = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingCols   = useRef<ColFilters>({})

  const updateFilters = useCallback((patch: Partial<EventFilters>) => {
    setFilters(prev => ({ ...prev, ...patch }))
    setExpandedId(null)
  }, [])

  const handleColFilterChange = useCallback((colKey: string, cf: ColFilter) => {
    const next = { ...pendingCols.current, [colKey]: cf }
    Object.keys(next).forEach(k => { if (!next[k].value.trim()) delete next[k] })
    pendingCols.current = next
    setColFilters(next)

    if (colDebounce.current) clearTimeout(colDebounce.current)
    colDebounce.current = setTimeout(() => {
      const active = Object.fromEntries(
        Object.entries(pendingCols.current).filter(([, f]) => f.value.trim())
      )
      setFilters(prev => ({
        ...prev,
        page: 1,
        col_filters: Object.keys(active).length ? JSON.stringify(active) : undefined,
      }))
      setExpandedId(null)
    }, 350)
  }, [])

  const clearColFilters = useCallback(() => {
    pendingCols.current = {}
    setColFilters({})
    setFilters(prev => ({ ...prev, col_filters: undefined, page: 1 }))
  }, [])

  // Field filters: debounced, only fire when key+value are both non-empty
  const handleFieldFilters = useCallback((updated: FieldFilter[]) => {
    setFieldFilters(updated)
    if (fieldDebounce.current) clearTimeout(fieldDebounce.current)
    fieldDebounce.current = setTimeout(() => {
      const active = updated.filter(f => f.key.trim() && f.value.trim())
      setFilters(prev => ({
        ...prev,
        page: 1,
        field_filters: active.length
          ? JSON.stringify(active.map(f => ({ key: f.key.trim(), mode: f.mode, value: f.value.trim() })))
          : undefined,
      }))
      setExpandedId(null)
    }, 400)
  }, [])

  // Reset everything when file changes
  useEffect(() => {
    setFilters({ page: 1, page_size: 100, sort_dir: 'asc' })
    setColFilters({})
    setFieldFilters([])
    pendingCols.current = {}
    setExpandedId(null)
  }, [fileId])

  const { data: summary } = useQuery({
    queryKey: ['evtx-summary', caseId, fileId],
    queryFn:  () => evtxApi.summary(caseId, fileId),
    staleTime: 60_000,
  })

  const { data: eventsPage, isLoading, isFetching } = useQuery({
    queryKey: ['evtx-events', caseId, fileId, filters],
    queryFn:  () => evtxApi.events(caseId, fileId, filters),
    placeholderData: prev => prev,
  })

  const events = eventsPage?.items ?? []
  const total  = eventsPage?.total ?? 0
  const pages  = eventsPage?.pages ?? 1

  const activeColCount   = Object.values(colFilters).filter(f => f.value.trim()).length
  const activeFieldCount = fieldFilters.filter(f => f.key.trim() && f.value.trim()).length
  const grandTotal       = summary ? Object.values(summary.levels).reduce((a, b) => a + b, 0) : 0

  return (
    <div className="flex flex-col h-full">
      {/* Global filter bar */}
      <FilterBar
        summary={summary}
        filters={filters}
        onFilterChange={updateFilters}
        total={grandTotal}
        filteredTotal={total}
        activeColCount={activeColCount + activeFieldCount}
        onClearCols={clearColFilters}
        fieldFilters={fieldFilters}
        onFieldFilters={handleFieldFilters}
      />

      {/* Table area */}
      <div className="flex-1 overflow-auto relative">
        {/* Fetching indicator */}
        {isFetching && (
          <div className="absolute top-2 right-4 z-10">
            <div className="h-1 w-32 rounded bg-white/5 overflow-hidden">
              <div className="h-full bg-accent-green/50 animate-pulse" style={{ width: '60%' }} />
            </div>
          </div>
        )}

        <table className="w-full border-collapse text-[11px] min-w-[960px]">
          <thead className="sticky top-0 z-10 bg-bg-secondary">
            {/* Column name row */}
            <tr className="border-b border-white/8">
              {/* Pin column header */}
              {onPin && <th className="w-8 shrink-0 px-1 pt-2 pb-1" />}
              {COLUMNS.map(col => (
                <th key={col.key}
                  className={`${col.cls} px-3 pt-2 pb-1 text-left font-medium text-[9px] text-accent-muted/40 uppercase tracking-widest whitespace-nowrap`}
                >
                  {col.label}
                </th>
              ))}
            </tr>

            {/* Per-column filter row */}
            <tr className="border-b border-white/5 bg-bg-secondary/80">
              {/* Pin column filter cell (empty) */}
              {onPin && <th className="w-8 shrink-0 px-1 py-1.5" />}
              {COLUMNS.map(col => (
                <th key={`${col.key}-filter`} className={`${col.cls} px-2 py-1.5`}>
                  {col.filterKey ? (
                    <ColFilterInput
                      colKey={col.filterKey}
                      filter={colFilters[col.filterKey] ?? defaultColFilter()}
                      onChange={cf => handleColFilterChange(col.filterKey!, cf)}
                    />
                  ) : (
                    /* Time column: no per-column filter (use date range in global bar) */
                    <div className="h-6 flex items-center px-1">
                      <span className="text-[9px] text-white/10 italic">date range ↑</span>
                    </div>
                  )}
                </th>
              ))}
            </tr>
          </thead>

          <tbody>
            {isLoading && Array.from({ length: 8 }).map((_, i) => (
              <tr key={i} className="border-b border-white/[0.04]">
                {COLUMNS.map(col => (
                  <td key={col.key} className={`${col.cls} px-3 py-2`}>
                    <div className="h-3 rounded bg-white/5 animate-pulse" style={{ width: `${45 + (i * 7) % 45}%` }} />
                  </td>
                ))}
              </tr>
            ))}

            {!isLoading && events.length === 0 && (
              <tr>
                <td colSpan={COLUMNS.length + (onPin ? 1 : 0)} className="px-3 py-12 text-center text-[11px] text-accent-muted/30 italic">
                  No events match the current filters
                </td>
              </tr>
            )}

            {events.map(ev => {
              const isPinned = pinnedIds?.has(ev.id) ?? false
              return (
                <>
                  <tr
                    key={ev.id}
                    onClick={() => setExpandedId(id => id === ev.id ? null : ev.id)}
                    className={`
                      border-b border-white/[0.04] cursor-pointer transition-colors group
                      ${expandedId === ev.id
                        ? 'bg-accent-green/5'
                        : 'hover:bg-white/[0.025]'}
                    `}
                  >
                    {/* Pin button cell */}
                    {onPin && (
                      <td
                        className="w-8 shrink-0 px-1 py-1.5 text-center"
                        onClick={e => { e.stopPropagation(); if (!isPinned) onPin(ev, filename) }}
                      >
                        {isPinned ? (
                          <BookmarkCheck
                            size={13}
                            className="mx-auto text-accent-green/60"
                            title="Already selected"
                          />
                        ) : (
                          <BookmarkPlus
                            size={13}
                            className="mx-auto text-accent-muted/20 group-hover:text-accent-muted/50 hover:!text-accent-green transition-colors"
                            title="Add to selection"
                          />
                        )}
                      </td>
                    )}
                    <td className="w-44 shrink-0 px-3 py-1.5 font-mono text-[10px] text-white/45 whitespace-nowrap">
                      {fmtTime(ev.time_created)}
                    </td>
                    <td className="w-20 shrink-0 px-3 py-1.5 font-mono text-white/80 font-semibold">
                      {ev.event_id ?? '—'}
                    </td>
                    <td className="w-26 shrink-0 px-3 py-1.5">
                      <LevelBadge name={ev.level_name} />
                    </td>
                    <td className="w-52 shrink-0 px-3 py-1.5 text-white/55 truncate" title={ev.channel ?? ''}>
                      {ev.channel ?? '—'}
                    </td>
                    <td className="flex-1 min-w-0 px-3 py-1.5 text-white/40 truncate" title={ev.provider ?? ''}>
                      {ev.provider ?? '—'}
                    </td>
                    <td className="w-36 shrink-0 px-3 py-1.5 text-white/50 truncate" title={ev.computer ?? ''}>
                      {ev.computer ?? '—'}
                    </td>
                    <td className="w-56 shrink-0 px-3 py-1.5 text-white/25 font-mono text-[10px] truncate" title={dataPreview(ev)}>
                      {dataPreview(ev)}
                    </td>
                  </tr>

                  {expandedId === ev.id && (
                    <tr key={`${ev.id}-detail`}>
                      <td colSpan={COLUMNS.length + (onPin ? 1 : 0)} className="p-0">
                        <EventDetail event={ev} onClose={() => setExpandedId(null)} />
                      </td>
                    </tr>
                  )}
                </>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {eventsPage && (
        <PaginationBar
          page={filters.page ?? 1}
          pages={pages}
          total={total}
          pageSize={filters.page_size ?? 100}
          onPage={p => updateFilters({ page: p })}
          onPageSize={s => updateFilters({ page_size: s, page: 1 })}
        />
      )}
    </div>
  )
}
