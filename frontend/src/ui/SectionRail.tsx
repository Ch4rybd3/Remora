import type { ReactNode } from 'react'

export interface RailItem {
  id: string
  label: string
  /** Word count, status, anything short. Rendered in mono under the label. */
  meta?: ReactNode
  /** Dims the row without disabling it — an empty section is still clickable. */
  empty?: boolean
}

interface SectionRailProps {
  items: RailItem[]
  /** null means "show everything". */
  selectedId: string | null
  onSelect: (id: string | null) => void
  /** Rendered below the list, separated by a rule — versions, history, counts. */
  footer?: ReactNode
  className?: string
}

/**
 * A numbered list of sections that doubles as a filter.
 *
 * Selecting a section shows only that section, which is what makes a long
 * report writable: one thing on screen, full width, nothing else competing.
 * Selecting it again clears the filter and brings the whole document back,
 * matching how the file sidebars elsewhere in the product behave.
 *
 * Sections carry a mono numeral, never a colour. A hue invented per section
 * means nothing and fights the one accent.
 */
export function SectionRail({
  items,
  selectedId,
  onSelect,
  footer,
  className = '',
}: SectionRailProps) {
  return (
    <nav className={`w-52 shrink-0 border-r border-hairline bg-panel flex flex-col min-h-0 ${className}`}>
      <div className="flex items-center gap-2 px-3.5 py-2.5">
        <span className="text-label font-mono uppercase tracking-label text-fg-muted">Sections</span>
        <span className="flex-1 border-t border-hairline" />
        {selectedId !== null && (
          <button
            onClick={() => onSelect(null)}
            className="text-label font-mono text-accent hover:underline"
            title="Show every section"
          >
            all
          </button>
        )}
      </div>

      <ul className="flex-1 min-h-0 overflow-y-auto">
        {items.map((item, index) => {
          const selected = item.id === selectedId
          return (
            <li key={item.id}>
              <button
                onClick={() => onSelect(selected ? null : item.id)}
                aria-current={selected ? 'true' : undefined}
                className={`w-full text-left px-3.5 py-2.5 border-l-2 transition-colors ${
                  selected
                    ? 'border-l-accent bg-hover'
                    : 'border-l-transparent hover:bg-hover'
                }`}
              >
                <span className="flex items-baseline gap-2">
                  <span className="numeral shrink-0">{String(index + 1).padStart(2, '0')}</span>
                  <span
                    className={`text-ui truncate ${
                      selected ? 'text-accent' : item.empty ? 'text-fg-muted' : 'text-fg'
                    }`}
                  >
                    {item.label}
                  </span>
                </span>
                {item.meta && (
                  <span className="block pl-7 text-label font-mono text-fg-muted">{item.meta}</span>
                )}
              </button>
            </li>
          )
        })}
      </ul>

      {footer && <div className="border-t border-hairline">{footer}</div>}
    </nav>
  )
}
