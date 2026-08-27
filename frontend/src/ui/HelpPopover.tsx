import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'

import { HelpCircle, X } from './icons'

interface HelpPopoverProps {
  title: string
  children: ReactNode
  /** Widens the panel for content with code samples. */
  wide?: boolean
}

/**
 * The `?` that every page carries.
 *
 * Analysts arrive at a page like the Artifact Explorer or Disk Images without
 * knowing the query syntax or where to drop a file, and the answer currently
 * lives in someone's head. This is where it goes instead — page-specific, next
 * to the thing it explains, and closed by default so it costs nothing.
 */
export function HelpPopover({ title, children, wide = false }: HelpPopoverProps) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="p-1 rounded-control text-fg-muted hover:text-fg hover:bg-hover transition-colors"
        title={title}
        aria-label={title}
        aria-expanded={open}
      >
        <HelpCircle size={14} />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div
            className={`absolute right-0 top-full mt-1 z-50 overlay-surface ${wide ? 'w-[32rem]' : 'w-80'}`}
            role="dialog"
            aria-label={title}
          >
            <div className="flex items-center gap-2 px-3.5 py-2 border-b border-hairline">
              <span className="text-label font-mono uppercase tracking-label text-fg-muted">
                {title}
              </span>
              <span className="flex-1" />
              <button
                onClick={() => setOpen(false)}
                className="text-fg-muted hover:text-fg transition-colors"
                aria-label="Close"
              >
                <X size={12} />
              </button>
            </div>
            <div className="px-3.5 py-3 max-h-[70vh] overflow-y-auto text-ui text-fg-secondary space-y-3">
              {children}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

/** A labelled example inside a help popover: what it does, then the snippet. */
export function HelpExample({ label, code }: { label: string; code: string }) {
  return (
    <div>
      <p className="text-label font-mono uppercase tracking-label text-fg-muted mb-1">{label}</p>
      <code className="block bg-canvas border border-hairline rounded-control px-2 py-1.5
                       font-mono text-label text-fg break-all whitespace-pre-wrap">
        {code}
      </code>
    </div>
  )
}
