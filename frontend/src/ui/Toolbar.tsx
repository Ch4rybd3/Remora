import type { ReactNode } from 'react'

/**
 * A row of controls with hierarchy.
 *
 * Five bordered buttons side by side read as five equal choices, which is how
 * a toolbar ends up with no visible primary action. Related controls go in a
 * ToolbarGroup, separated by a hairline; everything that is not the primary
 * action uses `.btn-ghost` so the one that matters is the only filled control.
 */
export function Toolbar({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`flex items-center gap-1 px-3 py-1.5 border-b border-hairline ${className}`}>
      {children}
    </div>
  )
}

export function ToolbarGroup({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-center gap-0.5 pr-2 mr-1 border-r border-hairline last:border-r-0 last:pr-0 last:mr-0">
      {children}
    </div>
  )
}

/** Pushes everything after it to the right edge. */
export function ToolbarSpacer() {
  return <div className="flex-1 min-w-0" />
}

export function ToolbarLabel({ children }: { children: ReactNode }) {
  return (
    <span className="text-label font-mono uppercase tracking-label text-fg-muted px-1 select-none">
      {children}
    </span>
  )
}
