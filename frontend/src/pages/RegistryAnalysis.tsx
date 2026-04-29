import { useState, useCallback, useMemo } from 'react'
import { KeyRound, BookmarkPlus, ChevronRight } from 'lucide-react'
import { useCurrentCase } from '../context/CurrentCaseContext'
import RegistryFileList from '../components/registry/RegistryFileList'
import RegistryExplorer from '../components/registry/RegistryExplorer'
import RegistrySelectionPanel from '../components/registry/RegistrySelectionPanel'
import type { RegistryFile, RegistryEntry, PinnedRegistryEntry } from '../api/registry'

export default function RegistryAnalysis() {
  const { currentCase } = useCurrentCase()

  const [selectedFile,      setSelectedFile]      = useState<RegistryFile | null>(null)
  const [showSelectionPanel, setShowSelectionPanel] = useState(false)
  const [pinnedEntries,     setPinnedEntries]      = useState<PinnedRegistryEntry[]>([])
  const [sentKeys,          setSentKeys]           = useState<Set<string>>(new Set())

  const pinnedIds = useMemo(
    () => new Set(pinnedEntries.map(e => e._key)),
    [pinnedEntries],
  )

  const handlePin = useCallback((entry: RegistryEntry, rowNum: number) => {
    if (!selectedFile) return
    const key = `${selectedFile.id}:reg:${rowNum}`
    setPinnedEntries(prev => {
      if (prev.some(e => e._key === key)) return prev
      const pinned: PinnedRegistryEntry = {
        ...entry,
        _key:        key,
        _fileId:     selectedFile.id,
        _filename:   selectedFile.filename,
        _sourceType: 'registry',
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

  // ── No case ──────────────────────────────────────────────────────────────────
  if (!currentCase) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center space-y-2">
          <div className="text-5xl opacity-10">🗝️</div>
          <p className="text-sm text-accent-muted/50">No current case selected</p>
          <p className="text-xs text-accent-muted/30">
            Set a current case to upload and analyse registry exports
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full overflow-hidden">

      {/* ── Left panel: file list ─────────────────────────────────────── */}
      <div className="w-64 shrink-0 border-r border-white/5 bg-bg-secondary flex flex-col">
        <div className="px-3 py-2.5 border-b border-white/5 shrink-0 flex items-center gap-2">
          <KeyRound size={11} className="text-accent-muted/40" />
          <span className="text-[10px] font-semibold tracking-widest uppercase text-accent-muted/50">
            Registry Files
          </span>
        </div>
        <div className="flex-1 overflow-hidden">
          <RegistryFileList
            caseId={currentCase.id}
            selectedFileId={selectedFile?.id ?? null}
            onSelectFile={setSelectedFile}
          />
        </div>
      </div>

      {/* ── Centre: explorer ──────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col overflow-hidden bg-bg-primary min-w-0">

        {/* Mini header */}
        <div className="flex items-center gap-2 px-4 py-2 border-b border-white/5 shrink-0 bg-bg-secondary/50">
          <KeyRound size={13} className="text-accent-muted/40" />
          <span className="text-[10px] font-semibold tracking-widest uppercase text-accent-muted/40">
            Registry Analysis
          </span>

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
          {selectedFile ? (
            <RegistryExplorer
              caseId={currentCase.id}
              file={selectedFile}
              pinnedIds={pinnedIds}
              onPin={handlePin}
              onUnpin={handleUnpin}
            />
          ) : (
            <div className="flex h-full items-center justify-center">
              <div className="text-center space-y-2">
                <div className="text-5xl opacity-10">🗝️</div>
                <p className="text-sm text-accent-muted/50">Select a registry file to explore</p>
                <p className="text-xs text-accent-muted/30 max-w-xs">
                  Upload a <span className="font-mono">RECmd</span> or{' '}
                  <span className="font-mono">Registry Explorer</span> CSV export in the left panel,
                  wait for parsing, then click it to open the explorer
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
            <RegistrySelectionPanel
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
