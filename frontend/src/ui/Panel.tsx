import type { ReactNode } from 'react'

interface PanelProps {
  children: ReactNode
  className?: string
  /** Renders without the outer border, for a panel already inside a bordered grid. */
  bare?: boolean
}

/**
 * A surface. Square, defined by a hairline, no fill shift and no shadow.
 *
 * Stacking a border, a background change and a shadow is three signals for one
 * idea, and nesting those produces four frames around one paragraph. If a panel
 * seems to need to sit inside another panel, the layout is what needs changing.
 */
export function Panel({ children, className = '', bare = false }: PanelProps) {
  return (
    <div className={`bg-panel ${bare ? '' : 'border border-hairline'} ${className}`}>
      {children}
    </div>
  )
}

interface PanelHeaderProps {
  title: ReactNode
  /** A mono numeral. Sections are numbered, never colour-coded. */
  numeral?: string
  meta?: ReactNode
  actions?: ReactNode
}

export function PanelHeader({ title, numeral, meta, actions }: PanelHeaderProps) {
  return (
    <div className="flex items-baseline gap-2.5 px-4 py-2.5 border-b border-hairline">
      {numeral && <span className="numeral shrink-0">{numeral}</span>}
      <h2 className="text-title font-semibold text-fg truncate">{title}</h2>
      {meta && <span className="text-label font-mono text-fg-muted shrink-0">{meta}</span>}
      {actions && <div className="ml-auto shrink-0">{actions}</div>}
    </div>
  )
}
