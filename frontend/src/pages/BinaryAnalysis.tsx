import { useState } from 'react'
import { PageShell } from '../ui/PageShell'
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
    <PageShell
      route="/artifacts/binary"
      title="Binary Analysis"
      subtitle={currentCase.title}
      fullHeight
      asideLeft={(
        <aside className="w-64 shrink-0 border-r border-hairline bg-panel flex flex-col min-h-0">
          <div className="px-3 py-2 border-b border-hairline shrink-0 flex items-center gap-2">
            <Lock size={11} className="text-fg-muted" />
            <span className="text-label font-mono uppercase tracking-label text-fg-muted">
              Binary files
            </span>
          </div>
          <div className="flex-1 min-h-0 overflow-hidden">
            <BinaryFileList
              caseId={currentCase.id}
              selectedFileId={selectedFile?.id ?? null}
              onSelectFile={(f) => setSelectedFile(f)}
            />
          </div>
        </aside>
      )}
    >
      <div className="h-full flex flex-col overflow-hidden min-w-0">
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
    </PageShell>
  )
}
