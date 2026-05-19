import { useState, useCallback, useMemo } from 'react'
import { Activity, BookmarkPlus, ChevronLeft, ChevronRight, Menu } from 'lucide-react'
import { useCurrentCase } from '../context/CurrentCaseContext'
import PrefetchFileList from '../components/prefetch/PrefetchFileList'
import PrefetchExplorer from '../components/prefetch/PrefetchExplorer'
import PrefetchSelectionPanel from '../components/prefetch/PrefetchSelectionPanel'
import type { PrefetchFile, PrefetchEntry, PinnedPrefetchEntry } from '../api/prefetch'

export default function PrefetchAnalysis() {
  const { currentCase } = useCurrentCase()

  const [showFilePanel,      setShowFilePanel]      = useState(true)
  const [showSelectionPanel, setShowSelectionPanel] = useState(false)
  const [selectedFile,       setSelectedFile]       = useState<PrefetchFile | null>(null)

  // ── Pinned entries (client-side) ─────────────────────────────────────────────
  const [pinnedEntries, setPinnedEntries] = useState<PinnedPrefetchEntry[]>([])
  const [sentKeys,      setSentKeys]      = useState<Set<string>>(new Set())

  const pinnedIds = useMemo(
    () => new Set(pinnedEntries.map(e => e._key)),
    [pinnedEntries],
  )

  const handlePin = useCallback((entry: PrefetchEntry) => {
    if (!selectedFile) return
    const key = `${selectedFile.id}:${entry.row_num}`
    setPinnedEntries(prev => {
      if (prev.some(e => e._key === key)) return prev
      const pinned: PinnedPrefetchEntry = {
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

  // ── No case ───────────────────────────────────────────────────────────────────
  if (!currentCase) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center space-y-2">
          <div className="text-5xl opacity-10">⚡</div>
          <p className="text-sm text-accent-muted/50">No current case selected</p>
          <p className="text-xs text-accent-muted/30">
            Set a current case from the top bar to upload and analyse Prefetch artifacts
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
              Prefetch Files
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
            <PrefetchFileList
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
          {!showFilePanel && (
            <button
              onClick={() => setShowFilePanel(true)}
              className="p-1 rounded text-accent-muted/30 hover:text-white hover:bg-white/5 transition-colors mr-1"
              title="Show file list"
            >
              <Menu size={13} />
            </button>
          )}

          <Activity size={13} className="text-accent-muted/40 shrink-0" />
          <span className="text-[10px] font-semibold tracking-widest uppercase text-accent-muted/40">
            Prefetch Analysis
          </span>

          {selectedFile && (
            <>
              <span className="text-accent-muted/20 text-xs">·</span>
              <span className="text-[10px] font-mono text-white/50 truncate">
                {selectedFile.filename}
              </span>
              {selectedFile.entry_count != null && (
                <span className="text-[9px] text-accent-green/60 ml-1 shrink-0">
                  {selectedFile.entry_count.toLocaleString()} executables
                </span>
              )}
            </>
          )}

          {/* Toggle selection panel */}
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

        {/* Explorer or empty state */}
        <div className="flex-1 overflow-hidden">
          {selectedFile ? (
            <PrefetchExplorer
              caseId={currentCase.id}
              file={selectedFile}
              pinnedIds={pinnedIds}
              onPin={handlePin}
              onUnpin={handleUnpin}
            />
          ) : (
            <div className="flex h-full items-center justify-center">
              <div className="text-center space-y-2">
                <div className="text-5xl opacity-10">⚡</div>
                <p className="text-sm text-accent-muted/50">Select a Prefetch CSV to explore</p>
                <p className="text-xs text-accent-muted/30 max-w-xs">
                  Export with{' '}
                  <span className="font-mono">
                    PECmd.exe -d "C:\Windows\Prefetch" --csv out --csvf prefetch.csv
                  </span>{' '}
                  then upload the CSV in the left panel
                </p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Right: selection panel ────────────────────────────────────── */}
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
            <PrefetchSelectionPanel
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
