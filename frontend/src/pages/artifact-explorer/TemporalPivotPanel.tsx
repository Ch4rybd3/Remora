/**
 * Cross-artifact temporal correlation panel.
 *
 * Given a pivot timestamp and a window, shows every row from every artifact
 * in the case whose date column falls within that window. Results are grouped
 * by source artifact and sorted by timestamp, giving a single unified view of
 * what happened across all data sources around a moment in time.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, ChevronDown, ChevronRight, Clock, Layers, Loader2, X } from '../../ui/icons'
import { csvArtifactsApi, type TemporalPivotFile } from '../../api/csvArtifacts'
import { EZBadge } from './EZBadge'

const WINDOWS = [
  { label: '±15 s',  sec: 15 },
  { label: '±1 min', sec: 60 },
  { label: '±5 min', sec: 300 },
  { label: '±15 min', sec: 900 },
]

interface Props {
  caseId: string
  timestamp: string
  onClose: () => void
  /** Navigate to this artifact in the Explorer. */
  onOpenFile: (id: string) => void
}

function FileSection({
  file, dateCol, onOpenFile,
}: {
  file: TemporalPivotFile
  dateCol: string | null
  onOpenFile: (id: string) => void
}) {
  const [expanded, setExpanded] = useState(true)

  const visibleCols = file.columns.filter(c =>
    !['Source', 'Browser', 'Profile'].includes(c) || file.columns.length <= 5
  ).slice(0, 8)

  return (
    <div className="border-b border-hairline last:border-b-0">
      <button
        onClick={() => setExpanded(v => !v)}
        className="w-full flex items-center gap-2 px-4 py-2.5 hover:bg-accent/5 transition-colors text-left"
      >
        {expanded ? <ChevronDown size={12} className="text-fg-secondary/50 shrink-0" /> : <ChevronRight size={12} className="text-fg-secondary/50 shrink-0" />}
        <span className="text-ui text-fg font-medium flex-1 truncate">{file.original_name}</span>
        {file.ez_label && <EZBadge label={file.ez_label} />}
        <span className="text-label text-fg-secondary/40 font-mono shrink-0">{file.hit_count} row{file.hit_count !== 1 ? 's' : ''}</span>
        <button
          onClick={e => { e.stopPropagation(); onOpenFile(file.id) }}
          className="text-label text-accent/60 hover:text-accent transition-colors px-1 shrink-0"
          title="Open in Explorer"
        >
          Explorer →
        </button>
      </button>

      {expanded && (
        <div className="overflow-x-auto border-t border-hairline/50">
          <table className="w-full text-left border-collapse text-label">
            <thead>
              <tr className="bg-panel/50">
                {visibleCols.map(col => (
                  <th key={col} className={`px-3 py-1.5 font-semibold uppercase tracking-wider text-fg-secondary/50 whitespace-nowrap ${
                    col === dateCol ? 'font-mono' : ''
                  }`}>
                    {col === dateCol && <Clock size={8} className="inline mr-1 opacity-50" />}
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {file.rows.map((row, i) => (
                <tr key={i} className="border-t border-hairline/30 hover:bg-accent/3">
                  {visibleCols.map(col => (
                    <td
                      key={col}
                      title={row[col] ?? ''}
                      className={`px-3 py-1 max-w-xs truncate ${
                        col === dateCol
                          ? 'font-mono text-label text-fg/50 whitespace-nowrap'
                          : 'text-fg/70'
                      }`}
                    >
                      {row[col] ?? ''}
                    </td>
                  ))}
                </tr>
              ))}
              {file.hit_count > file.rows.length && (
                <tr className="border-t border-hairline/30">
                  <td colSpan={visibleCols.length} className="px-3 py-1.5 text-label text-fg-secondary/40 italic text-center">
                    +{file.hit_count - file.rows.length} more — open in Explorer to see all
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

const MIN_WIDTH = 380
const MAX_WIDTH = 1200
const DEFAULT_WIDTH = 640

function usePanelWidth() {
  const stored = typeof localStorage !== 'undefined'
    ? parseInt(localStorage.getItem('temporal-pivot-width') ?? '', 10)
    : NaN
  const [width, setWidth] = useState(Number.isFinite(stored) ? stored : DEFAULT_WIDTH)

  const save = useCallback((w: number) => {
    setWidth(w)
    try { localStorage.setItem('temporal-pivot-width', String(w)) } catch {}
  }, [])

  return [width, save] as const
}

export function TemporalPivotPanel({ caseId, timestamp, onClose, onOpenFile }: Props) {
  const [windowSec, setWindowSec] = useState(300)
  const [width, setWidth] = usePanelWidth()
  const dragging = useRef(false)
  const startX   = useRef(0)
  const startW   = useRef(0)

  const onDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    dragging.current = true
    startX.current   = e.clientX
    startW.current   = width
  }, [width])

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragging.current) return
      // dragging left edge: moving left increases width
      const delta = startX.current - e.clientX
      setWidth(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, startW.current + delta)))
    }
    const onUp = () => { dragging.current = false }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [setWidth])

  const { data, isLoading, isError } = useQuery({
    queryKey: ['temporal-pivot', caseId, timestamp, windowSec],
    queryFn:  () => csvArtifactsApi.temporalPivot(caseId, timestamp, windowSec),
    staleTime: 30_000,
  })

  const totalHits = data?.files.reduce((n, f) => n + f.hit_count, 0) ?? 0

  return (
    <div className="fixed inset-0 z-[100] flex items-end justify-end pointer-events-none">
      <div
        className="pointer-events-auto flex flex-col bg-panel border-l border-hairline shadow-2xl relative"
        style={{ width, height: '100%' }}
      >
        {/* Drag handle — left edge */}
        <div
          onMouseDown={onDragStart}
          className="absolute left-0 top-0 h-full w-1 cursor-col-resize hover:bg-accent/30 transition-colors z-10"
          title="Drag to resize"
        />
        {/* Header */}
        <div className="shrink-0 flex items-center gap-2 px-4 py-3 border-b border-hairline">
          <Layers size={13} className="text-accent shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-ui font-semibold text-fg">Cross-artifact correlation</p>
            <p className="text-label text-fg-secondary/50 font-mono truncate">{timestamp}</p>
          </div>
          <button onClick={onClose} className="text-fg-secondary/40 hover:text-fg-secondary transition-colors p-1">
            <X size={13} />
          </button>
        </div>

        {/* Window selector */}
        <div className="shrink-0 flex items-center gap-1.5 px-4 py-2 border-b border-hairline">
          <span className="text-label text-fg-secondary/50 mr-1">Window:</span>
          {WINDOWS.map(w => (
            <button
              key={w.sec}
              onClick={() => setWindowSec(w.sec)}
              className={`text-label px-2.5 py-1 rounded-pill border transition-colors ${
                windowSec === w.sec
                  ? 'border-accent/50 bg-accent/10 text-accent'
                  : 'border-hairline text-fg-secondary/60 hover:border-strong hover:text-fg'
              }`}
            >
              {w.label}
            </button>
          ))}
          {data && (
            <span className="ml-auto text-label text-fg-secondary/40 font-mono">
              {totalHits} hit{totalHits !== 1 ? 's' : ''} across {data.files.length} file{data.files.length !== 1 ? 's' : ''}
            </span>
          )}
        </div>

        {/* Results */}
        <div className="flex-1 overflow-y-auto">
          {isLoading && (
            <div className="flex items-center justify-center h-40 gap-2 text-fg-secondary/40 text-ui">
              <Loader2 size={14} className="animate-spin" />
              Searching all artifacts…
            </div>
          )}

          {isError && (
            <div className="flex items-center justify-center h-40 gap-2 text-severity-medium text-ui">
              <AlertTriangle size={14} />
              Search failed
            </div>
          )}

          {!isLoading && !isError && data && data.files.length === 0 && (
            <div className="flex flex-col items-center justify-center h-64 gap-2 text-fg-secondary/40">
              <Clock size={28} className="opacity-30" />
              <p className="text-ui">No events found in this window</p>
              <p className="text-label">Try a wider window or a different timestamp</p>
            </div>
          )}

          {!isLoading && !isError && data?.files.map(file => (
            <FileSection
              key={file.id}
              file={file}
              dateCol={file.date_column}
              onOpenFile={onOpenFile}
            />
          ))}

          {data && data.skipped.length > 0 && (
            <div className="px-4 py-2 text-label text-fg-secondary/30 border-t border-hairline">
              {data.skipped.length} file{data.skipped.length > 1 ? 's' : ''} could not be searched
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
