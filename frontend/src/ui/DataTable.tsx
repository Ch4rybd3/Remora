import { Fragment, useEffect, useRef } from 'react'
import type { ReactNode } from 'react'

import { ArrowDown, ArrowUp } from './icons'

export type SortDirection = 'asc' | 'desc'
export interface SortState { key: string; dir: SortDirection }

export interface Column<T> {
  key: string
  header: ReactNode
  render: (row: T) => ReactNode
  /** A Tailwind width utility, e.g. `w-40`. Omit to let the column size itself. */
  width?: string
  align?: 'left' | 'right'
  /** Forensic data — hashes, paths, timestamps, IPs — is always monospace. */
  mono?: boolean
  sortable?: boolean
  /**
   * Drops the column below a breakpoint. The honest answer for a dense table on
   * a 14-inch screen: hiding a column an analyst can still reach beats shrinking
   * every column until none of them is readable.
   */
  hideBelow?: 'md' | 'lg' | 'xl'
}

/**
 * Multi-select over the rows currently rendered.
 *
 * `selected` holds row keys, not rows: the set has to survive a refetch that
 * replaces every object, and a key is the only thing that does.
 *
 * "Select all" means the rows the analyst can see, after their filters. Anything
 * wider would be a promise the screen is not making - a header checkbox cannot
 * claim three hundred cases nobody has looked at.
 */
export interface Selection {
  selected: ReadonlySet<string>
  onChange: (next: Set<string>) => void
  /** Accessible name for the header checkbox, e.g. 'Select all cases'. */
  label?: string
}

export interface DataTableProps<T> {
  columns: Column<T>[]
  rows: T[]
  rowKey: (row: T) => string
  /**
   * The first, leftmost column. This is where the pin control goes: every
   * forensic table in the product puts "add to timeline" in the same place, and
   * making it a named slot is what keeps that true.
   */
  leading?: { header?: ReactNode; width?: string; render: (row: T) => ReactNode }
  /** Right-aligned row actions, revealed on hover so the table stays quiet. */
  trailing?: { width?: string; render: (row: T) => ReactNode }
  /**
   * Checkbox column, left of everything, for acting on several rows at once.
   * Shift-click extends from the last row clicked, because selecting thirty
   * cases one at a time is the reason bulk actions get avoided.
   */
  selection?: Selection
  onRowClick?: (row: T) => void
  isRowSelected?: (row: T) => boolean
  /**
   * Detail rendered in a full-width row beneath its parent. Returning null
   * leaves the row closed. Used for audit entry payloads and raw event records
   * — the detail belongs with the row it explains, not in a modal that hides it.
   */
  renderExpanded?: (row: T) => ReactNode | null
  /**
   * A second header row holding one filter control per column. Returning null
   * for a column leaves its cell empty.
   *
   * Filters belong in the header because that is where the thing they filter is
   * named. In a bar above the table the analyst has to hold the mapping between
   * control and column in their head, which is the kind of small tax that makes
   * a dense screen tiring over a long session.
   */
  renderFilter?: (column: Column<T>) => ReactNode | null
  sort?: SortState | null
  onSortChange?: (sort: SortState) => void
  empty?: ReactNode
  loading?: boolean
  /** `compact` is for dense forensic tables; `default` for management screens. */
  density?: 'compact' | 'default'
  stickyHeader?: boolean
  className?: string
}

const HIDE = {
  md: 'hidden md:table-cell',
  lg: 'hidden lg:table-cell',
  xl: 'hidden xl:table-cell',
} as const

/**
 * A header checkbox with the third state HTML has but no attribute for.
 *
 * "Some rows selected" is a real state and `checked` cannot express it, so it is
 * set on the node. Without it, a half-selected table shows an empty box and the
 * analyst cannot tell "none" from "seven of forty".
 */
function TriStateCheckbox({
  checked, indeterminate, onChange, label,
}: {
  checked: boolean
  indeterminate: boolean
  onChange: () => void
  label: string
}) {
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate
  }, [indeterminate])

  return (
    <input
      ref={ref}
      type="checkbox"
      className="w-3.5 h-3.5 accent-accent align-middle"
      checked={checked}
      aria-label={label}
      onChange={onChange}
    />
  )
}

/**
 * One table for the whole product.
 *
 * Before this existed there were twelve header styles, nine row styles and four
 * spellings of the same sticky header, because every screen rebuilt the table it
 * needed. None of those differences meant anything.
 *
 * The rules it encodes:
 *   - Rows are separated by hairlines. No zebra striping: alternating fills
 *     invent a rhythm that competes with the data.
 *   - Headers are mono, uppercase, tracked — the label step of the type scale.
 *   - The pin control is the first column, always, and stops row clicks.
 *   - A selected row is marked by an accent edge, not by a fill that would
 *     collide with hover.
 *   - Loading renders skeleton rows the size of real ones, so the layout does
 *     not jump when the data lands.
 */
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  leading,
  trailing,
  selection,
  onRowClick,
  isRowSelected,
  renderExpanded,
  renderFilter,
  sort,
  onSortChange,
  empty,
  loading = false,
  density = 'default',
  stickyHeader = true,
  className = '',
}: DataTableProps<T>) {
  const pad = density === 'compact' ? 'px-2 py-1.5' : 'px-4 py-2.5'

  // Where the last checkbox click landed, so shift-click knows what to extend.
  const anchor = useRef<number | null>(null)
  const keys = rows.map(rowKey)
  const selectedHere = keys.filter((key) => selection?.selected.has(key))
  const allSelected  = keys.length > 0 && selectedHere.length === keys.length

  const toggleRow = (index: number, shift: boolean) => {
    if (!selection) return
    const next = new Set(selection.selected)
    const from = shift && anchor.current !== null ? anchor.current : index
    const turningOn = !next.has(keys[index])
    for (let i = Math.min(from, index); i <= Math.max(from, index); i++) {
      if (turningOn) next.add(keys[i])
      else next.delete(keys[i])
    }
    anchor.current = index
    selection.onChange(next)
  }

  const toggleAll = () => {
    if (!selection) return
    const next = new Set(selection.selected)
    // Rows outside this filter keep whatever state they had: clearing them
    // would silently drop a selection the analyst made before filtering.
    for (const key of keys) {
      if (allSelected) next.delete(key)
      else next.add(key)
    }
    anchor.current = null
    selection.onChange(next)
  }

  const headerCell = (
    key: string,
    header: ReactNode,
    opts: { width?: string; align?: 'left' | 'right'; sortable?: boolean; hideBelow?: keyof typeof HIDE } = {},
  ) => {
    const sorted = sort?.key === key
    const classes = [
      pad,
      opts.align === 'right' ? 'text-right' : 'text-left',
      'text-label font-mono uppercase tracking-label text-fg-muted font-medium whitespace-nowrap',
      opts.width ?? '',
      opts.hideBelow ? HIDE[opts.hideBelow] : '',
    ].join(' ')

    if (!opts.sortable || !onSortChange) {
      return <th key={key} className={classes} scope="col">{header}</th>
    }
    return (
      <th key={key} className={classes} scope="col" aria-sort={sorted ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
        <button
          onClick={() => onSortChange({ key, dir: sorted && sort.dir === 'asc' ? 'desc' : 'asc' })}
          className={`inline-flex items-center gap-1 hover:text-fg transition-colors ${sorted ? 'text-accent' : ''}`}
        >
          {header}
          {sorted && (sort.dir === 'asc' ? <ArrowUp size={9} /> : <ArrowDown size={9} />)}
        </button>
      </th>
    )
  }

  const colCount =
    columns.length + (leading ? 1 : 0) + (trailing ? 1 : 0) + (selection ? 1 : 0)

  return (
    <div className={`min-w-0 overflow-x-auto ${className}`}>
      <table className="w-full border-collapse">
        <thead className={stickyHeader ? 'sticky top-0 z-10 bg-panel' : 'bg-panel'}>
          <tr className="border-b border-hairline">
            {selection && headerCell('__selection', (
              <TriStateCheckbox
                checked={allSelected}
                indeterminate={selectedHere.length > 0 && !allSelected}
                onChange={toggleAll}
                label={selection.label ?? 'Select all rows'}
              />
            ), { width: 'w-9' })}
            {leading && headerCell('__leading', leading.header ?? '', { width: leading.width ?? 'w-8' })}
            {columns.map((c) =>
              headerCell(c.key, c.header, {
                width: c.width,
                align: c.align,
                sortable: c.sortable,
                hideBelow: c.hideBelow,
              }),
            )}
            {trailing && headerCell('__trailing', '', { width: trailing.width ?? 'w-20', align: 'right' })}
          </tr>

          {renderFilter && (
            <tr className="border-b border-hairline">
              {selection && <th className={pad} />}
              {leading && <th className={pad} />}
              {columns.map((c) => (
                <th
                  key={`${c.key}-filter`}
                  className={`${pad} ${c.hideBelow ? HIDE[c.hideBelow] : ''} font-normal`}
                >
                  {renderFilter(c)}
                </th>
              ))}
              {trailing && <th className={pad} />}
            </tr>
          )}
        </thead>

        <tbody>
          {loading &&
            Array.from({ length: 6 }).map((_, i) => (
              <tr key={`skeleton-${i}`} className="border-b border-hairline">
                {Array.from({ length: colCount }).map((__, j) => (
                  <td key={j} className={pad}>
                    <span className="block h-3 bg-fg/5 rounded-control" />
                  </td>
                ))}
              </tr>
            ))}

          {!loading &&
            rows.map((row, index) => {
              const selected = isRowSelected?.(row) ?? false
              const checked  = selection?.selected.has(keys[index]) ?? false
              const expanded = renderExpanded?.(row) ?? null
              return (
                <Fragment key={rowKey(row)}>
                <tr
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  aria-selected={isRowSelected ? selected : undefined}
                  className={`group border-b border-hairline last:border-b-0 transition-colors
                    ${onRowClick ? 'cursor-pointer' : ''}
                    ${selected
                      ? 'bg-accent/5 border-l-2 border-l-accent/40'
                      : 'border-l-2 border-l-transparent hover:bg-hover'}`}
                >
                  {selection && (
                    // The checkbox must not open the row it sits on.
                    <td className={pad} onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        className="w-3.5 h-3.5 accent-accent align-middle"
                        checked={checked}
                        aria-label={`Select ${keys[index]}`}
                        onChange={() => undefined}
                        onClick={(e) => toggleRow(index, e.shiftKey)}
                      />
                    </td>
                  )}
                  {leading && (
                    // The pin must not open the row it sits on.
                    <td className={pad} onClick={(e) => e.stopPropagation()}>
                      {leading.render(row)}
                    </td>
                  )}
                  {columns.map((c) => (
                    <td
                      key={c.key}
                      className={[
                        pad,
                        c.align === 'right' ? 'text-right' : '',
                        c.mono ? 'font-mono text-label' : 'text-ui',
                        c.hideBelow ? HIDE[c.hideBelow] : '',
                        'text-fg align-top',
                      ].join(' ')}
                    >
                      {c.render(row)}
                    </td>
                  ))}
                  {trailing && (
                    <td className={`${pad} text-right`} onClick={(e) => e.stopPropagation()}>
                      <span className="inline-flex items-center gap-2 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                        {trailing.render(row)}
                      </span>
                    </td>
                  )}
                </tr>
                {expanded && (
                  <tr className="border-b border-hairline bg-canvas">
                    <td colSpan={colCount} className="px-4 py-3">{expanded}</td>
                  </tr>
                )}
                </Fragment>
              )
            })}

          {!loading && rows.length === 0 && (
            <tr>
              <td colSpan={colCount} className="px-4 py-10 text-center text-ui text-fg-muted">
                {empty ?? 'Nothing to show.'}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}
