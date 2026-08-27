import { useState, useCallback, useMemo, useEffect, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  HardDrive, Terminal, ChevronLeft, ChevronRight, Menu,
  CheckCircle2, Info, TableProperties, BookmarkPlus, Swords,
} from '../ui/icons'
import { useCurrentCase } from '../context/CurrentCaseContext'
import EvtxFileList from '../components/evtx/EvtxFileList'
import TimelineExplorer from '../components/evtx/TimelineExplorer'
import EventSelectionPanel from '../components/evtx/EventSelectionPanel'
import ChainsawTab from '../components/evtx/ChainsawTab'
import { evtxApi, type EvtxEvent, type PinnedEvtxEvent } from '../api/evtx'

// ── Tab button ────────────────────────────────────────────────────────────────

function TabBtn({
  active, onClick, icon: Icon, label,
}: {
  active: boolean; onClick: () => void
  icon: React.ElementType; label: string
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 px-4 py-2.5 text-sm border-b-2 transition-colors ${
        active
          ? 'border-accent-green text-accent-green'
          : 'border-transparent text-accent-muted hover:text-white'
      }`}
    >
      <Icon size={14} />
      {label}
    </button>
  )
}

// ── Windows tab ───────────────────────────────────────────────────────────────

function WindowsTab({ caseId }: { caseId: string }) {
  const qc = useQueryClient()
  const [showFilePanel,  setShowFilePanel]  = useState(true)
  const [showPinPanel,   setShowPinPanel]   = useState(false)
  const [selectedFileId, setSelectedFileId] = useState<string | null>(null)

  // ── Local selection state (initialised from backend) ──────────────────────
  const [pinnedEvents, setPinnedEvents] = useState<PinnedEvtxEvent[]>([])
  const [sentIds,      setSentIds]      = useState<Set<number>>(new Set())
  const initialized = useRef(false)   // useRef so it doesn't trigger re-renders

  // Refs that always hold the latest values — used for flush-on-unmount
  const latestEvents  = useRef<PinnedEvtxEvent[]>([])
  const latestSentIds = useRef<Set<number>>(new Set())
  useEffect(() => { latestEvents.current  = pinnedEvents }, [pinnedEvents])
  useEffect(() => { latestSentIds.current = sentIds      }, [sentIds])

  // Load files list (to resolve filenames)
  const { data: files = [] } = useQuery({
    queryKey: ['evtx-files', caseId],
    queryFn:  () => evtxApi.listFiles(caseId),
  })

  // Filename for the currently selected file
  const selectedFilename = useMemo(
    () => files.find(f => f.id === selectedFileId)?.filename ?? '',
    [files, selectedFileId],
  )

  // ── Load persisted selection from backend ─────────────────────────────────
  // staleTime: 0 → always fetch fresh on mount (component remounts on tab switch)
  const { data: savedSelection } = useQuery({
    queryKey: ['evtx-selection', caseId],
    queryFn:  () => evtxApi.getSelection(caseId),
    staleTime: 0,
  })

  useEffect(() => {
    // Initialize from server data exactly once per mount
    if (savedSelection && !initialized.current) {
      initialized.current = true
      setPinnedEvents(savedSelection.events)
      setSentIds(new Set(savedSelection.sent_ids))
      if (savedSelection.events.length > 0) setShowPinPanel(true)
    }
  }, [savedSelection])

  // ── Auto-save selection to backend (debounced 600 ms) ────────────────────
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const save = useMutation({
    mutationFn: ({ events, ids }: { events: PinnedEvtxEvent[]; ids: number[] }) =>
      evtxApi.saveSelection(caseId, events, ids),
    // ← KEY FIX: keep the React Query cache in sync so the next mount reads
    //   the correct data instead of a stale empty snapshot.
    onSuccess: (data) => {
      qc.setQueryData(['evtx-selection', caseId], data)
    },
  })

  // Flush immediately on unmount so fast tab-switches don't lose data
  useEffect(() => {
    return () => {
      if (saveTimer.current) {
        clearTimeout(saveTimer.current)
        saveTimer.current = null
      }
      // Fire & forget — component is already unmounting
      evtxApi.saveSelection(
        caseId,
        latestEvents.current,
        [...latestSentIds.current],
      ).then(data => qc.setQueryData(['evtx-selection', caseId], data)).catch(() => {})
    }
   
  }, [caseId])   // run cleanup only when caseId changes or on unmount

  const scheduleSave = useCallback((events: PinnedEvtxEvent[], ids: Set<number>) => {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      save.mutate({ events, ids: [...ids] })
    }, 600)
  }, [save])

  // ── Pin / unpin / clear ───────────────────────────────────────────────────
  const pinnedIds = useMemo(() => new Set(pinnedEvents.map(e => e.id)), [pinnedEvents])

  const handlePin = useCallback((ev: EvtxEvent, filename: string) => {
    setPinnedEvents(prev => {
      if (prev.some(e => e.id === ev.id)) return prev
      const pinned: PinnedEvtxEvent = { ...ev, _filename: filename }
      const next = [...prev, pinned]
      scheduleSave(next, sentIds)
      return next
    })
    setShowPinPanel(true)
  }, [sentIds, scheduleSave])

  const handleRemovePin = useCallback((id: number) => {
    setPinnedEvents(prev => {
      const next = prev.filter(e => e.id !== id)
      setSentIds(s => {
        const ns = new Set(s)
        ns.delete(id)
        scheduleSave(next, ns)
        return ns
      })
      return next
    })
  }, [scheduleSave])

  const handleClearPins = useCallback(() => {
    setPinnedEvents([])
    setSentIds(new Set())
    scheduleSave([], new Set())
    setShowPinPanel(false)
  }, [scheduleSave])

  const handleSent = useCallback((id: number) => {
    setSentIds(prev => {
      const next = new Set(prev)
      next.add(id)
      // Save immediately (no debounce) so the sent_id is persisted before any
      // tab switch — this is what prevents duplicate pushes after remount.
      save.mutate({ events: latestEvents.current, ids: [...next] })
      return next
    })
  }, [save])

  return (
    <div className="flex h-full overflow-hidden">

      {/* ── Left: EVTX file list ──────────────────────────────────────── */}
      {showFilePanel && (
        <div className="w-72 shrink-0 border-r border-white/5 bg-bg-secondary flex flex-col">
          <div className="px-3 py-2.5 border-b border-white/5 flex items-center justify-between shrink-0">
            <span className="text-[10px] font-semibold tracking-widest uppercase text-accent-muted/50">
              EVTX Files
            </span>
            <button
              onClick={() => setShowFilePanel(false)}
              className="p-1 rounded text-accent-muted/30 hover:text-white hover:bg-white/5 transition-colors"
              title="Collapse panel"
            >
              <ChevronLeft size={12} />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-3">
            <EvtxFileList
              caseId={caseId}
              selectedFileId={selectedFileId}
              onSelectFile={setSelectedFileId}
            />
          </div>
        </div>
      )}

      {/* ── Center: Timeline Explorer ─────────────────────────────────── */}
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        {/* Toolbar */}
        <div className="flex items-center gap-2 px-3 py-1.5 border-b border-white/5 shrink-0 bg-bg-secondary/50">
          {!showFilePanel && (
            <button
              onClick={() => setShowFilePanel(true)}
              className="p-1 rounded text-accent-muted/40 hover:text-white hover:bg-white/5 transition-colors"
              title="Show file panel"
            >
              <Menu size={13} />
            </button>
          )}
          <TableProperties size={12} className="text-accent-muted/30" />
          <span className="text-[10px] font-semibold tracking-widest uppercase text-accent-muted/30">
            Timeline Explorer
          </span>

          {/* Selection panel toggle */}
          <button
            onClick={() => setShowPinPanel(v => !v)}
            className={`ml-auto flex items-center gap-1.5 px-2.5 py-1 rounded border text-[10px] transition-colors ${
              pinnedEvents.length > 0
                ? 'border-accent-green/30 text-accent-green bg-accent-green/5 hover:bg-accent-green/10'
                : 'border-white/8 text-accent-muted/40 hover:text-white hover:border-white/20'
            }`}
            title="Toggle event selection panel"
          >
            <BookmarkPlus size={11} />
            <span>Selection</span>
            {pinnedEvents.length > 0 && (
              <span className="bg-accent-green text-bg-primary text-[8px] font-bold rounded-full w-4 h-4 flex items-center justify-center leading-none">
                {pinnedEvents.length}
              </span>
            )}
            <ChevronRight
              size={10}
              className={`transition-transform duration-150 ${showPinPanel ? 'rotate-180' : ''}`}
            />
          </button>
        </div>

        {/* Explorer content */}
        <div className="flex-1 overflow-hidden">
          {selectedFileId ? (
            <TimelineExplorer
              caseId={caseId}
              fileId={selectedFileId}
              filename={selectedFilename}
              pinnedIds={pinnedIds}
              onPin={handlePin}
            />
          ) : (
            <div className="h-full flex flex-col items-center justify-center gap-3 text-center px-8">
              <div className="text-5xl opacity-10">📋</div>
              <p className="text-sm text-accent-muted/50">Select an EVTX file to explore events</p>
              <p className="text-xs text-accent-muted/30">
                Upload a <span className="font-mono">.evtx</span> file in the left panel, wait for parsing, then click it to open the timeline explorer
              </p>
            </div>
          )}
        </div>
      </div>

      {/* ── Right: Event selection panel ──────────────────────────────── */}
      {showPinPanel && (
        <div className="w-64 shrink-0 border-l border-white/5 bg-bg-secondary flex flex-col">
          <EventSelectionPanel
            events={pinnedEvents}
            sentIds={sentIds}
            caseId={caseId}
            onRemove={handleRemovePin}
            onClear={handleClearPins}
            onSent={handleSent}
          />
        </div>
      )}
    </div>
  )
}

// ── Linux placeholder ─────────────────────────────────────────────────────────

function LinuxTab() {
  return (
    <div className="flex h-full items-center justify-center flex-col gap-3 text-center px-8">
      <div className="text-5xl opacity-10">🐧</div>
      <p className="text-sm text-accent-muted/50">Linux artifact processing</p>
      <p className="text-xs text-accent-muted/30">Coming soon — syslog, auth.log, journal, auditd…</p>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

type OsTab = 'windows' | 'linux' | 'chainsaw'

export default function FilesystemLogs() {
  const { currentCase } = useCurrentCase()
  const [tab, setTab] = useState<OsTab>('windows')

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Page header */}
      <div className="shrink-0 border-b border-white/5 bg-bg-secondary/50">
        <div className="flex items-center gap-3 px-5 pt-4 pb-3">
          <HardDrive size={16} className="text-accent-green" />
          <div>
            <h1 className="text-base font-bold text-white leading-tight">
              Logs
            </h1>
            <p className="text-[11px] text-accent-muted/50 mt-0.5">
              Parse and explore Windows event logs (.evtx) and system artifacts
            </p>
          </div>
          <div className="ml-auto">
            {currentCase ? (
              <div className="flex items-center gap-1.5 text-[10px] text-accent-green/70 bg-accent-green/5 border border-accent-green/15 rounded-md px-2.5 py-1.5">
                <CheckCircle2 size={11} />
                <span className="font-medium">{currentCase.title}</span>
              </div>
            ) : (
              <div className="flex items-center gap-1.5 text-[10px] text-accent-muted/50 bg-white/[0.02] border border-white/8 rounded-md px-2.5 py-1.5">
                <Info size={11} />
                No case selected
              </div>
            )}
          </div>
        </div>

        {/* OS tabs */}
        <div className="flex items-end gap-0 px-5">
          <TabBtn active={tab === 'windows'}  onClick={() => setTab('windows')}  icon={HardDrive} label="Windows" />
          <TabBtn active={tab === 'linux'}    onClick={() => setTab('linux')}    icon={Terminal}  label="Linux"   />
          <TabBtn active={tab === 'chainsaw'} onClick={() => setTab('chainsaw')} icon={Swords}    label="Chainsaw" />
        </div>
      </div>

      {/* No case guard */}
      {!currentCase ? (
        <div className="flex-1 flex items-center justify-center flex-col gap-3 text-center px-8">
          <div className="text-5xl opacity-10">🗂️</div>
          <p className="text-sm text-accent-muted/50">No current case selected</p>
          <p className="text-xs text-accent-muted/30">
            Set a current case from the top bar or the Cases page to upload and analyse artifacts
          </p>
        </div>
      ) : (
        <div className="flex-1 overflow-hidden">
          {tab === 'windows'  && <WindowsTab   caseId={currentCase.id} />}
          {tab === 'linux'    && <LinuxTab />}
          {tab === 'chainsaw' && <ChainsawTab  caseId={currentCase.id} />}
        </div>
      )}
    </div>
  )
}
