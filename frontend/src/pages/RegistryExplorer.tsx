/**
 * Registry Explorer — navigating a hive key by key.
 *
 * `SOFTWARE`, `SECURITY` and `SAM` were recognised by the pipeline and
 * deliberately left unparsed: a hive holds thousands of unrelated facts and
 * which of them matter is an analyst's decision, not a default. Shipping a list
 * of "interesting keys" would have quietly defined what the registry means for
 * every investigation run on this tool. Browsing supplies the navigation
 * without making the choice.
 *
 * The layout is Registry Explorer's, because that is what an analyst already
 * knows: the key tree on the left, the selected key's values top-right, and the
 * selected value's contents below.
 */
import { useCallback, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'

import { PageShell } from '../ui/PageShell'
import { DataTable, type Column } from '../ui/DataTable'
import {
  AlertTriangle, ChevronRight, FolderTree, Loader2, Search, ShieldCheck, X,
} from '../ui/icons'
import {
  registryApi,
  type RegistryHive, type RegistryKey, type RegistrySearchHit, type RegistryValue,
} from '../api/registry'
import { useCurrentCase } from '../context/CurrentCaseContext'
import { fmtBytes } from '../utils/formatUtils'
import { CopyableName } from '../components/custody/CustodyActions'

const ROUTE = '/artifacts/registry'

/** `Microsoft\Windows` → `Windows`. The tree already shows the ancestry. */
function leaf(path: string): string {
  const parts = path.split('\\')
  return parts[parts.length - 1] || path
}

// ── Key tree ──────────────────────────────────────────────────────────────────
// Lazy by level. A hive holds hundreds of thousands of keys and sending the
// whole tree would be several minutes and several hundred megabytes to draw a
// list the analyst opens three of.

function TreeNode({
  caseId, hiveId, entry, depth, selected, onSelect, expandedPaths, onToggle,
}: {
  caseId: string
  hiveId: string
  entry: RegistryKey
  depth: number
  selected: string
  onSelect: (path: string) => void
  expandedPaths: Set<string>
  onToggle: (path: string) => void
}) {
  const open = expandedPaths.has(entry.path)
  const isSelected = selected === entry.path

  const { data: children = [], isLoading } = useQuery({
    queryKey: ['registry-keys', caseId, hiveId, entry.path],
    queryFn: () => registryApi.keys(caseId, hiveId, entry.path),
    enabled: open && entry.subkey_count > 0,
  })

  return (
    <div>
      <div
        className={`group flex items-center gap-1 py-1 pr-2 cursor-pointer border-l-2 transition-colors ${
          isSelected
            ? 'bg-accent/8 border-l-accent/50'
            : 'border-l-transparent hover:bg-white/[0.03]'
        }`}
        style={{ paddingLeft: `${depth * 12 + 6}px` }}
        onClick={() => onSelect(entry.path)}
      >
        <button
          className={`shrink-0 text-fg-secondary/40 hover:text-fg transition-transform ${
            open ? 'rotate-90' : ''
          } ${entry.subkey_count === 0 ? 'invisible' : ''}`}
          onClick={(e) => { e.stopPropagation(); onToggle(entry.path) }}
          aria-label={open ? `Collapse ${entry.name}` : `Expand ${entry.name}`}
        >
          <ChevronRight size={11} />
        </button>
        <span className={`text-label font-mono truncate ${isSelected ? 'text-fg' : 'text-fg/75'}`}>
          {entry.name}
        </span>
        {entry.value_count > 0 && (
          <span className="text-label text-fg-secondary/30 shrink-0 ml-auto tabular-nums">
            {entry.value_count}
          </span>
        )}
      </div>

      {open && isLoading && (
        <p className="text-label text-fg-secondary/40 py-1"
           style={{ paddingLeft: `${depth * 12 + 24}px` }}>
          <Loader2 size={10} className="inline animate-spin mr-1" />
          Reading…
        </p>
      )}

      {open && children.map((child) => (
        <TreeNode
          key={child.path} caseId={caseId} hiveId={hiveId} entry={child}
          depth={depth + 1} selected={selected} onSelect={onSelect}
          expandedPaths={expandedPaths} onToggle={onToggle}
        />
      ))}
    </div>
  )
}

// ── Value detail ──────────────────────────────────────────────────────────────

function ValueDetail({
  caseId, hiveId, keyPath, name, onClose,
}: {
  caseId: string; hiveId: string; keyPath: string; name: string; onClose: () => void
}) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['registry-value', caseId, hiveId, keyPath, name],
    queryFn: () => registryApi.value(caseId, hiveId, keyPath, name),
  })

  return (
    <div className="border-t border-hairline bg-black/20">
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-hairline">
        <span className="text-label font-mono text-fg/80 truncate">{name}</span>
        {data && (
          <span className="text-label text-fg-secondary/50 shrink-0">
            {data.type} · {fmtBytes(data.size)}
          </span>
        )}
        <button onClick={onClose} className="ml-auto text-fg-secondary/50 hover:text-fg shrink-0"
                aria-label="Close value">
          <X size={12} />
        </button>
      </div>

      {isLoading && <p className="px-3 py-3 text-label text-fg-secondary/50">Reading…</p>}
      {isError && (
        <p className="px-3 py-3 text-label text-severity-medium">
          This value could not be read.
        </p>
      )}

      {data && (
        <div className="grid grid-cols-2 divide-x divide-hairline max-h-56 overflow-auto">
          {/* Both halves, because they answer different questions. The text is
              what the value means; the bytes are what is stored, which is what
              gets quoted when the two disagree. */}
          <div className="px-3 py-2 min-w-0">
            <p className="text-label uppercase tracking-wide text-fg-secondary/40 mb-1">Value</p>
            <pre className="text-label font-mono text-fg/85 whitespace-pre-wrap break-all">
              {data.text || <span className="text-fg-secondary/40">(empty)</span>}
            </pre>
          </div>
          <div className="px-3 py-2 min-w-0">
            <p className="text-label uppercase tracking-wide text-fg-secondary/40 mb-1">Bytes</p>
            <pre className="text-label font-mono text-fg-secondary/60 whitespace-pre-wrap break-all">
              {data.hex || '—'}
            </pre>
          </div>
        </div>
      )}

      {data?.truncated && (
        <p className="px-3 py-1.5 text-label text-severity-medium border-t border-hairline">
          Shown up to 1 MB. The value is larger.
        </p>
      )}
    </div>
  )
}

// ── Search ────────────────────────────────────────────────────────────────────

const MATCH_LABEL: Record<RegistrySearchHit['matched'], string> = {
  key:         'key name',
  value_name:  'value name',
  value_data:  'value data',
}

function SearchResults({
  caseId, hiveId, query, onOpen,
}: {
  caseId: string; hiveId: string; query: string
  onOpen: (keyPath: string, valueName: string | null) => void
}) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['registry-search', caseId, hiveId, query],
    queryFn: () => registryApi.search(caseId, hiveId, query),
    enabled: query.length >= 2,
  })

  if (isLoading) {
    return (
      <p className="px-4 py-6 text-ui text-fg-secondary/50">
        <Loader2 size={13} className="inline animate-spin mr-2" />
        Walking the hive…
      </p>
    )
  }
  if (isError) {
    return <p className="px-4 py-6 text-ui text-severity-medium">The search failed.</p>
  }
  if (!data) return null

  return (
    <div>
      <div className="flex items-center gap-2 px-4 py-2 border-b border-hairline">
        <span className="text-label text-fg-secondary/60">
          {data.hits.length} match{data.hits.length === 1 ? '' : 'es'} in {data.scanned.toLocaleString()} keys
        </span>
        {data.exhausted && (
          <span className="flex items-center gap-1 text-label text-severity-medium">
            <AlertTriangle size={10} />
            stopped early — narrow the search to see the rest
          </span>
        )}
      </div>

      {data.hits.length === 0 && (
        <p className="px-4 py-6 text-ui text-fg-secondary/50">Nothing matched.</p>
      )}

      <div className="divide-y divide-hairline">
        {data.hits.map((hit, i) => (
          <button
            key={`${hit.key_path}-${hit.value_name}-${i}`}
            onClick={() => onOpen(hit.key_path, hit.value_name)}
            className="block w-full text-left px-4 py-2 hover:bg-white/[0.03]"
          >
            <div className="flex items-center gap-2">
              <span className="text-label px-1.5 py-0.5 rounded-control border border-hairline text-fg-muted shrink-0">
                {MATCH_LABEL[hit.matched]}
              </span>
              <span className="text-label font-mono text-fg/80 truncate">
                {hit.key_path || '(root)'}
                {hit.value_name && <span className="text-accent/70"> → {hit.value_name}</span>}
              </span>
            </div>
            {hit.matched !== 'key' && (
              <p className="text-label font-mono text-fg-secondary/50 truncate mt-0.5">
                {hit.preview}
              </p>
            )}
          </button>
        ))}
      </div>
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function RegistryExplorer() {
  const { currentCase } = useCurrentCase()
  const caseId = currentCase?.id
  const [hiveId, setHiveId] = useState<string | null>(null)
  const [keyPath, setKeyPath] = useState('')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [valueName, setValueName] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [query, setQuery] = useState('')

  const { data: hives = [], isLoading: loadingHives } = useQuery({
    queryKey: ['registry-hives', caseId],
    queryFn: () => registryApi.hives(caseId!),
    enabled: !!caseId,
  })

  const active = useMemo(
    () => hives.find((h) => h.id === hiveId) ?? null,
    [hives, hiveId],
  )

  const { data: info } = useQuery({
    queryKey: ['registry-info', caseId, hiveId],
    queryFn: () => registryApi.info(caseId!, hiveId!),
    enabled: !!caseId && !!hiveId,
  })

  const { data: rootKeys = [] } = useQuery({
    queryKey: ['registry-keys', caseId, hiveId, ''],
    queryFn: () => registryApi.keys(caseId!, hiveId!, ''),
    enabled: !!caseId && !!hiveId,
  })

  const { data: values = [], isLoading: loadingValues } = useQuery({
    queryKey: ['registry-values', caseId, hiveId, keyPath],
    queryFn: () => registryApi.values(caseId!, hiveId!, keyPath),
    enabled: !!caseId && !!hiveId,
  })

  const openHive = useCallback((hive: RegistryHive) => {
    setHiveId(hive.id)
    setKeyPath('')
    setExpanded(new Set())
    setValueName(null)
    setQuery('')
    setDraft('')
  }, [])

  const toggle = useCallback((path: string) => {
    setExpanded((current) => {
      const next = new Set(current)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }, [])

  /** Open a search hit: expand every ancestor so the tree shows where it sits. */
  const openHit = useCallback((path: string, name: string | null) => {
    const parts = path.split('\\').filter(Boolean)
    const ancestors = parts.map((_, i) => parts.slice(0, i + 1).join('\\'))
    setExpanded((current) => new Set([...current, ...ancestors]))
    setKeyPath(path)
    setValueName(name)
    setQuery('')
    setDraft('')
  }, [])

  const columns: Column<RegistryValue>[] = [
    {
      key: 'name', header: 'Name', width: 'w-64', mono: true,
      render: (v) => <span className="text-fg/85 truncate">{v.name}</span>,
    },
    {
      key: 'type', header: 'Type', width: 'w-44', mono: true,
      render: (v) => <span className="text-fg-secondary/60">{v.type}</span>,
    },
    {
      key: 'size', header: 'Size', width: 'w-20', align: 'right', mono: true,
      render: (v) => <span className="tabular-nums text-fg-secondary/60">{v.size}</span>,
    },
    {
      key: 'preview', header: 'Data', mono: true,
      render: (v) => (
        <span className="text-fg-secondary/70 truncate">
          {v.preview || <span className="text-fg-secondary/30">(empty)</span>}
          {v.truncated && <span className="text-severity-medium"> …</span>}
        </span>
      ),
    },
  ]

  const hiveList = (
    <div className="flex flex-col h-full min-h-0">
      <div className="px-3 py-2 border-b border-hairline shrink-0">
        <p className="text-label uppercase tracking-wide text-fg-secondary/50">Hives</p>
      </div>

      <div className="overflow-auto shrink-0 max-h-48 border-b border-hairline">
        {loadingHives && <p className="px-3 py-3 text-label text-fg-secondary/50">Loading…</p>}
        {!loadingHives && hives.length === 0 && (
          <p className="px-3 py-3 text-label text-fg-secondary/50 leading-relaxed">
            No registry hive in this case yet. Drop one in the case folder and it
            appears here — nothing is uploaded from this page.
          </p>
        )}
        {hives.map((hive) => (
          <button
            key={hive.id}
            onClick={() => openHive(hive)}
            disabled={!hive.available}
            className={`block w-full text-left px-3 py-1.5 border-l-2 transition-colors ${
              hive.id === hiveId
                ? 'bg-accent/8 border-l-accent/50'
                : 'border-l-transparent hover:bg-white/[0.03]'
            } ${hive.available ? '' : 'opacity-50 cursor-not-allowed'}`}
          >
            <div className="flex items-center gap-1.5">
              <span className="text-label font-mono text-fg/85 truncate">{hive.name}</span>
              {hive.preserved && <ShieldCheck size={10} className="text-accent shrink-0" />}
            </div>
            <span className="text-label text-fg-secondary/40">
              {hive.available ? fmtBytes(hive.size_bytes) : 'file missing'}
            </span>
          </button>
        ))}
      </div>

      {hiveId && (
        <div className="flex-1 min-h-0 overflow-auto">
          <div className="px-3 py-2 border-b border-hairline">
            <p className="text-label uppercase tracking-wide text-fg-secondary/50">Keys</p>
          </div>
          <div
            className={`py-1 ${keyPath === '' ? 'bg-accent/8' : ''}`}
            onClick={() => setKeyPath('')}
          >
            <span className="px-3 text-label font-mono text-fg/60 cursor-pointer">
              {info?.root_name ?? '(root)'}
            </span>
          </div>
          {rootKeys.map((entry) => (
            <TreeNode
              key={entry.path} caseId={caseId!} hiveId={hiveId} entry={entry}
              depth={0} selected={keyPath}
              onSelect={(p) => { setKeyPath(p); setValueName(null) }}
              expandedPaths={expanded} onToggle={toggle}
            />
          ))}
        </div>
      )}
    </div>
  )

  return (
    <PageShell
      route={ROUTE}
      title="Registry Explorer"
      subtitle={active?.name}
      meta={info ? `${info.internal_name || '—'} · v1.${info.version}` : undefined}
      asideLeft={caseId ? hiveList : undefined}
      fullHeight
      toolbar={hiveId ? (
        <div className="flex items-center gap-2 w-full">
          <div className="relative flex-1 max-w-lg">
            <Search size={12}
              className="absolute left-2 top-1/2 -translate-y-1/2 text-fg-secondary/40" />
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') setQuery(draft.trim()) }}
              placeholder="Search keys, value names and value data — Enter to run"
              className="w-full bg-black/30 border border-hairline rounded-control
                         pl-7 pr-2 py-1 text-label font-mono text-fg
                         placeholder:text-fg-secondary/30 focus:outline-none focus:border-accent/40"
            />
          </div>
          {query && (
            <button onClick={() => { setQuery(''); setDraft('') }}
              className="text-label text-fg-secondary/60 hover:text-fg">
              Clear
            </button>
          )}
          <span className="ml-auto text-label font-mono text-fg-secondary/40 truncate">
            {keyPath || info?.root_name || ''}
          </span>
        </div>
      ) : undefined}
    >
      {!caseId && (
        <p className="px-4 py-6 text-ui text-fg-secondary/60">
          Select a case to browse its registry hives.
        </p>
      )}

      {caseId && !hiveId && (
        <div className="px-4 py-6 max-w-2xl">
          <FolderTree size={20} className="text-fg-secondary/30 mb-3" />
          <p className="text-ui text-fg-secondary/70 leading-relaxed">
            Choose a hive to browse it key by key. Remora does not decide which
            keys matter — that is the analyst&apos;s call, and shipping a list
            of them would quietly define what &ldquo;the registry&rdquo; means
            for every investigation.
          </p>
          <p className="text-ui text-fg-secondary/50 leading-relaxed mt-3">
            Amcache, Shimcache and the shellbags in the user hives are parsed
            into tables as well, and appear in the Artifact Explorer.
          </p>
        </div>
      )}

      {caseId && hiveId && (
        <div className="flex flex-col h-full min-h-0">
          {/* Warnings first: they decide how much of what follows can be
              trusted, and an analyst who reads the values before the warning
              has already drawn a conclusion. */}
          {info && (info.dirty || info.in_transaction) && (
            <div className="flex items-start gap-2 px-4 py-2 border-b border-hairline
                            bg-severity-medium/8 shrink-0">
              <AlertTriangle size={13} className="text-severity-medium shrink-0 mt-0.5" />
              <div className="min-w-0">
                <p className="text-label text-severity-medium">
                  {info.dirty
                    ? 'This hive was collected while Windows was writing to it.'
                    : 'This hive was collected during a transaction.'}
                </p>
                <p className="text-label text-fg-secondary/60 mt-0.5">
                  It is read as it stands — replaying the transaction logs would
                  mean modifying evidence — so its most recent values may be
                  missing. Deleted keys are not recovered either.
                </p>
              </div>
            </div>
          )}

          {query ? (
            <div className="flex-1 min-h-0 overflow-auto">
              <SearchResults caseId={caseId} hiveId={hiveId} query={query} onOpen={openHit} />
            </div>
          ) : (
            <>
              <div className="flex-1 min-h-0 overflow-auto">
                {loadingValues && (
                  <p className="px-4 py-4 text-label text-fg-secondary/50">Reading…</p>
                )}
                {!loadingValues && values.length === 0 && (
                  <p className="px-4 py-4 text-label text-fg-secondary/50">
                    This key holds no values.
                  </p>
                )}
                {values.length > 0 && (
                  <DataTable
                    columns={columns}
                    rows={values}
                    rowKey={(v) => v.name}
                    onRowClick={(v) => setValueName(v.name)}
                  />
                )}
              </div>

              {valueName && (
                <div className="shrink-0">
                  <ValueDetail
                    caseId={caseId} hiveId={hiveId} keyPath={keyPath}
                    name={valueName} onClose={() => setValueName(null)}
                  />
                </div>
              )}
            </>
          )}

          <div className="shrink-0 border-t border-hairline px-4 py-1.5 flex items-center gap-3">
            <CopyableName
              value={keyPath || info?.root_name || ''}
              className="text-label font-mono text-fg-secondary/50 truncate"
            />
            <span className="ml-auto text-label text-fg-secondary/30 shrink-0">
              {leaf(keyPath) && values.length > 0
                ? `${values.length} value${values.length === 1 ? '' : 's'}`
                : ''}
            </span>
          </div>
        </div>
      )}
    </PageShell>
  )
}
