import { Fragment } from 'react'
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
  onRowClick?: (row: T) => void
  isRowSelected?: (row: T) => boolean
  /**
   * Detail rendered in a full-width row beneath its parent. Returning null
   * leaves the row closed. Used for audit entry payloads and raw event records
   * — the detail belongs with the row it explains, not in a modal that hides it.
   */
  renderExpanded?: (row: T) => ReactNode | null
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
  onRowClick,
  isRowSelected,
  renderExpanded,
  sort,
  onSortChange,
  empty,
  loading = false,
  density = 'default',
  stickyHeader = true,
  className = '',
}: DataTableProps<T>) {
  const pad = density === 'compact' ? 'px-2 py-1.5' : 'px-4 py-2.5'

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

  const colCount = columns.length + (leading ? 1 : 0) + (trailing ? 1 : 0)

  return (
    <div className={`min-w-0 overflow-x-auto ${className}`}>
      <table className="w-full border-collapse">
        <thead className={stickyHeader ? 'sticky top-0 z-10 bg-panel' : 'bg-panel'}>
          <tr className="border-b border-hairline">
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
            rows.map((row) => {
              const selected = isRowSelected?.(row) ?? false
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
