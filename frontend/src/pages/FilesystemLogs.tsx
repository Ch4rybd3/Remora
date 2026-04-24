import { useState } from 'react'
import {
  HardDrive, Terminal, ChevronLeft, Menu,
  CheckCircle2, Info, TableProperties,
} from 'lucide-react'
import { useCurrentCase } from '../context/CurrentCaseContext'
import EvtxFileList from '../components/evtx/EvtxFileList'
import TimelineExplorer from '../components/evtx/TimelineExplorer'

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

// ── Windows tab ────────────────────────────────────────────────────────────────

function WindowsTab({ caseId }: { caseId: string }) {
  const [showPanel, setShowPanel]         = useState(true)
  const [selectedFileId, setSelectedFileId] = useState<string | null>(null)

  return (
    <div className="flex h-full overflow-hidden">
      {/* ── Left: File panel ───────────────────────────────────────────── */}
      {showPanel && (
        <div className="w-72 shrink-0 border-r border-white/5 bg-bg-secondary flex flex-col">
          {/* Panel header */}
          <div className="px-3 py-2.5 border-b border-white/5 flex items-center justify-between shrink-0">
            <span className="text-[10px] font-semibold tracking-widest uppercase text-accent-muted/50">
              EVTX Files
            </span>
            <button
              onClick={() => setShowPanel(false)}
              className="p-1 rounded text-accent-muted/30 hover:text-white hover:bg-white/5 transition-colors"
              title="Collapse panel"
            >
              <ChevronLeft size={12} />
            </button>
          </div>

          {/* File list */}
          <div className="flex-1 overflow-y-auto p-3">
            <EvtxFileList
              caseId={caseId}
              selectedFileId={selectedFileId}
              onSelectFile={setSelectedFileId}
            />
          </div>
        </div>
      )}

      {/* ── Main: Timeline Explorer ─────────────────────────────────────── */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Mini toolbar */}
        <div className="flex items-center gap-2 px-3 py-1.5 border-b border-white/5 shrink-0 bg-bg-secondary/50">
          {!showPanel && (
            <button
              onClick={() => setShowPanel(true)}
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
        </div>

        {/* Content */}
        <div className="flex-1 overflow-hidden">
          {selectedFileId ? (
            <TimelineExplorer caseId={caseId} fileId={selectedFileId} />
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

type OsTab = 'windows' | 'linux'

export default function FilesystemLogs() {
  const { currentCase } = useCurrentCase()
  const [tab, setTab] = useState<OsTab>('windows')

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* ── Page header ─────────────────────────────────────────────────── */}
      <div className="shrink-0 border-b border-white/5 bg-bg-secondary/50">
        {/* Title row */}
        <div className="flex items-center gap-3 px-5 pt-4 pb-3">
          <HardDrive size={16} className="text-accent-green" />
          <div>
            <h1 className="text-base font-bold text-white leading-tight">
              Filesystem &amp; Logs
            </h1>
            <p className="text-[11px] text-accent-muted/50 mt-0.5">
              Parse and explore Windows event logs (.evtx) and system artifacts
            </p>
          </div>

          {/* Case indicator */}
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
          <TabBtn
            active={tab === 'windows'}
            onClick={() => setTab('windows')}
            icon={HardDrive}
            label="Windows"
          />
          <TabBtn
            active={tab === 'linux'}
            onClick={() => setTab('linux')}
            icon={Terminal}
            label="Linux"
          />
        </div>
      </div>

      {/* ── No case guard ────────────────────────────────────────────────── */}
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
          {tab === 'windows' && <WindowsTab caseId={currentCase.id} />}
          {tab === 'linux'   && <LinuxTab />}
        </div>
      )}
    </div>
  )
}
