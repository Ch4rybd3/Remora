import { useState } from 'react'
import { Lock } from 'lucide-react'
import { useCurrentCase } from '../context/CurrentCaseContext'
import BinaryFileList from '../components/binary/BinaryFileList'
import BinaryExplorer from '../components/binary/BinaryExplorer'
import type { BinaryFile } from '../api/binary'

export default function BinaryAnalysis() {
  const { currentCase } = useCurrentCase()
  const [selectedFile, setSelectedFile] = useState<BinaryFile | null>(null)

  if (!currentCase) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center space-y-2">
          <div className="text-5xl opacity-10">🔬</div>
          <p className="text-sm text-accent-muted/50">No current case selected</p>
          <p className="text-xs text-accent-muted/30">
            Set a current case from the top bar to upload and analyse binary files
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full overflow-hidden">

      {/* ── Left panel ──────────────────────────────────────────────── */}
      <div className="w-64 shrink-0 border-r border-white/5 bg-bg-secondary flex flex-col">
        <div className="px-3 py-2.5 border-b border-white/5 shrink-0 flex items-center gap-2">
          <Lock size={11} className="text-accent-muted/40" />
          <span className="text-[10px] font-semibold tracking-widest uppercase text-accent-muted/50">
            Binary Files
          </span>
        </div>
        <div className="flex-1 overflow-hidden">
          <BinaryFileList
            caseId={currentCase.id}
            selectedFileId={selectedFile?.id ?? null}
            onSelectFile={f => setSelectedFile(f)}
          />
        </div>
      </div>

      {/* ── Right: explorer ───────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col overflow-hidden bg-bg-primary min-w-0">
        {selectedFile ? (
          <BinaryExplorer
            caseId={currentCase.id}
            file={selectedFile}
            onFileUpdate={f => setSelectedFile(f)}
          />
        ) : (
          <div className="flex h-full items-center justify-center">
            <div className="text-center space-y-2">
              <div className="text-5xl opacity-10">🔬</div>
              <p className="text-sm text-accent-muted/50">Select a binary file to analyse</p>
              <p className="text-xs text-accent-muted/30 max-w-xs">
                Upload a PE · ELF · Mach-O binary in the left panel.
                Files are encrypted at rest and never executed server-side.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
