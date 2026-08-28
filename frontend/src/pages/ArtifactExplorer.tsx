import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react'
import { PageShell } from '../ui/PageShell'
import { useSearchParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  FileText, Globe, Info, Loader2, Search, Table2, Trash2, Upload, X,
} from '../ui/icons'
import { csvArtifactsApi, type CsvArtifactMeta } from '../api/csvArtifacts'
import { timelineApi } from '../api/timeline'
import { useCurrentCase } from '../context/CurrentCaseContext'
import { fmtRelative, parseArtifactTimestamp } from '../utils/dateUtils'
import { PinnedPanel } from './artifact-explorer/PinnedPanel'
import { RowDetailPanel, type SelectedRow } from './artifact-explorer/RowDetailPanel'
import { SidePanel } from '../ui/SidePanel'
import { ArtifactTableView } from './artifact-explorer/ArtifactTableView'
import { CopyableName, CustodyActions } from '../components/custody/CustodyActions'
import { EZBadge } from './artifact-explorer/EZBadge'
import { OmniSearchView } from './artifact-explorer/OmniSearchView'
import {
  ArtifactRedirectView, JsonArtifactView, TextArtifactView, getFileType,
} from './artifact-explorer/viewers'
import { buildDefaultDescription, buildDefaultTitle } from './artifact-explorer/timelineRecipes'
import { defaultTabState, type PinnedRow, type TabState } from './artifact-explorer/types'

// ── Sidebar file row ──────────────────────────────────────────────────────────

function FileSidebarRow({ meta, caseId, isOpen, onOpen, onDelete, onCustodyChange }: {
  meta:     CsvArtifactMeta
  caseId:   string
  isOpen:   boolean
  onOpen:   () => void
  onDelete: () => void
  onCustodyChange: () => void
}) {
  return (
    <div onClick={onOpen}
      className={`group relative px-3 py-2.5 cursor-pointer border-l-2 transition-colors ${isOpen ? 'bg-accent/5 border-l-accent/40' : 'border-l-transparent hover:bg-white/[0.03]'}`}>
      <div className="flex items-start gap-2 pr-14">
        <FileText size={12} className="mt-0.5 shrink-0 text-fg-secondary/30" />
        <div className="flex-1 min-w-0">
          {/* Clicking the name copies it - it is what gets pasted into a
              command line most often. Opening the file is the row's job. */}
          <CopyableName value={meta.original_name}
            className="block w-full text-label text-fg/80 leading-snug font-mono" />
          <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
            {meta.ez_label
              ? <EZBadge label={meta.ez_label} />
              : <span className="text-label font-semibold px-1.5 py-0.5 rounded-control border bg-fg-muted/10 text-fg-muted border-fg-muted/20">unknown</span>
            }
            {meta.source_timezone && (
              <span className="flex items-center gap-0.5 text-label font-semibold px-1.5 py-0.5 rounded-control border border-severity-low/30 bg-severity-low/10 text-severity-low">
                <Globe size={7} />
                {meta.source_timezone.split('/').pop()?.replace('_', ' ') ?? meta.source_timezone}
              </span>
            )}
            <span className="text-label text-fg-secondary/40">{meta.row_count.toLocaleString()} rows</span>
          </div>
          <p className="text-label text-fg-secondary/25 mt-0.5">{fmtRelative(meta.uploaded_at)}</p>
        </div>
      </div>

      {/* The shared control, so preserving here means exactly what it means in
          the Collection tab - including the IOC option and the withdrawal the
          bespoke button that used to live here could not offer. */}
      <div className="absolute right-7 top-2" onClick={e => e.stopPropagation()}>
        <CustodyActions
          caseId={caseId} kind="artifact" sourceId={meta.id}
          name={meta.original_name} evidenceId={meta.evidence_id}
          showCopy={false} onChange={onCustodyChange} />
      </div>

      <button onClick={e => { e.stopPropagation(); onDelete() }}
        className="absolute right-2 top-2.5 opacity-0 group-hover:opacity-100 text-fg-secondary/40 hover:text-severity-critical transition-all">
        <Trash2 size={11} />
      </button>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function ArtifactExplorer() {
  const { currentCase } = useCurrentCase()
  const caseId = currentCase?.id
  const qc     = useQueryClient()
  const [searchParams, setSearchParams] = useSearchParams()

  const { data: files = [], isLoading: filesLoading } = useQuery({
    queryKey: ['csv-artifacts', caseId],
    queryFn:  () => csvArtifactsApi.list(caseId!),
    enabled:  !!caseId,
  })

  const [openTabs,  setOpenTabs]  = useState<string[]>([])
  const [activeTab, setActiveTab] = useState<string | null>(null)
  const [tabStates, setTabStates] = useState<Record<string, TabState>>({})

  // ── Persistence: load per-case state from localStorage on mount ───────────
  const loadedCaseRef = useRef<string | null>(null)
  useEffect(() => {
    if (!caseId || loadedCaseRef.current === caseId) return
    loadedCaseRef.current = caseId
    try {
      const raw = localStorage.getItem(`ae-state-${caseId}`)
      if (!raw) return
      const { openTabs: ot, activeTab: at, tabStates: ts } = JSON.parse(raw)
      if (Array.isArray(ot)) setOpenTabs(ot)
      if (at === null || typeof at === 'string') setActiveTab(at)
      if (ts && typeof ts === 'object') setTabStates(ts)
    } catch { /* ignore malformed data */ }
  }, [caseId])

  // ── Persistence: save on change ───────────────────────────────────────────
  useEffect(() => {
    if (!caseId) return
    try {
      localStorage.setItem(`ae-state-${caseId}`, JSON.stringify({ openTabs, activeTab, tabStates }))
    } catch { /* storage quota */ }
  }, [caseId, openTabs, activeTab, tabStates])

  // ── Validate persisted tabs against server file list ─────────────────────
  useEffect(() => {
    if (!files.length) return
    const validIds = new Set(files.map(f => f.id))
    setOpenTabs(prev => {
      const next = prev.filter(id => validIds.has(id))
      return next.length !== prev.length ? next : prev
    })
    setActiveTab(prev => (prev && !validIds.has(prev) ? null : prev))
  }, [files])

  const openFile = useCallback((id: string) => {
    setOpenTabs(prev => prev.includes(id) ? prev : [...prev, id])
    setActiveTab(id)
    setOmniQuery('')
  }, [])

  useEffect(() => {
    const openParam = searchParams.get('open')
    if (!openParam || files.length === 0) return
    const name  = decodeURIComponent(openParam)
    const match = files.find(f => f.original_name === name)
    if (match) {
      openFile(match.id)
      setSearchParams({}, { replace: true })
    }
  }, [files, searchParams, openFile, setSearchParams])

  const [sidebarWidth, setSidebarWidth] = useState<number>(() =>
    parseInt(localStorage.getItem('ae-sidebar-w') ?? '240', 10)
  )
  const isResizing  = useRef(false)
  const resizeStart = useRef({ x: 0, w: 0 })

  const onResizeStart = (e: React.MouseEvent) => {
    e.preventDefault()
    isResizing.current  = true
    resizeStart.current = { x: e.clientX, w: sidebarWidth }
    document.body.style.cursor     = 'col-resize'
    document.body.style.userSelect = 'none'
  }

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!isResizing.current) return
      const w = Math.max(160, Math.min(520, resizeStart.current.w + e.clientX - resizeStart.current.x))
      setSidebarWidth(w)
    }
    const onUp = () => {
      if (!isResizing.current) return
      isResizing.current = false
      document.body.style.cursor     = ''
      document.body.style.userSelect = ''
      setSidebarWidth(w => { localStorage.setItem('ae-sidebar-w', String(w)); return w })
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup',   onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup',   onUp)
    }
  }, [])

  const [fileSearch, setFileSearch] = useState('')
  const filteredSidebarFiles = useMemo(() => {
    if (!fileSearch.trim()) return files
    const q = fileSearch.toLowerCase()
    return files.filter(f =>
      f.original_name.toLowerCase().includes(q) ||
      (f.ez_label ?? '').toLowerCase().includes(q)
    )
  }, [files, fileSearch])

  const closeTab = (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    setOpenTabs(prev => {
      const next = prev.filter(t => t !== id)
      if (activeTab === id) setActiveTab(next[next.length - 1] ?? null)
      return next
    })
  }

  const updateTabState = useCallback((id: string, patch: Partial<TabState>) => {
    setTabStates(prev => ({ ...prev, [id]: { ...(prev[id] ?? defaultTabState()), ...patch } }))
  }, [])

  const [uploading, setUploading] = useState(false)
  const [uploadErr, setUploadErr] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const SUPPORTED_EXTS = ['.csv', '.json', '.txt', '.log']

  const handleFiles = async (fileList: FileList | null) => {
    if (!fileList || !caseId) return
    setUploadErr(null)
    setUploading(true)
    let lastId: string | null = null
    for (const file of Array.from(fileList)) {
      const ext = '.' + (file.name.split('.').pop() ?? '').toLowerCase()
      if (!SUPPORTED_EXTS.includes(ext)) {
        setUploadErr(`Unsupported type: ${ext}. Accepted: ${SUPPORTED_EXTS.join(', ')}`)
        continue
      }
      try {
        const meta = await csvArtifactsApi.upload(caseId, file)
        lastId = meta.id
      } catch (e: unknown) {
        const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? 'Upload failed'
        setUploadErr(String(msg))
      }
    }
    qc.invalidateQueries({ queryKey: ['csv-artifacts', caseId] })
    if (lastId) openFile(lastId)
    setUploading(false)
  }

  const deleteMutation = useMutation({
    mutationFn: (id: string) => csvArtifactsApi.delete(caseId!, id),
    onSuccess: (_, id) => {
      qc.invalidateQueries({ queryKey: ['csv-artifacts', caseId] })
      setOpenTabs(prev => {
        const next = prev.filter(t => t !== id)
        if (activeTab === id) setActiveTab(next[next.length - 1] ?? null)
        return next
      })
    },
  })

  // The row open in the detail panel. Held here rather than in the table so the
  // panel on the right can show it while the table keeps its scroll position.
  const [selectedRow, setSelectedRow] = useState<SelectedRow | null>(null)
  const [rightTab,    setRightTab]    = useState<string>('selection')

  const [pinnedRows,   setPinnedRows]   = useState<PinnedRow[]>([])
  const [exporting,    setExporting]    = useState(false)
  const [exportedKeys, setExportedKeys] = useState<Set<string>>(new Set())

  const pinnedKeySet = useMemo(() => new Set(pinnedRows.map(p => p.key)), [pinnedRows])

  const handlePinToggle = useCallback((key: string, row: Record<string, string>, meta: CsvArtifactMeta) => {
    setPinnedRows(prev => {
      if (prev.some(p => p.key === key)) return prev.filter(p => p.key !== key)
      const base = {
        key,
        artifactId:     meta.id,
        artifactName:   meta.original_name,
        ezLabel:        meta.ez_label,
        ezCategory:     meta.ez_category,
        dateColumn:     meta.date_column,
        sourceTimezone: meta.source_timezone ?? null,
        columns:        meta.columns,
        row,
      }
      return [...prev, {
        ...base,
        title:       buildDefaultTitle(base),
        description: buildDefaultDescription(base),
      }]
    })
  }, [])

  /** Analyst edits to a pinned row's title/description, before export. */
  const handlePinEdit = useCallback((key: string, patch: Partial<Pick<PinnedRow, 'title' | 'description'>>) => {
    setPinnedRows(prev => prev.map(p => (p.key === key ? { ...p, ...patch } : p)))
  }, [])

  /** Restore the auto-generated title/description for one pinned row. */
  const handlePinReset = useCallback((key: string) => {
    setPinnedRows(prev => prev.map(p =>
      p.key === key
        ? { ...p, title: buildDefaultTitle(p), description: buildDefaultDescription(p) }
        : p
    ))
  }, [])

  const exportToTimeline = useCallback(async () => {
    if (!caseId || pinnedRows.length === 0) return
    setExporting(true)
    try {
      const sorted = [...pinnedRows].sort((a, b) => {
        const ta = a.dateColumn ? a.row[a.dateColumn] ?? '' : ''
        const tb = b.dateColumn ? b.row[b.dateColumn] ?? '' : ''
        return ta.localeCompare(tb)
      })
      for (const item of sorted) {
        const dateVal = item.dateColumn ? item.row[item.dateColumn] ?? '' : ''
        const ts = dateVal
          ? parseArtifactTimestamp(dateVal, item.sourceTimezone)
          : new Date().toISOString()
        const source = item.ezLabel ?? item.artifactName
        await timelineApi.create(caseId, {
          event_ts: ts,
          title:       item.title.trim() || buildDefaultTitle(item),
          description: item.description,
          actor: '', source, tags: '',
          // Full untouched record — rendered under a chevron in the Timeline
          // tab so the analyst can rewrite title/description freely without
          // ever losing the underlying evidence.
          origin:      'artifact',
          raw_payload: JSON.stringify(item.row),
          raw_source:  `${source} · ${item.artifactName}`,
        })
      }
      qc.invalidateQueries({ queryKey: ['timeline', caseId] })

      // Append CoC note on each artifact that has a linked evidence record
      const countByArtifact = sorted.reduce<Record<string, number>>((acc, p) => {
        acc[p.artifactId] = (acc[p.artifactId] ?? 0) + 1
        return acc
      }, {})
      await Promise.allSettled(
        Object.entries(countByArtifact).map(([artifactId, count]) =>
          csvArtifactsApi.cocNote(caseId, artifactId,
            `${count} event(s) exported to the Timeline`
          )
        )
      )

      setExportedKeys(prev => new Set([...prev, ...sorted.map(s => s.key)]))
      setPinnedRows([])
    } finally {
      setExporting(false)
    }
  }, [caseId, pinnedRows, qc])

  const [omniQuery,     setOmniQuery]     = useState('')
  const [omniDebounced, setOmniDebounced] = useState('')
  const [omniRegex,     setOmniRegex]     = useState(false)
  const omniTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const handleOmniChange = (val: string) => {
    setOmniQuery(val)
    if (omniTimer.current) clearTimeout(omniTimer.current)
    omniTimer.current = setTimeout(() => setOmniDebounced(val), 450)
  }

  const showOmni = omniDebounced.length >= 2

  const [dragging, setDragging] = useState(false)

  if (!caseId) {
    return (
      <div className="p-6 max-w-xl mx-auto mt-20 text-center space-y-4">
        <Table2 size={40} className="mx-auto text-fg-secondary/20" />
        <h1 className="text-title font-bold text-fg">Artifact Explorer</h1>
        <p className="text-fg-secondary text-ui">No active case. Set a current case from the top bar to explore CSV artifacts.</p>
        <div className="flex items-center gap-2 text-label text-fg-secondary/60 bg-white/[0.02] border border-hairline px-3 py-2 justify-center">
          <Info size={12} /> Select a case to upload and browse EZ Tools CSV exports
        </div>
      </div>
    )
  }

  const activeMeta = activeTab ? files.find(f => f.id === activeTab) ?? null : null

  const activeView = (() => {
    if (!activeTab || !activeMeta) return null
    const ft = getFileType(activeMeta.original_name)
    if (ft === 'evtx') return <ArtifactRedirectView key={activeTab} meta={activeMeta} caseId={caseId} type="evtx" />
    if (ft === 'eml')  return <ArtifactRedirectView key={activeTab} meta={activeMeta} caseId={caseId} type="eml" />
    if (ft === 'txt')  return <TextArtifactView key={activeTab} meta={activeMeta} caseId={caseId} />
    if (ft === 'json') return <JsonArtifactView key={activeTab} meta={activeMeta} caseId={caseId} />
    return (
      <ArtifactTableView key={activeTab} caseId={caseId} meta={activeMeta}
        state={tabStates[activeTab] ?? defaultTabState()}
        onStateChange={patch => updateTabState(activeTab, patch)}
        pinnedKeys={pinnedKeySet}
        exportedKeys={exportedKeys}
        onPinToggle={(key, row) => handlePinToggle(key, row, activeMeta)}
        selectedKey={selectedRow?.pinKey ?? null}
        onSelectRow={(row, columns, key) => {
          setSelectedRow(row ? { row, columns, pinKey: key } : null)
          if (row) setRightTab('detail')
        }} />
    )
  })()

  return (
    // The whole page is the drop target — an analyst dropping a CSV should not
    // have to find a zone first — so the drag handlers wrap the shell.
    <div
      className="h-full"
      data-no-select={isResizing.current || undefined}
      onDragOver={e => { e.preventDefault(); setDragging(true) }}
      onDragLeave={() => setDragging(false)}
      onDrop={e => { e.preventDefault(); setDragging(false); handleFiles(e.dataTransfer.files) }}
    >
    <PageShell
      route="/artifacts/explorer"
      title="Artifact Explorer"
      subtitle={currentCase?.title}
      fullHeight
      asideLeft={(
      <aside
        className="relative shrink-0 border-r border-hairline bg-panel flex flex-col min-h-0 overflow-hidden"
        style={{ width: sidebarWidth }}
      >

        <div className="px-3 py-2 border-b border-hairline shrink-0">
          <div className="relative">
            <Globe size={11} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-secondary/30" />
            <input value={omniQuery} onChange={e => handleOmniChange(e.target.value)}
              placeholder="Omnisearch all files…"
              className={`w-full bg-fg/5 border rounded-control pl-7 pr-14 py-1.5 text-label text-fg placeholder:text-fg-secondary/30 outline-none transition-colors ${omniQuery ? 'border-severity-low/30 bg-severity-low/5' : 'border-hairline focus:border-strong'}`} />
            <div className="absolute right-1.5 top-1/2 -translate-y-1/2 flex items-center gap-1">
              <button
                onClick={() => setOmniRegex(r => !r)}
                title={omniRegex ? 'Disable regex' : 'Enable regex'}
                className={`px-1 py-0.5 rounded-control text-label font-mono border transition-colors ${omniRegex ? 'border-accent/40 text-accent bg-accent/10' : 'border-hairline text-fg-secondary/40 hover:text-fg hover:border-strong'}`}
              >.*</button>
              {omniQuery && (
                <button onClick={() => { setOmniQuery(''); setOmniDebounced('') }}
                  className="text-fg-secondary/40 hover:text-fg"><X size={10} /></button>
              )}
            </div>
          </div>
        </div>

        <div className="px-3 py-2 border-b border-hairline shrink-0">
          <input ref={fileRef} type="file" accept=".csv,.json,.txt,.log,text/csv,application/json" multiple className="sr-only"
            onChange={e => handleFiles(e.target.files)} />
          <button onClick={() => fileRef.current?.click()} disabled={uploading}
            className="w-full flex items-center justify-center gap-1.5 text-label py-1.5 rounded-control border border-dashed border-hairline text-fg-secondary hover:text-accent hover:border-accent/30 transition-colors disabled:opacity-40">
            {uploading ? <Loader2 size={11} className="animate-spin" /> : <Upload size={11} />}
            {uploading ? 'Uploading…' : 'Upload file…'}
          </button>
          {uploadErr && <p className="text-label text-severity-critical mt-1">{uploadErr}</p>}
        </div>

        {files.length > 3 && (
          <div className="px-3 py-2 border-b border-hairline shrink-0">
            <div className="relative">
              <Search size={10} className="absolute left-2 top-1/2 -translate-y-1/2 text-fg-secondary/30" />
              <input
                value={fileSearch}
                onChange={e => setFileSearch(e.target.value)}
                placeholder="Filter files…"
                className="w-full bg-fg/5 border border-hairline rounded-control pl-6 pr-5 py-1 text-label text-fg placeholder:text-fg-secondary/30 outline-none focus:border-strong transition-colors"
              />
              {fileSearch && (
                <button onClick={() => setFileSearch('')}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 text-fg-secondary/40 hover:text-fg">
                  <X size={9} />
                </button>
              )}
            </div>
          </div>
        )}

        <div className="flex-1 overflow-y-auto">
          {filesLoading && (
            <div className="flex items-center justify-center py-8">
              <Loader2 size={16} className="animate-spin text-fg-secondary/30" />
            </div>
          )}
          {!filesLoading && files.length === 0 && (
            <p className="text-label text-fg-secondary/30 text-center py-8 px-3">
              No CSV files yet.<br />Upload EZ Tools output files to start.
            </p>
          )}
          {!filesLoading && files.length > 0 && filteredSidebarFiles.length === 0 && (
            <p className="text-label text-fg-secondary/30 text-center py-6 px-3 italic">
              No files match "{fileSearch}"
            </p>
          )}
          {filteredSidebarFiles.map(f => (
            <FileSidebarRow key={f.id} meta={f} caseId={caseId!}
              isOpen={openTabs.includes(f.id)}
              onOpen={() => openFile(f.id)}
              onDelete={() => deleteMutation.mutate(f.id)}
              onCustodyChange={() => qc.invalidateQueries({ queryKey: ['csv-artifacts', caseId] })} />
          ))}
        </div>

        <div
          onMouseDown={onResizeStart}
          className="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize z-10 group flex items-center justify-center"
          title="Drag to resize sidebar"
        >
          <div className="w-0.5 h-12 rounded-pill bg-fg/10 group-hover:bg-accent/40 transition-colors" />
        </div>
      </aside>
      )}
      asideRight={(
        <SidePanel
          storageKey="artifact-explorer"
          // Wider than the default: this panel holds full field values —
          // command lines, registry paths, base64 — and the whole point of
          // opening a row is not having them truncated.
          defaultWidth={420}
          activeTab={rightTab}
          onTabChange={setRightTab}
          tabs={[
            {
              id: 'detail',
              label: 'Detail',
              content: (
                <RowDetailPanel
                  selected={selectedRow}
                  isPinned={selectedRow ? pinnedKeySet.has(selectedRow.pinKey) : false}
                  dateColumn={activeMeta?.date_column ?? null}
                  onPin={() => {
                    if (selectedRow && activeMeta) {
                      handlePinToggle(selectedRow.pinKey, selectedRow.row, activeMeta)
                    }
                  }}
                  onClose={() => setSelectedRow(null)}
                />
              ),
            },
            {
              id: 'selection',
              label: 'Selection',
              meta: pinnedRows.length ? String(pinnedRows.length) : undefined,
              content: (
                <PinnedPanel
                  pinned={pinnedRows}
                  onUnpin={key => setPinnedRows(prev => prev.filter(p => p.key !== key))}
                  onClear={() => setPinnedRows([])}
                  onExport={exportToTimeline}
                  onEdit={handlePinEdit}
                  onReset={handlePinReset}
                  exporting={exporting}
                />
              ),
            },
          ]}
        />
      )}
    >
      <div className="h-full flex flex-col overflow-hidden">

        {openTabs.length > 0 && (
          <div className="flex items-center gap-0 border-b border-hairline bg-panel/50 shrink-0 overflow-x-auto">
            {openTabs.map(tabId => {
              const f    = files.find(x => x.id === tabId)
              const name = f?.original_name ?? tabId
              const isActive = tabId === activeTab && !showOmni
              return (
                <button key={tabId} onClick={() => { setActiveTab(tabId); setOmniQuery(''); setOmniDebounced('') }}
                  className={`flex items-center gap-1.5 px-3 py-2.5 text-label border-r border-hairline shrink-0 transition-colors max-w-[200px] ${isActive ? 'bg-canvas text-fg border-t-2 border-t-accent/50' : 'text-fg-secondary hover:text-fg hover:bg-white/[0.03]'}`}>
                  <FileText size={11} className="shrink-0" />
                  <span className="truncate font-mono">{name}</span>
                  {f?.ez_label && <span className="text-label text-severity-low/60 border border-severity-low/20 px-1 rounded-control shrink-0">EZ</span>}
                  <span onClick={e => closeTab(tabId, e)}
                    className="ml-0.5 text-fg-secondary/30 hover:text-severity-critical transition-colors shrink-0">
                    <X size={10} />
                  </span>
                </button>
              )
            })}
          </div>
        )}

        {showOmni ? (
          <OmniSearchView caseId={caseId} query={omniDebounced} regex={omniRegex} onOpenFile={openFile} />
        ) : activeView ? (
          activeView
        ) : (
          <div className={`flex-1 flex flex-col items-center justify-center gap-4 transition-colors ${dragging ? 'bg-accent/5' : ''}`}>
            <Table2 size={48} className="text-fg-secondary/15" />
            <div className="text-center">
              <p className="text-fg/40 text-ui">Select a file from the sidebar</p>
              <p className="text-fg-secondary/30 text-label mt-1">or drop .csv / .json / .txt / .log files here to upload</p>
            </div>
            {dragging && (
              <div className="border-2 border-dashed border-accent/40 px-12 py-6 text-accent/60 text-ui">
                Drop files to upload (.csv, .json, .txt, .log)
              </div>
            )}
          </div>
        )}
      </div>
    </PageShell>
    </div>
  )
}
