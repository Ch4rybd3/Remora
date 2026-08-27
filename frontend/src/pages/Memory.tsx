import { useState } from 'react'
import {
  Cpu, ChevronLeft, Menu, CheckCircle2, Info, List, Terminal,
} from '../ui/icons'
import { useCurrentCase } from '../context/CurrentCaseContext'
import MemoryDumpList from '../components/memory/MemoryDumpList'
import DefaultPluginsTab from '../components/memory/DefaultPluginsTab'
import CustomCommandTab from '../components/memory/CustomCommandTab'
import type { MemoryDump } from '../api/memory'

// ── Inner tab button ───────────────────────────────────────────────────────────

function TabBtn({
  active, onClick, icon: Icon, label,
}: {
  active: boolean; onClick: () => void
  icon: React.ElementType; label: string
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 px-4 py-2.5 text-ui border-b-2 transition-colors ${ active
          ? 'border-accent text-accent'
          : 'border-transparent text-fg-secondary hover:text-fg'
      }`}
    >
      <Icon size={14} />
      {label}
    </button>
  )
}

// ── Dump analysis view (right of panel) ───────────────────────────────────────

type AnalysisTab = 'default' | 'custom'

function DumpAnalysis({ dump, caseId }: { dump: MemoryDump; caseId: string }) {
  const [tab, setTab] = useState<AnalysisTab>('default')

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Dump info bar */}
      <div className="shrink-0 px-4 py-2.5 border-b border-hairline bg-panel/50 flex items-center gap-3">
        <Cpu size={13} className="text-fg-secondary/50 shrink-0" />
        <div className="flex-1 min-w-0">
          <span className="text-label font-medium text-fg truncate block">{dump.filename}</span>
          <span className="text-label text-fg-secondary/40 font-mono capitalize">{dump.os_type}</span>
        </div>
        <span className={`text-label font-mono px-1.5 py-0.5 rounded-control border ${ dump.status === 'done'      ? 'text-accent border-accent/30 bg-accent/8' :
          dump.status === 'analyzing' ? 'text-severity-medium border-severity-medium/30 bg-severity-medium/8' :
          dump.status === 'error'     ? 'text-severity-critical border-severity-critical/30 bg-severity-critical/8' :
          'text-fg-secondary border-hairline'
        }`}>
          {dump.status}
        </span>
      </div>

      {/* Analysis tabs */}
      <div className="shrink-0 border-b border-hairline flex items-end px-4">
        <TabBtn active={tab === 'default'} onClick={() => setTab('default')} icon={List}     label="Default Plugins" />
        <TabBtn active={tab === 'custom'}  onClick={() => setTab('custom')}  icon={Terminal} label="Custom Command"   />
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-auto p-4">
        {tab === 'default' && <DefaultPluginsTab caseId={caseId} dumpId={dump.id} />}
        {tab === 'custom'  && (
          <CustomCommandTab caseId={caseId} dumpId={dump.id} osType={dump.os_type} />
        )}
      </div>
    </div>
  )
}

// ── Empty state ────────────────────────────────────────────────────────────────

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-3 text-center px-8">
      <div className="text-title opacity-10">🧠</div>
      <p className="text-ui text-fg-secondary/50">Select a memory dump to analyse</p>
      <p className="text-label text-fg-secondary/30">
        Upload a dump in the left panel — default Volatility3 plugins will run automatically
      </p>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function Memory() {
  const { currentCase } = useCurrentCase()
  const [showPanel,    setShowPanel]    = useState(true)
  const [selectedDump, setSelectedDump] = useState<MemoryDump | null>(null)

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* ── Page header ─────────────────────────────────────────────────── */}
      <div className="shrink-0 border-b border-hairline bg-panel/50 px-5 py-4 flex items-center gap-3">
        <Cpu size={16} className="text-accent" />
        <div>
          <h1 className="text-prose font-bold text-fg leading-tight">Memory Analysis</h1>
          <p className="text-label text-fg-secondary/50 mt-0.5">
            Upload memory dumps and run Volatility3 analysis
          </p>
        </div>
        <div className="ml-auto">
          {currentCase ? (
            <div className="flex items-center gap-1.5 text-label text-accent/70 bg-accent/5 border border-accent/15 rounded-control px-2.5 py-1.5">
              <CheckCircle2 size={11} />
              <span className="font-medium">{currentCase.title}</span>
            </div>
          ) : (
            <div className="flex items-center gap-1.5 text-label text-fg-secondary/50 bg-white/[0.02] border border-hairline rounded-control px-2.5 py-1.5">
              <Info size={11} />
              No case selected
            </div>
          )}
        </div>
      </div>

      {/* ── No case guard ────────────────────────────────────────────────── */}
      {!currentCase ? (
        <div className="flex-1 flex items-center justify-center flex-col gap-3 text-center px-8">
          <div className="text-title opacity-10">🗂️</div>
          <p className="text-ui text-fg-secondary/50">No current case selected</p>
          <p className="text-label text-fg-secondary/30">
            Set a current case from the top bar or the Cases page to upload memory dumps
          </p>
        </div>
      ) : (
        <div className="flex flex-1 overflow-hidden">
          {/* ── Left: dump list panel ──────────────────────────────────── */}
          {showPanel && (
            <div className="w-72 shrink-0 border-r border-hairline bg-panel flex flex-col">
              <div className="px-3 py-2.5 border-b border-hairline flex items-center justify-between shrink-0">
                <span className="text-label font-semibold tracking-widest uppercase text-fg-secondary/50">
                  Memory Dumps
                </span>
                <button
                  onClick={() => setShowPanel(false)}
                  className="p-1 rounded-control text-fg-secondary/30 hover:text-fg hover:bg-fg/5 transition-colors"
                  title="Collapse panel"
                >
                  <ChevronLeft size={12} />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto p-3">
                <MemoryDumpList
                  caseId={currentCase.id}
                  selectedDumpId={selectedDump?.id ?? null}
                  onSelect={setSelectedDump}
                />
              </div>
            </div>
          )}

          {/* ── Main: analysis area ────────────────────────────────────── */}
          <div className="flex-1 flex flex-col overflow-hidden">
            {!showPanel && (
              <div className="shrink-0 flex items-center gap-2 px-3 py-1.5 border-b border-hairline bg-panel/50">
                <button
                  onClick={() => setShowPanel(true)}
                  className="p-1 rounded-control text-fg-secondary/40 hover:text-fg hover:bg-fg/5 transition-colors"
                  title="Show dump panel"
                >
                  <Menu size={13} />
                </button>
                <Cpu size={12} className="text-fg-secondary/30" />
                <span className="text-label font-semibold tracking-widest uppercase text-fg-secondary/30">
                  Memory Analysis
                </span>
              </div>
            )}

            <div className="flex-1 overflow-hidden">
              {selectedDump
                ? <DumpAnalysis dump={selectedDump} caseId={currentCase.id} />
                : <EmptyState />
              }
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
