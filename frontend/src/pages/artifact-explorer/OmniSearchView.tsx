/**
 * Full-text search across every artifact of a case, grouped by file.
 *
 * A hit is only useful next to the file it came from, so results stay grouped
 * and each group opens the file at that query rather than dumping rows from
 * everywhere into one undifferentiated list.
 */
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'

import { csvArtifactsApi, type OmniSearchFile, type OmniSearchSkipped } from '../../api/csvArtifacts'
import { AlertTriangle, FileText, Loader2, XCircle } from '../../ui/icons'
import { EZBadge } from './EZBadge'

export function OmniSearchView({ caseId, query, regex, onOpenFile }: {
  caseId: string; query: string; regex: boolean; onOpenFile: (id: string) => void
}) {
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['csv-omni', caseId, query, regex],
    queryFn:  () => csvArtifactsApi.search(caseId, query, 15, regex),
    enabled:  query.length >= 2,
    staleTime: 10_000,
  })

  if (query.length < 2) {
    return (
      <div className="flex items-center justify-center h-full text-fg-secondary/30 text-ui">
        Type at least 2 characters to search across all CSV files
      </div>
    )
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full gap-2 text-fg-secondary/40 text-ui">
        <Loader2 size={16} className="animate-spin" /> Searching all files…
      </div>
    )
  }

  // The search failing and the search finding nothing are different answers.
  // Collapsing them is what made a 500 read as "no results" - the query was
  // never run, and the analyst had no way to tell.
  if (isError || !data) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-2 px-6 text-center">
        <XCircle size={18} className="text-severity-critical/70" />
        <p className="text-ui text-fg/70">The search could not run.</p>
        <p className="text-label text-fg-secondary/50 max-w-md">
          {error instanceof Error ? error.message : 'The server did not answer.'} Retry,
          or narrow the query to a single file from the list.
        </p>
      </div>
    )
  }

  // Everything failed: reporting that as "no results" would be a lie about a
  // query that never reached a single file.
  if (data.total_hits === 0 && data.searched === 0 && data.skipped.length > 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-2 px-6 text-center">
        <AlertTriangle size={18} className="text-severity-medium/70" />
        <p className="text-ui text-fg/70">
          None of the {data.skipped.length} artifact{data.skipped.length !== 1 ? 's' : ''} in this case could be searched.
        </p>
        <p className="text-label text-fg-secondary/50 max-w-md">
          {data.skipped[0].reason}. {regex && 'Check the pattern, or turn regex off. '}
          Files removed with their collection keep their entry until it is deleted.
        </p>
      </div>
    )
  }

  if (data.total_hits === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-2 px-6 text-center">
        <p className="text-fg-secondary/30 text-ui">
          No results for "<span className="font-mono text-fg/40">{query}</span>"
          {' '}in {data.searched} file{data.searched !== 1 ? 's' : ''}
        </p>
        {data.skipped.length > 0 && <SkippedNotice skipped={data.skipped} />}
      </div>
    )
  }

  return (
    <div className="p-4 space-y-4 overflow-y-auto h-full">
      <p className="text-label text-fg-secondary/50">
        <span className="text-fg/70 font-semibold">{data.total_hits.toLocaleString()}</span> match{data.total_hits !== 1 ? 'es' : ''} in {data.files.length} file{data.files.length !== 1 ? 's' : ''} for "<span className="font-mono text-accent">{data.query}</span>"
        {' '}<span className="text-fg-secondary/30">· {data.searched} file{data.searched !== 1 ? 's' : ''} searched</span>
      </p>
      {data.skipped.length > 0 && <SkippedNotice skipped={data.skipped} />}
      {data.files.map((file: OmniSearchFile) => (
        <OmniFileGroup key={file.id} file={file} query={query} onOpen={() => onOpenFile(file.id)} />
      ))}
    </div>
  )
}

/**
 * What the search could not read.
 *
 * Shown next to the results rather than instead of them: partial results are
 * still useful, but an analyst concluding "this indicator is not in the case"
 * needs to know the search did not cover every file.
 */
function SkippedNotice({ skipped }: { skipped: OmniSearchSkipped[] }) {
  const [open, setOpen] = useState(false)

  return (
    <div className="border border-severity-medium/25 bg-severity-medium/5 px-3 py-2">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-2 text-label text-severity-medium/90 hover:text-severity-medium w-full text-left"
      >
        <AlertTriangle size={11} className="shrink-0" />
        <span>
          {skipped.length} file{skipped.length !== 1 ? 's were' : ' was'} not searched
        </span>
        <span className="ml-auto text-severity-medium/50">{open ? 'Hide' : 'Show'}</span>
      </button>
      {open && (
        <ul className="mt-2 space-y-1 border-t border-severity-medium/20 pt-2">
          {skipped.map(s => (
            <li key={s.id} className="text-label text-fg-secondary/60 flex gap-2">
              <span className="font-mono text-fg/50 truncate" title={s.original_name}>{s.original_name}</span>
              <span className="text-fg-secondary/40 shrink-0">— {s.reason}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export function OmniFileGroup({ file, query, onOpen }: {
  file: OmniSearchFile; query: string; onOpen: () => void
}) {
  const [expanded, setExpanded] = useState(false)
  const displayRows = expanded ? file.rows : file.rows.slice(0, 8)
  const ql = query.toLowerCase()

  function highlight(text: string) {
    const idx = text.toLowerCase().indexOf(ql)
    if (idx === -1) return <span>{text}</span>
    return (
      <span>
        {text.slice(0, idx)}
        <mark className="bg-accent/20 text-accent rounded-control px-0.5">{text.slice(idx, idx + ql.length)}</mark>
        {text.slice(idx + ql.length)}
      </span>
    )
  }

  return (
    <div className=" border border-hairline bg-panel overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2.5 bg-white/[0.02] border-b border-hairline">
        <div className="flex items-center gap-2">
          <FileText size={13} className="text-fg-secondary/40" />
          <span className="text-ui font-medium text-fg/80">{file.original_name}</span>
          {file.ez_label && <EZBadge label={file.ez_label} />}
        </div>
        <div className="flex items-center gap-3">
          <span className="text-label text-accent/70 bg-accent/8 border border-accent/20 px-2 py-0.5 rounded-control">
            {file.hit_count.toLocaleString()} hit{file.hit_count !== 1 ? 's' : ''}
          </span>
          <button onClick={onOpen}
            className="text-label text-fg-secondary hover:text-accent border border-hairline hover:border-accent/30 px-2 py-0.5 rounded-control transition-colors">
            Open the file →
          </button>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="text-label" style={{ minWidth: Math.max(600, file.columns.length * 140) + 'px' }}>
          <thead>
            <tr className="border-b border-hairline">
              {file.columns.map(col => (
                <th key={col} className="px-3 py-1.5 text-left font-medium text-fg-secondary/30 uppercase tracking-widest whitespace-nowrap">{col}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {displayRows.map((row, i) => (
              <tr key={i} className={`border-b border-strong/[0.03] ${i % 2 === 0 ? '' : 'bg-white/[0.015]'}`}>
                {file.columns.map(col => (
                  <td key={col} className="px-3 py-1.5 text-fg/60 font-mono truncate" style={{ maxWidth: 240 }}>
                    {highlight(row[col] ?? '')}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {file.rows.length > 8 && (
        <button
          onClick={() => setExpanded(e => !e)}
          className="w-full py-1.5 text-label text-fg-secondary/40 hover:text-accent/60 hover:bg-white/[0.01] transition-colors border-t border-hairline"
        >
          {expanded
            ? 'Collapse'
            : `▼ Show ${file.rows.length - 8} more row${file.rows.length - 8 > 1 ? 's' : ''} (${file.rows.length} total)`
          }
        </button>
      )}
    </div>
  )
}
