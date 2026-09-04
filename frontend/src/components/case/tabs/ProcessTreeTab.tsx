/**
 * The process tree — what ran, and what launched it.
 *
 * Rendered as an indented, collapsible tree rather than on the shared graph
 * canvas the roadmap suggested. The canvas is right for the attack graph,
 * which is a hand-authored diagram of twenty nodes an analyst *arranges*; a
 * process tree is machine-generated, thousands of nodes deep, and read rather
 * than arranged. Laying it out as a graph would make it slower and harder to
 * follow at exactly the sizes that matter.
 *
 * Every row says how its link to its parent was established. That is the whole
 * point: a tree built from Security 4688 alone is a set of plausible guesses
 * matched on reused process ids, and presenting it identically to Sysmon's
 * asserted lineage would overstate what the logs support.
 */
import { useCallback, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'

import {
  AlertTriangle, ChevronRight, Loader2, Search, ShieldCheck, X,
} from '../../../ui/icons'
import {
  processTreeApi, type ProcessLink, type ProcessNode, type ProcessTree,
} from '../../../api/processTree'
import { CopyableName } from '../../custody/CustodyActions'

const LINK_STYLE: Record<ProcessLink, string> = {
  asserted: 'text-accent border-accent/30 bg-accent/8',
  inferred: 'text-severity-low border-severity-low/30 bg-severity-low/8',
  orphan:   'text-severity-medium border-severity-medium/30 bg-severity-medium/8',
}

const LINK_TITLE: Record<ProcessLink, string> = {
  asserted: 'Sysmon named the parent by GUID — the log asserts this link',
  inferred: 'Matched on a parent process id within a lifetime window — process ids are reused, so this is inference',
  orphan:   'No parent in the logs. Either the launcher was never logged, or the collection starts after it',
}

interface Row {
  node: ProcessNode
  depth: number
  children: Row[]
}

/** Nest the flat node list, keeping each level in start order. */
function nest(tree: ProcessTree): Row[] {
  const rows = new Map<string, Row>()
  for (const node of tree.nodes) rows.set(node.key, { node, depth: 0, children: [] })

  const roots: Row[] = []
  for (const row of rows.values()) {
    const parent = row.node.parent_key ? rows.get(row.node.parent_key) : undefined
    if (parent && parent !== row) parent.children.push(row)
    else roots.push(row)
  }

  // Depth is assigned by walking, not stored, so a cycle cannot make it
  // infinite: a node already seen is not descended into again.
  const seen = new Set<string>()
  const walk = (row: Row, depth: number) => {
    if (seen.has(row.node.key)) { row.children = []; return }
    seen.add(row.node.key)
    row.depth = depth
    for (const child of row.children) walk(child, depth + 1)
  }
  for (const root of roots) walk(root, 0)
  return roots
}

function flatten(rows: Row[], collapsed: Set<string>, out: Row[] = []): Row[] {
  for (const row of rows) {
    out.push(row)
    if (!collapsed.has(row.node.key)) flatten(row.children, collapsed, out)
  }
  return out
}

/** Keep a node and every ancestor of a node that matches. */
function filterTree(rows: Row[], needle: string): Row[] {
  const matches = (node: ProcessNode) =>
    node.name.toLowerCase().includes(needle) ||
    node.command_line.toLowerCase().includes(needle) ||
    node.user.toLowerCase().includes(needle) ||
    String(node.pid ?? '').includes(needle)

  const keep = (row: Row): Row | null => {
    const children = row.children.map(keep).filter((r): r is Row => r !== null)
    if (children.length === 0 && !matches(row.node)) return null
    return { ...row, children }
  }
  return rows.map(keep).filter((r): r is Row => r !== null)
}

function ProcessRow({ row, collapsed, onToggle, selected, onSelect }: {
  row: Row
  collapsed: Set<string>
  onToggle: (key: string) => void
  selected: string | null
  onSelect: (key: string) => void
}) {
  const { node } = row
  const open = !collapsed.has(node.key)
  const isSelected = selected === node.key

  return (
    <div
      onClick={() => onSelect(node.key)}
      className={`group flex items-center gap-2 py-1 pr-3 cursor-pointer border-l-2 transition-colors ${
        isSelected ? 'bg-accent/8 border-l-accent/50'
                   : 'border-l-transparent hover:bg-white/[0.03]'
      }`}
      style={{ paddingLeft: `${row.depth * 14 + 8}px` }}
    >
      <button
        className={`shrink-0 text-fg-secondary/40 hover:text-fg transition-transform ${
          open ? 'rotate-90' : ''
        } ${row.children.length === 0 ? 'invisible' : ''}`}
        onClick={(e) => { e.stopPropagation(); onToggle(node.key) }}
        aria-label={open ? `Collapse ${node.name}` : `Expand ${node.name}`}
      >
        <ChevronRight size={11} />
      </button>

      <span className="text-label font-mono text-fg/85 shrink-0">{node.name}</span>
      {node.pid !== null && (
        <span className="text-label font-mono text-fg-secondary/40 shrink-0 tabular-nums">
          {node.pid}
        </span>
      )}

      <span
        title={LINK_TITLE[node.link]}
        className={`text-label px-1 py-0.5 rounded-control border shrink-0 ${LINK_STYLE[node.link]}`}
      >
        {node.link}
      </span>

      {node.corroboration.length > 0 && (
        <span
          title={`Also seen in ${node.corroboration.join(', ')} — execution evidence, which says the executable ran and nothing about who started it`}
          className="flex items-center gap-0.5 text-label text-accent/70 shrink-0"
        >
          <ShieldCheck size={9} />
          {node.corroboration.join(', ')}
        </span>
      )}

      <span className="text-label font-mono text-fg-secondary/45 truncate min-w-0">
        {node.command_line}
      </span>
    </div>
  )
}

function Detail({ node, onClose }: { node: ProcessNode; onClose: () => void }) {
  const field = (label: string, value: string | number | null) =>
    value === null || value === '' ? null : (
      <div key={label} className="min-w-0">
        <p className="text-label uppercase tracking-wide text-fg-secondary/40">{label}</p>
        <p className="text-label font-mono text-fg/80 break-all">{value}</p>
      </div>
    )

  return (
    <div className="border-t border-hairline bg-black/20">
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-hairline">
        <span className="text-label font-mono text-fg/85 truncate">{node.image || node.name}</span>
        <button onClick={onClose} className="ml-auto text-fg-secondary/50 hover:text-fg shrink-0"
                aria-label="Close process">
          <X size={12} />
        </button>
      </div>

      <div className="px-3 py-2 grid grid-cols-2 md:grid-cols-4 gap-3 max-h-52 overflow-auto">
        {field('PID', node.pid)}
        {field('User', node.user)}
        {field('Integrity', node.integrity)}
        {field('Computer', node.computer)}
        {field('Started', node.started)}
        {field('Ended', node.ended)}
        {field('Parent', node.parent_name)}
        {field('Parent PID', node.parent_pid)}
        {field('Evidence', node.sources.join(', '))}
        {field('Corroborated by', node.corroboration.join(', '))}
        {field('Process GUID', node.guid)}
      </div>

      {node.command_line && (
        <div className="px-3 pb-2">
          <p className="text-label uppercase tracking-wide text-fg-secondary/40 mb-0.5">
            Command line
          </p>
          <CopyableName value={node.command_line}
            className="block text-label font-mono text-fg/80 break-all text-left" />
        </div>
      )}
    </div>
  )
}

export default function ProcessTreeTab({ caseId }: { caseId: string }) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [selected, setSelected] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [query, setQuery] = useState('')

  const { data, isLoading, isError } = useQuery({
    queryKey: ['process-tree', caseId],
    queryFn: () => processTreeApi.get(caseId),
  })

  const roots = useMemo(() => (data ? nest(data) : []), [data])
  const shown = useMemo(
    () => (query ? filterTree(roots, query.toLowerCase()) : roots),
    [roots, query],
  )
  const flat = useMemo(
    () => flatten(shown, query ? new Set<string>() : collapsed),
    [shown, collapsed, query],
  )
  const selectedNode = useMemo(
    () => data?.nodes.find((n) => n.key === selected) ?? null,
    [data, selected],
  )

  const toggle = useCallback((key: string) => {
    setCollapsed((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [])

  if (isLoading) {
    return (
      <p className="px-4 py-6 text-ui text-fg-secondary/50">
        <Loader2 size={13} className="inline animate-spin mr-2" />
        Building the tree…
      </p>
    )
  }

  if (isError || !data) {
    return <p className="px-4 py-6 text-ui text-severity-critical">
      The process tree could not be built.
    </p>
  }

  if (data.stats.processes === 0) {
    return (
      <div className="px-4 py-6 max-w-2xl">
        <p className="text-ui text-fg-secondary/70 leading-relaxed">
          No process creation events in this case yet. The tree is built from
          Sysmon event&nbsp;1 and Security event&nbsp;4688 in the imported event
          logs — import a <code className="font-mono text-fg-secondary">Security.evtx</code>{' '}
          or a Sysmon operational log and it appears here.
        </p>
        <p className="text-ui text-fg-secondary/50 leading-relaxed mt-3">
          4688 is off by default on Windows, and even when enabled it records
          the command line only if the audit policy was configured to capture
          it. A machine with Sysmon gives a far better tree than one without.
        </p>
      </div>
    )
  }

  const { stats } = data

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* What the tree is made of, above it: an analyst reading edges needs to
          know how many of them are inferred before reading any. */}
      <div className="flex items-center gap-3 px-4 py-2 border-b border-hairline shrink-0 flex-wrap">
        <span className="text-label text-fg-secondary/60">
          {stats.processes.toLocaleString()} processes
        </span>
        <span className="text-label text-accent" title={LINK_TITLE.asserted}>
          {stats.asserted.toLocaleString()} asserted
        </span>
        <span className="text-label text-severity-low" title={LINK_TITLE.inferred}>
          {stats.inferred.toLocaleString()} inferred
        </span>
        <span className="text-label text-severity-medium" title={LINK_TITLE.orphan}>
          {stats.orphans.toLocaleString()} orphaned
        </span>

        <div className="relative ml-auto w-72">
          <Search size={12}
            className="absolute left-2 top-1/2 -translate-y-1/2 text-fg-secondary/40" />
          <input
            value={draft}
            onChange={(e) => { setDraft(e.target.value); setQuery(e.target.value) }}
            placeholder="Filter by name, command line, user or PID"
            className="w-full bg-black/30 border border-hairline rounded-control
                       pl-7 pr-2 py-1 text-label font-mono text-fg
                       placeholder:text-fg-secondary/30 focus:outline-none focus:border-accent/40"
          />
        </div>
      </div>

      {stats.truncated && (
        <p className="flex items-center gap-2 px-4 py-1.5 border-b border-hairline
                      bg-severity-medium/8 text-label text-severity-medium shrink-0">
          <AlertTriangle size={12} className="shrink-0" />
          Stopped at {stats.processes.toLocaleString()} processes. This is not the
          whole tree — narrow the case&apos;s event logs rather than reading this
          as complete.
        </p>
      )}

      <div className="flex-1 min-h-0 overflow-auto">
        {flat.length === 0 && (
          <p className="px-4 py-4 text-label text-fg-secondary/50">Nothing matched.</p>
        )}
        {flat.map((row) => (
          <ProcessRow
            key={row.node.key} row={row} collapsed={collapsed} onToggle={toggle}
            selected={selected} onSelect={setSelected}
          />
        ))}
      </div>

      {selectedNode && (
        <div className="shrink-0">
          <Detail node={selectedNode} onClose={() => setSelected(null)} />
        </div>
      )}
    </div>
  )
}
