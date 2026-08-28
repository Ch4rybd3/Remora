import { useState } from 'react'
import { PageHelp } from '../help/pageHelp'
import { Lock } from '../ui/icons'
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
          <div className="text-title opacity-10">🔬</div>
          <p className="text-ui text-fg-secondary/50">No current case selected</p>
          <p className="text-label text-fg-secondary/30">
            Set a current case from the top bar to upload and analyse binary files
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full overflow-hidden">

      {/* ── Left panel ──────────────────────────────────────────────── */}
      <div className="w-64 shrink-0 border-r border-hairline bg-panel flex flex-col">
        <div className="px-3 py-2.5 border-b border-hairline shrink-0 flex items-center gap-2">
          <Lock size={11} className="text-fg-secondary/40" />
          <span className="text-label font-semibold tracking-widest uppercase text-fg-secondary/50">
            Binary Files
          </span>
          <span className="ml-auto"><PageHelp route="/artifacts/binary" /></span>
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
      <div className="flex-1 flex flex-col overflow-hidden bg-canvas min-w-0">
        {selectedFile ? (
          <BinaryExplorer
            caseId={currentCase.id}
            file={selectedFile}
            onFileUpdate={f => setSelectedFile(f)}
          />
        ) : (
          <div className="flex h-full items-center justify-center">
            <div className="text-center space-y-2">
              <div className="text-title opacity-10">🔬</div>
              <p className="text-ui text-fg-secondary/50">Select a binary file to analyse</p>
              <p className="text-label text-fg-secondary/30 max-w-xs">
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
