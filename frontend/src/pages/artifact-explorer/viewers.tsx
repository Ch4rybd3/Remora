/**
 * Artifact views for files that are not a table.
 *
 * A .txt is read, a .json is browsed, and an .evtx or .eml belongs to another
 * module entirely — the Explorer says so and links there rather than showing a
 * grid that would be the wrong tool.
 */
import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'

import { csvArtifactsApi, type CsvArtifactMeta } from '../../api/csvArtifacts'
import { FileText, Search } from '../../ui/icons'
import { useCurrentCase } from '../../context/CurrentCaseContext'

export type ArtifactFileType = 'csv' | 'txt' | 'json' | 'evtx' | 'eml'

export function getFileType(name: string): ArtifactFileType {
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  if (ext === 'evtx')           return 'evtx'
  if (ext === 'eml')            return 'eml'
  if (ext === 'json')           return 'json'
  if (ext === 'txt' || ext === 'log') return 'txt'
  return 'csv'
}

// ── Redirect banner for EVTX / EML ────────────────────────────────────────────

export function ArtifactRedirectView({ meta, caseId, type }: { meta: CsvArtifactMeta; caseId: string; type: 'evtx' | 'eml' }) {
  const navigate = useNavigate()
  const { setCurrentCase } = useCurrentCase()
  const isEvtx = type === 'evtx'
  const dest   = isEvtx ? '/artifacts/filesystem' : '/artifacts/email'
  const label  = isEvtx ? 'Module Logs / EVTX' : 'Email Analysis'
  const icon   = isEvtx ? '🗂️' : '📧'
  const color  = isEvtx ? 'text-severity-high bg-severity-high/8 border-severity-high/20' : 'text-severity-low bg-severity-low/8 border-severity-low/20'
  const hint   = isEvtx
    ? 'This EVTX file was registered in the Logs module. Open the Logs page to review it and run Chainsaw.'
    : 'This EML file was registered in the Email Analysis module. Open the Email Analysis page to analyse it.'
  return (
    <div className="flex flex-col items-center justify-center h-full gap-6 px-8">
      <div className="text-title opacity-60">{icon}</div>
      <div className={`flex flex-col items-center gap-3 text-center max-w-md p-6 border ${color}`}>
        <p className="text-ui font-medium">{meta.original_name}</p>
        <p className="text-label text-fg-secondary/60 leading-relaxed">{hint}</p>
        <button
          onClick={() => { setCurrentCase({ id: caseId, title: '' }); navigate(dest) }}
          className="mt-2 px-4 py-2 text-label font-medium bg-white/[0.05] border border-hairline hover:bg-white/[0.08] transition-colors"
        >
          Open {label} →
        </button>
      </div>
    </div>
  )
}

// ── TXT / LOG viewer ───────────────────────────────────────────────────────────

export function TextArtifactView({ meta, caseId }: { meta: CsvArtifactMeta; caseId: string }) {
  const [search, setSearch] = useState('')
  const { data, isLoading } = useQuery({
    queryKey: ['artifact-raw', caseId, meta.id],
    queryFn:  () => csvArtifactsApi.getRaw(caseId, meta.id),
    staleTime: 60_000,
  })

  const lines = useMemo(() => {
    const raw = data?.content ?? ''
    const all = raw.split('\n')
    if (!search.trim()) return all
    const q = search.toLowerCase()
    return all.filter(l => l.toLowerCase().includes(q))
  }, [data?.content, search])

  if (isLoading) {
    return <div className="flex items-center justify-center h-full text-fg-secondary/30 text-ui animate-pulse">Loading...</div>
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center gap-3 px-4 py-2.5 border-b border-hairline shrink-0 bg-panel/30">
        <FileText size={13} className="text-fg-secondary/40" />
        <span className="text-label font-medium text-fg/70 flex-1 truncate font-mono">{meta.original_name}</span>
        <div className="relative">
          <Search size={11} className="absolute left-2 top-1/2 -translate-y-1/2 text-fg-secondary/30" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Filter rows..."
            className="bg-fg/5 border border-hairline rounded-control pl-6 pr-3 py-1 text-label text-fg placeholder:text-fg-secondary/30 outline-none focus:border-strong w-52"
          />
        </div>
        <span className="text-label text-fg-secondary/30 shrink-0">{lines.length.toLocaleString()} lines</span>
      </div>
      <div className="flex-1 overflow-y-auto overflow-x-auto font-mono text-label text-fg/65 leading-5 px-4 py-3 bg-canvas">
        {lines.map((line, i) => (
          <div key={i} className="flex gap-3 hover:bg-white/[0.02] rounded-control px-1 group">
            <span className="text-fg-secondary/20 select-none w-10 text-right shrink-0">{i + 1}</span>
            <span className="break-all">{line || ' '}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── JSON viewer ───────────────────────────────────────────────────────────────

export function JsonNode({ data, depth = 0 }: { data: unknown; depth?: number }) {
  const [open, setOpen] = useState(depth < 2)
  if (data === null) return <span className="text-fg-secondary/40">null</span>
  if (typeof data === 'boolean') return <span className="text-data-2">{String(data)}</span>
  if (typeof data === 'number')  return <span className="text-severity-low">{String(data)}</span>
  if (typeof data === 'string')  return <span className="text-accent/80">"{data}"</span>

  const isArr = Array.isArray(data)
  const entries = isArr
    ? (data as unknown[]).map((v, i) => [String(i), v] as [string, unknown])
    : Object.entries(data as Record<string, unknown>)

  if (entries.length === 0) return <span className="text-fg-secondary/30">{isArr ? '[]' : '{}'}</span>

  const bracket = isArr ? ['[', ']'] : ['{', '}']
  const indent  = depth * 16

  return (
    <span>
      <button onClick={() => setOpen(o => !o)} className="text-fg-secondary/40 hover:text-fg transition-colors font-mono">
        {open ? '▾' : '▸'}
      </button>
      <span className="text-fg-secondary/30 ml-0.5">{bracket[0]}</span>
      {!open && (
        <span className="text-fg-secondary/30 cursor-pointer hover:text-fg" onClick={() => setOpen(true)}>
          {' '}…{entries.length}{' '}
        </span>
      )}
      {open && (
        <span>
          {entries.map(([k, v]) => (
            <div key={k} style={{ paddingLeft: indent + 16 }}>
              {!isArr && <span className="text-data-5/70">"{k}"</span>}
              {!isArr && <span className="text-fg-secondary/30">: </span>}
              <JsonNode data={v} depth={depth + 1} />
              <span className="text-fg-secondary/20">,</span>
            </div>
          ))}
          <div style={{ paddingLeft: indent }}><span className="text-fg-secondary/30">{bracket[1]}</span></div>
        </span>
      )}
      {!open && <span className="text-fg-secondary/30">{bracket[1]}</span>}
    </span>
  )
}

export function JsonArtifactView({ meta, caseId }: { meta: CsvArtifactMeta; caseId: string }) {
  const [search, setSearch] = useState('')
  const [mode, setMode]     = useState<'tree' | 'raw'>('tree')
  const { data, isLoading } = useQuery({
    queryKey: ['artifact-raw', caseId, meta.id],
    queryFn:  () => csvArtifactsApi.getRaw(caseId, meta.id),
    staleTime: 60_000,
  })

  const parsed = useMemo(() => {
    if (!data?.content) return null
    try { return JSON.parse(data.content) }
    catch { return null }
  }, [data?.content])

  const rawLines = useMemo(() => {
    if (!data?.content) return []
    const all = data.content.split('\n')
    if (!search.trim()) return all
    const q = search.toLowerCase()
    return all.filter(l => l.toLowerCase().includes(q))
  }, [data?.content, search])

  if (isLoading) {
    return <div className="flex items-center justify-center h-full text-fg-secondary/30 text-ui animate-pulse">Loading...</div>
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center gap-3 px-4 py-2.5 border-b border-hairline shrink-0 bg-panel/30">
        <FileText size={13} className="text-fg-secondary/40" />
        <span className="text-label font-medium text-fg/70 flex-1 truncate font-mono">{meta.original_name}</span>
        {mode === 'raw' && (
          <div className="relative">
            <Search size={11} className="absolute left-2 top-1/2 -translate-y-1/2 text-fg-secondary/30" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Filter rows..."
              className="bg-fg/5 border border-hairline rounded-control pl-6 pr-3 py-1 text-label text-fg placeholder:text-fg-secondary/30 outline-none focus:border-strong w-52"
            />
          </div>
        )}
        <div className="flex rounded-control border border-hairline overflow-hidden">
          <button onClick={() => setMode('tree')} className={`text-label px-2 py-1 transition-colors ${mode === 'tree' ? 'bg-accent/10 text-accent' : 'text-fg-secondary hover:text-fg'}`}>Tree</button>
          <button onClick={() => setMode('raw')}  className={`text-label px-2 py-1 transition-colors ${mode === 'raw'  ? 'bg-accent/10 text-accent' : 'text-fg-secondary hover:text-fg'}`}>Raw</button>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto overflow-x-auto font-mono text-label px-4 py-3 bg-canvas">
        {mode === 'tree' ? (
          parsed !== null
            ? <JsonNode data={parsed} depth={0} />
            : <p className="text-severity-critical/60 text-label">Invalid JSON - cannot parse the file.</p>
        ) : (
          rawLines.map((line, i) => (
            <div key={i} className="flex gap-3 hover:bg-white/[0.02] rounded-control px-1">
              <span className="text-fg-secondary/20 select-none w-10 text-right shrink-0">{i + 1}</span>
              <span className="text-fg/65 break-all">{line || ' '}</span>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
