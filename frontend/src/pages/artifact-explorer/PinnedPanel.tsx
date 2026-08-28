/**
 * The selection panel.
 *
 * docs/UI_PATTERNS.md: it is always visible, never behind a toggle, and its
 * contents are sorted chronologically — the order they will land in the
 * timeline, so what you see is what you are about to send.
 */
import { useMemo, useState } from 'react'

import {
  BookmarkCheck, BookmarkPlus, ChevronRight as ChevronRightIcon,
  Download, Loader2, X,
} from '../../ui/icons'
import type { PinnedRow } from './types'

export function PinnedPanel({ pinned, onUnpin, onClear, onExport, onEdit, onReset, exporting }: {
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
    <div className="w-72 shrink-0 border-l border-hairline bg-panel flex flex-col overflow-hidden">
      <div className="flex items-center justify-between px-3 py-3 border-b border-hairline shrink-0">
        <p className="text-label font-semibold uppercase tracking-widest text-fg-secondary/50 flex items-center gap-1.5">
          <BookmarkCheck size={10} />
          Selection
          {pinned.length > 0 && (
            <span className="ml-1 bg-accent/15 text-accent border border-accent/30 rounded-control px-1.5 py-0.5 text-label font-bold">
              {pinned.length}
            </span>
          )}
        </p>
        {pinned.length > 0 && (
          <button onClick={onClear} title="Clear all"
            className="text-fg-secondary/30 hover:text-severity-critical transition-colors">
            <X size={12} />
          </button>
        )}
      </div>

      {pinned.length === 0 && (
        <div className="flex-1 flex flex-col items-center justify-center gap-2 px-4 text-center">
          <BookmarkPlus size={22} className="text-fg-secondary/15" />
          <p className="text-label text-fg-secondary/30 leading-relaxed">
            Click <BookmarkPlus size={9} className="inline" /> on a row to pin it here
          </p>
        </div>
      )}

      {pinned.length > 0 && (
        <div className="flex-1 overflow-y-auto divide-y divide-hairline/[0.04]">
          {sorted.map(item => {
            const ts     = item.dateColumn ? item.row[item.dateColumn] : null
            const isOpen = expanded.has(item.key)

            return (
              <div key={item.key} className="group relative px-3 py-2.5 hover:bg-white/[0.02] transition-colors">
                <div className="flex items-start gap-2 pr-5">
                  <button
                    onClick={() => toggleExpanded(item.key)}
                    title={isOpen ? 'Replier' : 'Éditer titre et description'}
                    className="mt-0.5 shrink-0 text-fg-secondary/30 hover:text-accent transition-colors"
                  >
                    <ChevronRightIcon size={11} className={`transition-transform ${isOpen ? 'rotate-90' : ''}`} />
                  </button>
                  <div className="flex-1 min-w-0">
                    {item.ezLabel
                      ? <span className="text-label font-semibold px-1.5 py-0.5 rounded-control border bg-severity-low/10 text-severity-low border-severity-low/20">{item.ezLabel}</span>
                      : <span className="text-label text-fg-secondary/30 font-mono truncate block">{item.artifactName}</span>
                    }
                    {ts && (
                      <p className="text-label font-mono text-fg/50 mt-0.5 truncate">{ts}</p>
                    )}
                    <p className="text-label text-fg/70 mt-0.5 leading-snug line-clamp-2">
                      {item.title || <span className="text-fg-secondary/30 italic">Sans titre</span>}
                    </p>
                    {!isOpen && item.description && (
                      <p className="text-label text-fg-secondary/35 truncate leading-snug">
                        {item.description.split('\n')[0]}
                      </p>
                    )}
                  </div>
                </div>

                {isOpen && (
                  <div className="mt-2 pl-[19px] space-y-1.5">
                    <div>
                      <label className="text-label uppercase tracking-widest text-fg-secondary/40">Title</label>
                      <input
                        value={item.title}
                        onChange={e => onEdit(item.key, { title: e.target.value })}
                        placeholder="Event title..."
                        className="w-full mt-0.5 bg-black/30 border border-hairline rounded-control px-1.5 py-1 text-label text-fg/90 focus:border-accent/40 focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="text-label uppercase tracking-widest text-fg-secondary/40">Description</label>
                      <textarea
                        value={item.description}
                        onChange={e => onEdit(item.key, { description: e.target.value })}
                        rows={4}
                        placeholder="Description…"
                        className="w-full mt-0.5 bg-black/30 border border-hairline rounded-control px-1.5 py-1 text-label font-mono text-fg-secondary resize-y focus:border-accent/40 focus:outline-none"
                      />
                    </div>
                    <div className="flex items-center justify-between">
                      <button
                        onClick={() => onReset(item.key)}
                        className="text-label text-fg-secondary/40 hover:text-accent transition-colors"
                      >
                        Reset
                      </button>
                      <span className="text-label text-fg-secondary/25">
                        {item.columns.length} fields kept
                      </span>
                    </div>
                  </div>
                )}

                <button onClick={() => onUnpin(item.key)}
                  className="absolute right-2 top-2.5 opacity-0 group-hover:opacity-100 text-fg-secondary/30 hover:text-severity-critical transition-all">
                  <X size={10} />
                </button>
              </div>
            )
          })}
        </div>
      )}

      <div className="px-3 py-3 border-t border-hairline shrink-0">
        <button
          onClick={onExport}
          disabled={pinned.length === 0 || exporting}
          className="w-full flex items-center justify-center gap-1.5 text-label py-2 rounded-control border border-accent/30 text-accent bg-accent/5 hover:bg-accent/10 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        >
          {exporting
            ? <><Loader2 size={11} className="animate-spin" /> Envoi…</>
            : <><Download size={11} /> Exporter {pinned.length > 0 ? `${pinned.length} → ` : ''}Timeline</>
          }
        </button>
        {pinned.length > 0 && (
          <p className="text-label text-fg-secondary/25 mt-1.5 text-center">
            {pinned.length} event{pinned.length > 1 ? 's' : ''}, sorted chronologically
          </p>
        )}
      </div>
    </div>
  )
}
