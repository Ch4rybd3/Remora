import { useNavigate } from 'react-router-dom'
import { FolderOpen, X, ChevronRight } from 'lucide-react'
import { useCurrentCase } from '../../context/CurrentCaseContext'

export default function TopBar() {
  const { currentCase, clearCurrentCase } = useCurrentCase()
  const navigate = useNavigate()

  if (!currentCase) return null

  return (
    <div className="h-9 border-b border-white/5 bg-bg-secondary/60 backdrop-blur-sm px-4 flex items-center justify-between shrink-0">
      {/* Left — breadcrumb hint */}
      <div className="flex items-center gap-1.5 text-[11px] text-accent-muted/50">
        <span>Current case</span>
        <ChevronRight size={10} />
      </div>

      {/* Center — case pill */}
      <button
        onClick={() => navigate(`/cases/${currentCase.id}`)}
        className="flex items-center gap-2 px-3 py-1 rounded-full border border-accent-green/25
                   bg-accent-green/5 hover:bg-accent-green/10 hover:border-accent-green/50
                   text-accent-green text-xs font-medium transition-all group max-w-xs"
      >
        <FolderOpen size={12} className="shrink-0" />
        <span className="truncate">{currentCase.title}</span>
      </button>

      {/* Right — clear */}
      <button
        onClick={clearCurrentCase}
        title="Quitter ce case"
        className="text-accent-muted/40 hover:text-accent-muted transition-colors p-1 rounded"
      >
        <X size={12} />
      </button>
    </div>
  )
}
