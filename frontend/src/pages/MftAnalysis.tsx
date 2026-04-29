import { useState, useCallback, useMemo } from 'react'
import { Database, BookmarkPlus, ChevronRight } from 'lucide-react'
import { useCurrentCase } from '../context/CurrentCaseContext'
import MftFileList from '../components/mft/MftFileList'
import MftExplorer from '../components/mft/MftExplorer'
import UsnFileList from '../components/usn/UsnFileList'
import UsnExplorer from '../components/usn/UsnExplorer'
import FsSelectionPanel, { type PinnedFsEntry } from '../components/mft/FsSelectionPanel'
import type { MftFile, MftEntry, PinnedMftEntry } from '../api/mft'
import type { UsnFile, UsnEntry, PinnedUsnEntry } from '../api/usn'

type Tab = 'mft' | 'usn'

export default function MftAnalysis() {
  const { currentCase } = useCurrentCase()

  const [activeTab,       setActiveTab]       = useState<Tab>('mft')
  const [selectedMftFile, setSelectedMftFile] = useState<MftFile | null>(null)
  const [selectedUsnFile, setSelectedUsnFile] = useState<UsnFile | null>(null)

  // ── Selection panel state ────────────────────────────────────────────────────
  const [showSelectionPanel, setShowSelectionPanel] = useState(false)
  const [pinnedEntries,      setPinnedEntries]      = useState<PinnedFsEntry[]>([])
  const [sentKeys,           setSentKeys]           = useState<Set<string>>(new Set())

  const pinnedIds = useMemo(
    () => new Set(pinnedEntries.map(e => e._key)),
    [pinnedEntries],
  )

  const handlePinMft = useCallback((entry: MftEntry) => {
    if (!selectedMftFile) return
    const key = `${selectedMftFile.id}:mft:${entry.entry_number}`
    setPinnedEntries(prev => {
      if (prev.some(e => e._key === key)) return prev
      const pinned: PinnedMftEntry = {
        ...entry,
        _key:        key,
        _fileId:     selectedMftFile.id,
        _filename:   selectedMftFile.filename,
        _sourceType: 'mft',
      }
      return [...prev, pinned]
    })
    setShowSelectionPanel(true)
  }, [selectedMftFile])

  const handlePinUsn = useCallback((entry: UsnEntry, idx: number) => {
    if (!selectedUsnFile) return
    const key = `${selectedUsnFile.id}:usn:${idx}`
    setPinnedEntries(prev => {
      if (prev.some(e => e._key === key)) return prev
      const pinned: PinnedUsnEntry = {
        ...entry,
        _key:        key,
        _fileId:     selectedUsnFile.id,
        _filename:   selectedUsnFile.filename,
        _sourceType: 'usn',
        _idx:        idx,
      }
      return [...prev, pinned]
    })
    setShowSelectionPanel(true)
  }, [selectedUsnFile])

  const handleUnpin = useCallback((key: string) => {
    setPinnedEntries(prev => prev.filter(e => e._key !== key))
    setSentKeys(prev => { const s = new Set(prev); s.delete(key); return s })
  }, [])

  const handleClear = useCallback(() => {
    setPinnedEntries([])
    setSentKeys(new Set())
    setShowSelectionPanel(false)
  }, [])

  const handleSent = useCallback((key: string) => {
    setSentKeys(prev => new Set([...prev, key]))
  }, [])

  // ── No case ──────────────────────────────────────────────────────────────────
  if (!currentCase) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center space-y-2">
          <div className="text-5xl opacity-10">🗂️</div>
          <p className="text-sm text-accent-muted/50">No current case selected</p>
          <p className="text-xs text-accent-muted/30">
            Set a current case from the top bar or the Cases page to upload and analyse $MFT / $J files
          </p>
        </div>
      </div>
    )
  }

  const selectedFile = activeTab === 'mft' ? selectedMftFile : selectedUsnFile

  return (
    <div className="flex h-full overflow-hidden">

      {/* ── Left panel ──────────────────────────────────────────────── */}
      <div className="w-64 shrink-0 border-r border-white/5 bg-bg-secondary flex flex-col">

        {/* Tab switcher */}
        <div className="flex border-b border-white/5 shrink-0">
          <button
            onClick={() => setActiveTab('mft')}
            className={`flex-1 py-2 text-[10px] font-semibold tracking-widest uppercase transition-colors ${
              activeTab === 'mft'
                ? 'text-accent-green border-b-2 border-accent-green bg-accent-green/5'
                : 'text-accent-muted/40 hover:text-white/60 border-b-2 border-transparent'
            }`}
          >
            $MFT
          </button>
          <button
            onClick={() => setActiveTab('usn')}
            className={`flex-1 py-2 text-[10px] font-semibold tracking-widest uppercase transition-colors ${
              activeTab === 'usn'
                ? 'text-accent-green border-b-2 border-accent-green bg-accent-green/5'
                : 'text-accent-muted/40 hover:text-white/60 border-b-2 border-transparent'
            }`}
          >
            $J USN
          </button>
        </div>

        {/* File list for active tab */}
        <div className="flex-1 overflow-hidden">
          {activeTab === 'mft' ? (
            <MftFileList
              caseId={currentCase.id}
              selectedFileId={selectedMftFile?.id ?? null}
              onSelectFile={setSelectedMftFile}
            />
          ) : (
            <UsnFileList
              caseId={currentCase.id}
              selectedFileId={selectedUsnFile?.id ?? null}
              onSelectFile={setSelectedUsnFile}
            />
          )}
        </div>
      </div>

      {/* ── Centre: explorer ─────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col overflow-hidden bg-bg-primary min-w-0">

        {/* Mini header */}
        <div className="flex items-center gap-2 px-4 py-2 border-b border-white/5 shrink-0 bg-bg-secondary/50">
          <Database size={13} className="text-accent-muted/40" />
          <span className="text-[10px] font-semibold tracking-widest uppercase text-accent-muted/40">
            MFT / USN Analysis
          </span>
          {/* Tab pills */}
          <div className="flex items-center gap-1 ml-2">
            <span
              className={`text-[9px] px-2 py-0.5 rounded-full border cursor-pointer transition-colors ${
                activeTab === 'mft'
                  ? 'bg-accent-green/10 border-accent-green/30 text-accent-green'
                  : 'border-white/10 text-accent-muted/30 hover:text-white/50'
              }`}
              onClick={() => setActiveTab('mft')}
            >
              $MFT
            </span>
            <span
              className={`text-[9px] px-2 py-0.5 rounded-full border cursor-pointer transition-colors ${
                activeTab === 'usn'
                  ? 'bg-accent-green/10 border-accent-green/30 text-accent-green'
                  : 'border-white/10 text-accent-muted/30 hover:text-white/50'
              }`}
              onClick={() => setActiveTab('usn')}
            >
              $J USN
            </span>
          </div>

          {selectedFile && (
            <>
              <span className="text-accent-muted/20 text-xs">·</span>
              <span className="text-[10px] font-mono text-white/50">{selectedFile.filename}</span>
              {selectedFile.entry_count !== null && (
                <span className="text-[9px] text-accent-green/60 ml-1">
                  {selectedFile.entry_count.toLocaleString()} entries
                </span>
              )}
            </>
          )}

          {/* Bookmark toggle */}
          <button
            onClick={() => setShowSelectionPanel(v => !v)}
            className={`ml-auto flex items-center gap-1.5 px-2 py-1 rounded border text-[9px] transition-colors ${
              showSelectionPanel
                ? 'border-accent-green/30 text-accent-green bg-accent-green/10'
                : 'border-white/10 text-accent-muted/40 hover:text-white hover:border-white/20'
            }`}
            title="Toggle timeline selection panel"
          >
            <BookmarkPlus size={11} />
            {pinnedEntries.length > 0 && (
              <span className={`font-mono ${showSelectionPanel ? 'text-accent-green' : 'text-white/50'}`}>
                {pinnedEntries.length}
              </span>
            )}
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-hidden">
          {activeTab === 'mft' ? (
            selectedMftFile ? (
              <MftExplorer
                caseId={currentCase.id}
                fileId={selectedMftFile.id}
                filename={selectedMftFile.filename}
                pinnedIds={pinnedIds}
                onPin={handlePinMft}
                onUnpin={handleUnpin}
              />
            ) : (
              <EmptyState
                icon="🗃️"
                title="Select an $MFT file to explore entries"
                hint={<>Upload a <span className="font-mono">MFTECmd $MFT CSV</span> in the left panel, wait for parsing, then click it to open the explorer</>}
              />
            )
          ) : (
            selectedUsnFile ? (
              <UsnExplorer
                caseId={currentCase.id}
                fileId={selectedUsnFile.id}
                filename={selectedUsnFile.filename}
                pinnedIds={pinnedIds}
                onPin={handlePinUsn}
                onUnpin={handleUnpin}
              />
            ) : (
              <EmptyState
                icon="📋"
                title="Select a $J USN file to explore the journal"
                hint={<>Upload a <span className="font-mono">MFTECmd $J CSV</span> in the left panel, wait for parsing, then click it to open the explorer</>}
              />
            )
          )}
        </div>
      </div>

      {/* ── Right: selection panel ───────────────────────────────────── */}
      {showSelectionPanel && (
        <div className="w-72 shrink-0 border-l border-white/5 bg-bg-secondary flex flex-col">
          <div className="px-3 py-2.5 border-b border-white/5 flex items-center justify-between shrink-0">
            <span className="text-[10px] font-semibold tracking-widest uppercase text-accent-muted/50">
              Timeline Selection
            </span>
            <button
              onClick={() => setShowSelectionPanel(false)}
              className="p-1 rounded text-accent-muted/30 hover:text-white hover:bg-white/5 transition-colors"
              title="Collapse"
            >
              <ChevronRight size={13} />
            </button>
          </div>
          <div className="flex-1 overflow-hidden">
            <FsSelectionPanel
              entries={pinnedEntries}
              sentKeys={sentKeys}
              caseId={currentCase.id}
              onRemove={handleUnpin}
              onClear={handleClear}
              onSent={handleSent}
            />
          </div>
        </div>
      )}
    </div>
  )
}

// ── Empty state helper ────────────────────────────────────────────────────────

function EmptyState({ icon, title, hint }: { icon: string; title: string; hint: React.ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center">
      <div className="text-center space-y-2">
        <div className="text-5xl opacity-10">{icon}</div>
        <p className="text-sm text-accent-muted/50">{title}</p>
        <p className="text-xs text-accent-muted/30 max-w-xs">{hint}</p>
      </div>
    </div>
  )
}
