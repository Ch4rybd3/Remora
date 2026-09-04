import { useMemo, useState } from 'react'

import { BookmarkCheck, BookmarkPlus, Copy, Search, X } from '../../ui/icons'
import type { PinnedRow } from './types'

export interface SelectedRow {
  row: Record<string, string>
  columns: string[]
  /** Everything the row needs to become a timeline event, if pinned from here. */
  pinKey: string
}

interface RowDetailPanelProps {
  selected: SelectedRow | null
  isPinned: boolean
  onPin: () => void
  onClose: () => void
  /** The date column, highlighted because it is what orders the timeline. */
  dateColumn?: string | null
}

function copy(text: string) {
  navigator.clipboard?.writeText(text).catch(() => {})
}

/**
 * The full detail of one artifact row.
 *
 * This used to expand inside the table, which meant a row with sixty fields
 * pushed everything below it off screen and the analyst lost their place in the
 * result set. Here the table stays put and the detail has real room — long
 * command lines, registry paths and base64 blobs wrap instead of being
 * truncated at a column width.
 *
 * Fields are searchable because the point of opening a row is usually to find
 * one value in it, and forty of them are noise at that moment.
 */
export function RowDetailPanel({
  selected, isPinned, onPin, onClose, dateColumn,
}: RowDetailPanelProps) {
  const [search, setSearch] = useState('')

  const fields = useMemo(() => {
    if (!selected) return []
    const q = search.toLowerCase()
    return selected.columns
      .filter((c) => !q || c.toLowerCase().includes(q) || (selected.row[c] ?? '').toLowerCase().includes(q))
      .map((c) => [c, selected.row[c] ?? ''] as const)
  }, [selected, search])

  if (!selected) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-2 px-6 text-center">
        <Search size={22} className="text-fg-muted" />
        <p className="text-ui text-fg-muted">Select a row to see every field</p>
        <p className="text-label text-fg-muted">
          The table shows the columns that fit; this shows all of them.
        </p>
      </div>
    )
  }

  const populated = selected.columns.filter((c) => (selected.row[c] ?? '').trim()).length

  return (
    <div className="h-full flex flex-col min-h-0">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-hairline shrink-0">
        <div className="relative flex-1 min-w-0">
          <Search size={10} className="absolute left-2 top-1/2 -translate-y-1/2 text-fg-muted" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter fields..."
            className="input pl-6 py-1"
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              aria-label="Clear the field filter"
              className="absolute right-1.5 top-1/2 -translate-y-1/2 text-fg-muted hover:text-fg"
            >
              <X size={9} />
            </button>
          )}
        </div>
        <button
          onClick={onPin}
          title={isPinned ? 'Already in the selection' : 'Pin to the timeline selection'}
          aria-label={isPinned ? 'Already in the selection' : 'Pin to the timeline selection'}
          className={`shrink-0 transition-colors ${isPinned ? 'text-accent' : 'text-fg-muted hover:text-accent'}`}
        >
          {isPinned ? <BookmarkCheck size={13} /> : <BookmarkPlus size={13} />}
        </button>
        <button
          onClick={onClose}
          aria-label="Close the detail"
          className="shrink-0 text-fg-muted hover:text-fg transition-colors"
        >
          <X size={13} />
        </button>
      </div>

      <p className="px-3 py-1.5 text-label font-mono text-fg-muted border-b border-hairline shrink-0">
        {populated} of {selected.columns.length} fields populated
      </p>

      <div className="flex-1 min-h-0 overflow-y-auto">
        {fields.length === 0 ? (
          <p className="px-3 py-6 text-center text-ui text-fg-muted italic">
            No field matches &ldquo;{search}&rdquo;
          </p>
        ) : (
          fields.map(([field, value]) => (
            <div key={field} className="group px-3 py-2 border-b border-hairline last:border-b-0">
              <div className="flex items-center gap-1.5">
                <span
                  className={`text-label font-mono uppercase tracking-label truncate ${
                    field === dateColumn ? 'text-accent' : 'text-fg-muted'
                  }`}
                  title={field}
                >
                  {field}
                </span>
                {value && (
                  <button
                    onClick={() => copy(value)}
                    title={`Copy ${field}`}
                    aria-label={`Copy ${field}`}
                    className="opacity-0 group-hover:opacity-100 focus:opacity-100 text-fg-muted
                               hover:text-fg transition-opacity shrink-0"
                  >
                    <Copy size={9} />
                  </button>
                )}
              </div>
              {/* Forensic values are full of unbreakable tokens — hashes,
                  registry paths, command lines. They wrap here rather than
                  being cut at a column width, which is the whole reason for
                  opening a row. */}
              <p className="mt-0.5 text-ui font-mono text-fg break-all whitespace-pre-wrap">
                {value || <span className="text-fg-muted italic">empty</span>}
              </p>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

/** A pinned row and the selected row share the key scheme, so they can agree. */
export type { PinnedRow }
