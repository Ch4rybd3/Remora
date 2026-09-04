import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'

import { PageHelp } from '../help/pageHelp'
import { ArrowLeft, NAV_ICON } from './icons'

interface PageShellProps {
  /**
   * The route this page serves. It drives two things that must never disagree:
   * the icon, from NAV_ICON, and the help, from PAGE_HELP. One prop, so a page
   * cannot show one destination's icon beside another's help.
   */
  route: string
  /**
   * Usually a string. It accepts a node because an entity page renames its
   * subject in place — the case title becomes an input while editing — and
   * losing that would be a worse outcome than widening the type.
   */
  title: ReactNode
  /**
   * Where "back" goes, for a detail page. A client, a playbook or a case is a
   * page *about* something inside a destination, so it carries its parent's
   * icon and help and offers the way back to the list it came from.
   */
  backTo?: string
  /** The case, the file, the client — whatever this page is currently about. */
  subtitle?: ReactNode
  /** Counts, status, a version. Sits after the title in mono. */
  meta?: ReactNode
  /** Primary action, and anything that belongs beside it. */
  actions?: ReactNode
  /** Search, filter chips, view controls. Rendered as its own row under the header. */
  toolbar?: ReactNode
  /** File list, section rail — anything that filters the content. */
  asideLeft?: ReactNode
  /** Selection panel, reference. Usually a SidePanel. */
  asideRight?: ReactNode
  /**
   * Content that manages its own scrolling and fills the space — a matrix, a
   * graph, a virtualised table. Skips the padded, scrolling wrapper.
   */
  fullHeight?: boolean
  children: ReactNode
}

/**
 * The shape of every page.
 *
 * Before this existed, twenty-five pages each invented their own header: some
 * an <h1>, some a toolbar strip, some a mono label. None of the differences
 * meant anything, and the cost was not only visual — the `?` had to be threaded
 * into eight different shapes by hand, and a page that wanted a selection panel
 * had to rebuild the three-column layout from scratch.
 *
 * The slots are fixed. A page that needs a different arrangement is a gap in
 * the design system to raise, not a local exception to make.
 */
export function PageShell({
  route,
  title,
  backTo,
  subtitle,
  meta,
  actions,
  toolbar,
  asideLeft,
  asideRight,
  fullHeight = false,
  children,
}: PageShellProps) {
  const Icon = NAV_ICON[route]

  return (
    <div className="h-full flex flex-col min-h-0 overflow-hidden">
      <header className="shrink-0 flex items-center gap-2.5 px-4 py-2.5 border-b border-hairline">
        {backTo && (
          <Link
            to={backTo}
            aria-label="Back"
            className="shrink-0 text-fg-muted hover:text-fg transition-colors"
          >
            <ArrowLeft size={15} />
          </Link>
        )}
        {Icon && <Icon size={15} className="shrink-0 text-accent" />}
        <h1 className="text-title font-semibold text-fg min-w-0 truncate">{title}</h1>
        {meta && <span className="text-label font-mono text-fg-muted shrink-0">{meta}</span>}
        {subtitle && (
          <span className="text-ui text-fg-muted truncate min-w-0" title={typeof subtitle === 'string' ? subtitle : undefined}>
            {subtitle}
          </span>
        )}
        <div className="flex-1 min-w-0" />
        {actions && <div className="flex items-center gap-1 shrink-0">{actions}</div>}
        <PageHelp route={route} />
      </header>

      {toolbar && (
        <div className="shrink-0 flex items-center gap-2 px-4 py-1.5 border-b border-hairline">
          {toolbar}
        </div>
      )}

      <div className="flex-1 min-h-0 flex overflow-hidden">
        {asideLeft}
        {fullHeight ? (
          <div className="flex-1 min-w-0 min-h-0 overflow-hidden">{children}</div>
        ) : (
          <div className="flex-1 min-w-0 min-h-0 overflow-y-auto p-4">{children}</div>
        )}
        {asideRight}
      </div>
    </div>
  )
}
