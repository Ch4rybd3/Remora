import { useCallback, useEffect, useState } from 'react'
import type { ReactNode } from 'react'

import { ChevronLeft, ChevronRight } from './icons'

export interface SidePanelTab {
  id: string
  label: string
  /** Small trailing count or status, rendered in mono. */
  meta?: string
  content: ReactNode
}

interface SidePanelProps {
  tabs: SidePanelTab[]
  /** Distinguishes the stored collapse state and width between panels. */
  storageKey: string
  defaultCollapsed?: boolean
  defaultWidth?: number
  minWidth?: number
  maxWidth?: number
  className?: string
}

const DEFAULT_WIDTH = 288
const MIN_WIDTH = 220
const MAX_WIDTH = 720
/** How far one arrow key press moves the edge. */
const KEY_STEP = 24

/**
 * A right-hand panel that collapses to a rail.
 *
 * Expanded it is a real pane: tabs across the top, blocks separated by
 * hairlines, no boxes. Collapsed it becomes a narrow rail of vertical labels —
 * the reference stays reachable in one click while the document gets the full
 * width. That is also what makes the layout work from a 14-inch laptop, where
 * the rail is the sensible default, up to an ultrawide where the pane costs
 * nothing.
 *
 * The collapse state is per-viewer and per-panel, and its loss is harmless, so
 * it lives in localStorage.
 */
export function SidePanel({
  tabs,
  storageKey,
  defaultCollapsed = false,
  defaultWidth = DEFAULT_WIDTH,
  minWidth = MIN_WIDTH,
  maxWidth = MAX_WIDTH,
  className = '',
}: SidePanelProps) {
  const key = `remora_sidepanel_${storageKey}`
  const widthKey = `${key}_width`

  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try {
      const stored = localStorage.getItem(key)
      if (stored === 'open') return false
      if (stored === 'rail') return true
    } catch {
      // Private windows throw on access; the default is a fine answer.
    }
    return defaultCollapsed
  })

  const clamp = useCallback(
    (value: number) => Math.min(maxWidth, Math.max(minWidth, value)),
    [minWidth, maxWidth],
  )

  const [width, setWidth] = useState<number>(() => {
    try {
      const stored = Number(localStorage.getItem(widthKey))
      if (Number.isFinite(stored) && stored > 0) return Math.min(maxWidth, Math.max(minWidth, stored))
    } catch {
      // Unreadable storage is not a reason to render a broken panel.
    }
    return defaultWidth
  })

  const persistWidth = useCallback(
    (next: number) => {
      try {
        localStorage.setItem(widthKey, String(next))
      } catch {
        // The width is lost on reload; nothing else breaks.
      }
    },
    [widthKey],
  )

  // Dragging the left edge. Listeners live on the document so the pointer can
  // leave the 5px handle — which it always does — without dropping the drag.
  const startResize = useCallback(
    (event: React.PointerEvent) => {
      event.preventDefault()
      const startX = event.clientX
      const startWidth = width

      const onMove = (e: PointerEvent) => setWidth(clamp(startWidth + (startX - e.clientX)))
      const onUp = (e: PointerEvent) => {
        document.removeEventListener('pointermove', onMove)
        document.removeEventListener('pointerup', onUp)
        document.body.style.removeProperty('cursor')
        document.body.style.removeProperty('user-select')
        persistWidth(clamp(startWidth + (startX - e.clientX)))
      }

      document.addEventListener('pointermove', onMove)
      document.addEventListener('pointerup', onUp)
      // Without these the drag selects the text it passes over.
      document.body.style.cursor = 'col-resize'
      document.body.style.userSelect = 'none'
    },
    [width, clamp, persistWidth],
  )

  const nudge = useCallback(
    (delta: number) => {
      setWidth((current) => {
        const next = clamp(current + delta)
        persistWidth(next)
        return next
      })
    },
    [clamp, persistWidth],
  )

  const [activeId, setActiveId] = useState(tabs[0]?.id ?? '')

  useEffect(() => {
    if (!tabs.some((t) => t.id === activeId) && tabs[0]) setActiveId(tabs[0].id)
  }, [tabs, activeId])

  const toggle = useCallback(
    (next: boolean) => {
      setCollapsed(next)
      try {
        localStorage.setItem(key, next ? 'rail' : 'open')
      } catch {
        // Preference is lost on reload; nothing else breaks.
      }
    },
    [key],
  )

  if (collapsed) {
    return (
      <aside
        className={`w-9 shrink-0 border-l border-hairline bg-panel flex flex-col items-center py-2 gap-1 ${className}`}
      >
        <button
          onClick={() => toggle(false)}
          className="p-1 rounded-control text-fg-muted hover:text-fg hover:bg-hover transition-colors"
          title="Expand the panel"
          aria-label="Expand the panel"
        >
          <ChevronLeft size={13} />
        </button>
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => {
              setActiveId(tab.id)
              toggle(false)
            }}
            className="py-3 text-label font-mono uppercase tracking-label text-fg-muted
                       hover:text-fg transition-colors"
            style={{ writingMode: 'vertical-rl' }}
            title={tab.label}
          >
            {tab.label}
          </button>
        ))}
      </aside>
    )
  }

  const active = tabs.find((t) => t.id === activeId) ?? tabs[0]

  return (
    <aside
      className={`relative shrink-0 border-l border-hairline bg-panel flex flex-col min-h-0 ${className}`}
      style={{ width }}
    >
      {/* The resize handle is a real separator: focusable, and operable with
          the arrow keys. A drag-only affordance is unreachable without a
          pointer, and this one governs how much of the screen the document
          gets — not a detail worth locking behind a mouse. */}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize the panel"
        aria-valuenow={width}
        aria-valuemin={minWidth}
        aria-valuemax={maxWidth}
        tabIndex={0}
        onPointerDown={startResize}
        onDoubleClick={() => { setWidth(defaultWidth); persistWidth(defaultWidth) }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowLeft')  { e.preventDefault(); nudge(KEY_STEP) }
          if (e.key === 'ArrowRight') { e.preventDefault(); nudge(-KEY_STEP) }
          if (e.key === 'Home')       { e.preventDefault(); setWidth(defaultWidth); persistWidth(defaultWidth) }
        }}
        title="Drag to resize, double-click to reset"
        className="absolute left-0 top-0 bottom-0 -ml-0.5 w-1 z-20 cursor-col-resize
                   hover:bg-accent/40 focus-visible:bg-accent/60 focus-visible:outline-none
                   transition-colors"
      />
      <div className="flex items-center border-b border-hairline">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveId(tab.id)}
            className={`px-3 py-2 text-ui transition-colors ${
              tab.id === active?.id ? 'tab-active' : 'tab-inactive'
            }`}
          >
            {tab.label}
            {tab.meta && <span className="ml-1.5 text-label font-mono text-fg-muted">{tab.meta}</span>}
          </button>
        ))}
        <div className="flex-1" />
        <button
          onClick={() => toggle(true)}
          className="px-2 py-2 text-fg-muted hover:text-fg transition-colors"
          title="Collapse to a rail"
          aria-label="Collapse to a rail"
        >
          <ChevronRight size={13} />
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto">{active?.content}</div>
    </aside>
  )
}

/**
 * A block inside a side panel: a mono label, a hairline, then the content.
 * No box — the rule is the container.
 */
export function SidePanelBlock({
  label,
  meta,
  children,
}: {
  label: string
  meta?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="px-3.5 py-3 border-b border-hairline last:border-b-0">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-label font-mono uppercase tracking-label text-fg-muted shrink-0">
          {label}
        </span>
        <span className="flex-1 border-t border-hairline" />
        {meta && <span className="text-label font-mono text-fg-muted shrink-0">{meta}</span>}
      </div>
      {children}
    </section>
  )
}
