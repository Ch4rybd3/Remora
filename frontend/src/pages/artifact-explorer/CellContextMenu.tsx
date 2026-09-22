/**
 * Right-click a cell to narrow the table around it.
 *
 * The filters were always there - a row of boxes above the table, one per
 * column, each with a mode you cycle by clicking a symbol. Reaching them means
 * leaving the row you are reading, finding the right column among forty, and
 * retyping a value that is already on screen. Analysts do that hundreds of
 * times in a session, and every retype is a chance to mistype.
 *
 * So the menu writes the value that was clicked into the filter for the column
 * it was clicked in. Nothing here is a new kind of query: `=`, `!=`, `contains`
 * and `!contains` are the four modes the filter row already offers, and the
 * time pivot is an RQL range. What changes is how far the analyst's hand has
 * to travel.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react'

import { Clock, Copy, Filter } from '../../ui/icons'
import type { FilterMode } from './types'

/** Where the menu was opened, and on what. */
export interface CellTarget {
  x:      number
  y:      number
  column: string
  value:  string
  /** True when this is the artifact's event-time column. */
  isDate: boolean
}

/** The pivots offered on a timestamp, in the order an analyst reaches for them. */
const PIVOTS: { label: string; seconds: number; hint: string }[] = [
  { label: '±15 seconds', seconds: 15,
    hint: 'What happened at the same moment - the child process, the file write' },
  { label: '±1 minute',   seconds: 60,
    hint: 'The action around it' },
  { label: '±15 minutes', seconds: 15 * 60,
    hint: 'The session it belongs to' },
]

const MODES: { mode: FilterMode; label: string; symbol: string }[] = [
  { mode: '=',         label: 'Equals',           symbol: '=' },
  { mode: '!=',        label: 'Does not equal',   symbol: '≠' },
  { mode: 'contains',  label: 'Contains',         symbol: '~' },
  { mode: '!contains', label: 'Does not contain', symbol: '!~' },
]

/**
 * A timestamp, widened by `seconds` either side.
 *
 * Returns null when the cell does not parse as one. The menu then offers no
 * pivot rather than a range around an invented instant - a date column in a
 * real collection is only *mostly* dates.
 */
export function pivotRange(value: string, seconds: number): [string, string] | null {
  // Treated as UTC when the value carries no zone, which is what the store
  // guarantees: an artifact declaring a source timezone is converted on read.
  const normalised = value.trim().replace(' ', 'T')
  const parsed = Date.parse(/[Zz]|[+-]\d{2}:?\d{2}$/.test(normalised)
    ? normalised
    : `${normalised}Z`)
  if (Number.isNaN(parsed)) return null

  const format = (ms: number) => new Date(ms).toISOString().slice(0, 19).replace('T', ' ')
  return [format(parsed - seconds * 1000), format(parsed + seconds * 1000)]
}

/** The RQL a pivot compiles to. Quoted because a timestamp holds a space. */
export function pivotRql(column: string, range: [string, string]): string {
  return `${column} BETWEEN "${range[0]}" AND "${range[1]}"`
}

export function CellContextMenu({ target, onFilter, onPivot, onClose }: {
  target:   CellTarget
  onFilter: (column: string, mode: FilterMode, value: string) => void
  onPivot:  (rql: string) => void
  onClose:  () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState({ left: target.x, top: target.y })

  // Measured after mount rather than guessed: a right-click near the bottom of
  // a long table would otherwise open a menu below the fold, which reads as
  // the menu not opening at all.
  useLayoutEffect(() => {
    const box = ref.current?.getBoundingClientRect()
    if (!box) return
    setPosition({
      left: Math.min(target.x, window.innerWidth  - box.width  - 8),
      top:  Math.min(target.y, window.innerHeight - box.height - 8),
    })
  }, [target.x, target.y])

  useEffect(() => {
    const dismiss = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    // `capture`, so a click that also lands on a row does not select it on the
    // way past.
    document.addEventListener('mousedown', dismiss, true)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', dismiss, true)
      document.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  const empty   = !target.value.trim()
  const pivots  = target.isDate
    ? PIVOTS.map(p => ({ ...p, range: pivotRange(target.value, p.seconds) }))
          .filter(p => p.range !== null)
    : []

  return (
    <div
      ref={ref}
      role="menu"
      style={{ left: position.left, top: position.top }}
      className="fixed z-50 min-w-[232px] border border-strong bg-overlay shadow-overlay py-1"
    >
      <div className="px-3 py-1.5 border-b border-hairline">
        <p className="text-label uppercase tracking-widest text-fg-secondary/40">{target.column}</p>
        <p className="text-label font-mono text-fg/70 truncate" title={target.value}>
          {target.value || <span className="italic text-fg-secondary/40">empty</span>}
        </p>
      </div>

      {empty ? (
        <p className="px-3 py-2 text-label text-fg-secondary/40">
          Nothing to filter on in this cell.
        </p>
      ) : (
        <>
          <div className="px-3 pt-2 pb-1 flex items-center gap-1.5 text-label uppercase tracking-widest text-fg-secondary/30">
            <Filter size={9} /> Filter this column
          </div>
          {MODES.map(({ mode, label, symbol }) => (
            <button
              key={mode}
              role="menuitem"
              onClick={() => { onFilter(target.column, mode, target.value); onClose() }}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-ui text-fg/75 hover:bg-accent/10 hover:text-accent transition-colors"
            >
              <span className="w-4 shrink-0 font-mono text-center text-fg-secondary/50">{symbol}</span>
              {label}
            </button>
          ))}

          {pivots.length > 0 && (
            <>
              <div className="mt-1 pt-2 border-t border-hairline px-3 pb-1 flex items-center gap-1.5 text-label uppercase tracking-widest text-fg-secondary/30">
                <Clock size={9} /> Around this moment
              </div>
              {pivots.map(p => (
                <button
                  key={p.label}
                  role="menuitem"
                  title={p.hint}
                  onClick={() => { onPivot(pivotRql(target.column, p.range!)); onClose() }}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-ui text-fg/75 hover:bg-accent/10 hover:text-accent transition-colors"
                >
                  <span className="w-4 shrink-0" />
                  {p.label}
                </button>
              ))}
            </>
          )}

          <div className="mt-1 pt-1 border-t border-hairline">
            <button
              role="menuitem"
              onClick={() => { navigator.clipboard.writeText(target.value); onClose() }}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-ui text-fg-secondary/70 hover:bg-fg/5 hover:text-fg transition-colors"
            >
              <Copy size={11} className="shrink-0" /> Copy value
            </button>
          </div>
        </>
      )}
    </div>
  )
}
