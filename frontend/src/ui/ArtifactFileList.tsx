/**
 * The left-hand file list every artifact page has, written once.
 *
 * Six pages grew their own: the Artifact Explorer, Registry, PCAP, Email,
 * Binary and Disk Images. They agreed on the idea and on nothing else - a
 * different selected-row treatment per page, a search box on some, a count on
 * others, and a hover title that said "Click to copy" where the one thing an
 * analyst needs on hover is the name itself. Artifact names are long, alike,
 * and truncated at the same point: `Microsoft-Windows-Sysmon%4Operational.evtx`
 * and `Microsoft-Windows-SmbClient%4Security.evtx` are the same row until you
 * can read them.
 *
 * What is shared is the shape of the row - an icon, the name, chips, a muted
 * footnote, controls on hover - and the behaviours around it: the
 * selected row, the search, the count, the empty state. What varies per page
 * is the *content* of the chips and the controls, which is why those are nodes
 * the caller supplies rather than options this file enumerates.
 *
 * See `docs/UI_PATTERNS.md`, "Artifact File List".
 */
import { useMemo, useState, type ReactNode } from 'react'

import { copyText } from '../utils/clipboard'
import { AlertTriangle, Check, Copy, FileText, Loader2, Search, X } from './icons'

export interface ArtifactFileItem {
  id:   string
  name: string
  /** Chips under the name: artifact kind, row count, size, status. */
  badges?: ReactNode
  /** One muted line beneath: a relative time, a source path. */
  footnote?: ReactNode
  /** Row controls - preserve, delete, reparse. Shown on hover. */
  actions?: ReactNode
  /**
   * The bytes behind the row are gone.
   *
   * Kept and marked rather than hidden: the record is real and the analyst
   * needs to see that the file it points at is not, which is a different
   * thing from the artifact never having existed.
   */
  unavailable?: boolean
  /** Extra text the search should match - a hostname, a source path. */
  searchText?: string
}

export function ArtifactFileList({
  items,
  selectedId,
  onSelect,
  title = 'Files',
  icon: Icon = FileText,
  searchable = true,
  searchPlaceholder = 'Filter files…',
  loading = false,
  emptyMessage = 'No file here yet',
  emptyAction,
  header,
  footer,
}: {
  items:      ArtifactFileItem[]
  selectedId: string | null
  onSelect:   (id: string) => void
  title?:     string
  icon?:      React.ElementType
  searchable?: boolean
  searchPlaceholder?: string
  loading?:   boolean
  emptyMessage?: string
  /** Offered under the empty state - "import one", "how do I add these". */
  emptyAction?: ReactNode
  /** Between the title bar and the list: a picker, a hint panel. */
  header?:    ReactNode
  footer?:    ReactNode
}) {
  const [query, setQuery] = useState('')

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return items
    return items.filter(item =>
      item.name.toLowerCase().includes(q) ||
      (item.searchText ?? '').toLowerCase().includes(q))
  }, [items, query])

  return (
    <div className="flex flex-col min-h-0 h-full">
      <div className="px-3 py-2 flex items-center gap-1.5 border-b border-hairline shrink-0">
        <p className="text-label font-mono uppercase tracking-label text-fg-muted flex items-center gap-1.5">
          <Icon size={11} /> {title}
        </p>
        {items.length > 0 && (
          <span className="text-fg-secondary/30 text-label">
            {query.trim() && shown.length !== items.length
              ? `${shown.length}/${items.length}`
              : items.length}
          </span>
        )}
      </div>

      {searchable && items.length > 0 && (
        <div className="px-2 py-1.5 border-b border-hairline shrink-0 relative">
          <Search size={10} className="absolute left-4 top-1/2 -translate-y-1/2 text-fg-secondary/30" />
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder={searchPlaceholder}
            className="w-full bg-fg/5 border border-hairline rounded-control pl-6 pr-6 py-1 text-label text-fg placeholder:text-fg-secondary/30 outline-none focus:border-strong transition-colors"
          />
          {query && (
            <button onClick={() => setQuery('')}
              title="Clear the filter"
              className="absolute right-3.5 top-1/2 -translate-y-1/2 text-fg-secondary/30 hover:text-fg">
              <X size={10} />
            </button>
          )}
        </div>
      )}

      {header}

      <div className="flex-1 overflow-y-auto min-h-0">
        {loading && (
          <div className="flex items-center gap-2 px-3 py-3 text-label text-fg-secondary/40">
            <Loader2 size={10} className="animate-spin" /> Loading…
          </div>
        )}

        {!loading && items.length === 0 && (
          <div className="px-3 py-6 text-center">
            <p className="text-label text-fg-secondary/30 leading-relaxed">{emptyMessage}</p>
            {emptyAction && <div className="mt-2">{emptyAction}</div>}
          </div>
        )}

        {!loading && items.length > 0 && shown.length === 0 && (
          <p className="px-3 py-6 text-center text-label text-fg-secondary/30">
            No file matches "<span className="font-mono text-fg/40">{query}</span>"
          </p>
        )}

        {shown.map(item => (
          <ArtifactFileRow
            key={item.id}
            item={item}
            selected={item.id === selectedId}
            onSelect={() => onSelect(item.id)}
          />
        ))}
      </div>

      {footer}
    </div>
  )
}

function ArtifactFileRow({ item, selected, onSelect }: {
  item: ArtifactFileItem; selected: boolean; onSelect: () => void
}) {
  return (
    <div
      onClick={onSelect}
      /*
       * The whole row carries the name, not just the text node inside it.
       * Hovering anywhere on a row reveals which of two near-identical
       * artifacts it is, which is the point - the truncation is what makes
       * them indistinguishable in the first place.
       */
      title={item.name}
      className={`group relative px-3 py-2.5 cursor-pointer border-l-2 transition-colors ${ selected
          ? 'bg-accent/5 border-l-accent/40'
          : 'border-l-transparent hover:bg-white/[0.03]'
      }`}
    >
      <div className={`flex items-start gap-2 ${item.actions ? 'pr-14' : ''}`}>
        {item.unavailable
          ? <AlertTriangle size={12} className="mt-0.5 shrink-0 text-severity-medium/60" />
          : <FileText size={12} className="mt-0.5 shrink-0 text-fg-secondary/30" />}

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1 min-w-0">
            <span className="flex-1 truncate text-label leading-snug font-mono text-fg/80">
              {item.name}
            </span>
            <CopyNameButton name={item.name} />
          </div>
          {item.badges && (
            <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">{item.badges}</div>
          )}
          {item.footnote && (
            <p className="text-label text-fg-secondary/25 mt-0.5 truncate">{item.footnote}</p>
          )}
        </div>
      </div>

      {item.actions && (
        <div className="absolute right-2 top-2" onClick={e => e.stopPropagation()}>
          {item.actions}
        </div>
      )}
    </div>
  )
}

/**
 * Copy the name, from an affordance that is not the name.
 *
 * The Artifact Explorer used to put the whole name in a button that copied on
 * click - the name being what gets pasted into a command line most often. It
 * is a trap: everywhere else in the product, and everywhere else in every
 * product, clicking a file name opens the file. Moving the copy onto its own
 * icon keeps the shortcut and gives the row back its obvious meaning.
 */
function CopyNameButton({ name }: { name: string }) {
  const [copied, setCopied] = useState(false)

  return (
    <button
      onClick={async e => {
        e.stopPropagation()
        if (await copyText(name)) {
          setCopied(true)
          window.setTimeout(() => setCopied(false), 1400)
        }
      }}
      title={copied ? 'Copied' : 'Copy the name'}
      aria-label={`Copy ${name}`}
      className={`shrink-0 transition-all ${ copied
          ? 'text-accent opacity-100'
          : 'text-fg-secondary/40 hover:text-accent opacity-0 group-hover:opacity-100'
      }`}
    >
      {copied ? <Check size={10} /> : <Copy size={10} />}
    </button>
  )
}
