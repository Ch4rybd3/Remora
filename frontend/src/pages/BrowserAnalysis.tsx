import { useState, useCallback, useMemo } from 'react'
import { Globe, BookmarkPlus, ChevronLeft, ChevronRight, Menu } from 'lucide-react'
import { useCurrentCase } from '../context/CurrentCaseContext'
import BrowserFileList from '../components/browser/BrowserFileList'
import BrowserExplorer from '../components/browser/BrowserExplorer'
import BrowserSelectionPanel from '../components/browser/BrowserSelectionPanel'
import type { BrowserFile, BrowserEntry, PinnedBrowserEntry } from '../api/browser'

export default function BrowserAnalysis() {
  const { currentCase } = useCurrentCase()

  const [showFilePanel,      setShowFilePanel]      = useState(true)
  const [showSelectionPanel, setShowSelectionPanel] = useState(false)
  const [selectedFile,       setSelectedFile]       = useState<BrowserFile | null>(null)

  // ── Pinned events (client-side only) ─────────────────────────────────────────
  const [pinnedEvents, setPinnedEvents] = useState<PinnedBrowserEntry[]>([])
  const [sentKeys,     setSentKeys]     = useState<Set<string>>(new Set())

  const pinnedIds = useMemo(
    () => new Set(pinnedEvents.map(e => e._key)),
    [pinnedEvents],
  )

  const handlePin = useCallback((entry: BrowserEntry) => {
    if (!selectedFile) return
    const key = `${selectedFile.id}:${entry.row_num}`
    setPinnedEvents(prev => {
      if (prev.some(e => e._key === key)) return prev
      const pinned: PinnedBrowserEntry = {
        ...entry,
        _key:      key,
        _fileId:   selectedFile.id,
        _filename: selectedFile.filename,
      }
      return [...prev, pinned]
    })
    setShowSelectionPanel(true)
  }, [selectedFile])

  const handleUnpin = useCallback((key: string) => {
    setPinnedEvents(prev => prev.filter(e => e._key !== key))
    setSentKeys(prev => { const s = new Set(prev); s.delete(key); return s })
  }, [])

  const handleClear = useCallback(() => {
    setPinnedEvents([])
    setSentKeys(new Set())
    setShowSelectionPanel(false)
  }, [])

  const handleSent = useCallback((key: string) => {
    setSentKeys(prev => new Set([...prev, key]))
  }, [])

  // ── No case ───────────────────────────────────────────────────────────────────
  if (!currentCase) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center space-y-2">
          <div className="text-5xl opacity-10">🌐</div>
          <p className="text-sm text-accent-muted/50">No current case selected</p>
          <p className="text-xs text-accent-muted/30">
            Set a current case from the top bar to upload and analyse browser artifacts
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full overflow-hidden">

      {/* ── Left: file list ───────────────────────────────────────────── */}
      {showFilePanel && (
        <div className="w-64 shrink-0 border-r border-white/5 bg-bg-secondary flex flex-col">
          <div className="px-3 py-2.5 border-b border-white/5 flex items-center justify-between shrink-0">
            <span className="text-[10px] font-semibold tracking-widest uppercase text-accent-muted/50">
              Browser Files
            </span>
            <button
              onClick={() => setShowFilePanel(false)}
              className="p-1 rounded text-accent-muted/30 hover:text-white hover:bg-white/5 transition-colors"
              title="Collapse"
            >
              <ChevronLeft size={13} />
            </button>
          </div>
          <div className="flex-1 overflow-hidden">
            <BrowserFileList
              caseId={currentCase.id}
              selectedFileId={selectedFile?.id ?? null}
              onSelectFile={setSelectedFile}
            />
          </div>
        </div>
      )}

      {/* ── Centre: explorer ──────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col overflow-hidden bg-bg-primary min-w-0">

        {/* Header bar */}
        <div className="flex items-center gap-2 px-4 py-2 border-b border-white/5 shrink-0 bg-bg-secondary/50">
          {/* Expand file panel */}
          {!showFilePanel && (
            <button
              onClick={() => setShowFilePanel(true)}
              className="p-1 rounded text-accent-muted/30 hover:text-white hover:bg-white/5 transition-colors mr-1"
              title="Show file list"
            >
              <Menu size={13} />
            </button>
          )}

          <Globe size={13} className="text-accent-muted/40 shrink-0" />
          <span className="text-[10px] font-semibold tracking-widest uppercase text-accent-muted/40">
            Browser Analysis
          </span>

          {selectedFile && (
            <>
              <span className="text-accent-muted/20 text-xs">·</span>
              <span className="text-[10px] font-mono text-white/50 truncate">
                {selectedFile.filename}
              </span>
              {selectedFile.entry_count != null && (
                <span className="text-[9px] text-accent-green/60 ml-1 shrink-0">
                  {selectedFile.entry_count.toLocaleString()} entries
                </span>
              )}
            </>
          )}

          {/* Right: toggle selection panel */}
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
            {pinnedEvents.length > 0 && (
              <span className={`font-mono ${showSelectionPanel ? 'text-accent-green' : 'text-white/50'}`}>
                {pinnedEvents.length}
              </span>
            )}
          </button>
        </div>

        {/* Explorer or empty state */}
        <div className="flex-1 overflow-hidden">
          {selectedFile ? (
            <BrowserExplorer
              caseId={currentCase.id}
              file={selectedFile}
              pinnedIds={pinnedIds}
              onPin={handlePin}
              onUnpin={handleUnpin}
            />
          ) : (
            <div className="flex h-full items-center justify-center">
              <div className="text-center space-y-2">
                <div className="text-5xl opacity-10">🌐</div>
                <p className="text-sm text-accent-muted/50">Select a browser CSV to explore</p>
                <p className="text-xs text-accent-muted/30 max-w-xs">
                  Upload a <span className="font-mono">WebX</span> CSV export in the left panel —
                  History, Downloads, Extensions, Cookies and more
                </p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Right: selection / timeline sidebar ──────────────────────── */}
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
            <BrowserSelectionPanel
              events={pinnedEvents}
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
