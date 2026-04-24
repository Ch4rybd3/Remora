import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { FileText, GitBranch, ChevronLeft, Menu } from 'lucide-react'
import { knowledgeApi } from '../api/knowledge'
import FileTree from '../components/knowledge/FileTree'
import NoteEditor from '../components/knowledge/NoteEditor'
import NoteGraph from '../components/knowledge/NoteGraph'

export default function KnowledgeBase() {
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [showTree, setShowTree] = useState(true)
  const [showGraph, setShowGraph] = useState(true)

  const { data: tree = [] } = useQuery({
    queryKey: ['knowledge-tree'],
    queryFn: knowledgeApi.tree,
  })

  // Navigate to a note by wikilink name
  const handleWikilinkNavigate = (path: string) => {
    setSelectedPath(path)
  }

  // When graph node is clicked, find corresponding file
  const handleGraphNodeClick = (path: string) => {
    setSelectedPath(path)
  }

  return (
    <div className="flex h-full overflow-hidden">
      {/* ── Left: File Tree ─────────────────────────────────────────────── */}
      {showTree && (
        <div className="w-56 shrink-0 border-r border-white/5 bg-bg-secondary flex flex-col">
          <FileTree nodes={tree} selected={selectedPath} onSelect={setSelectedPath} />
        </div>
      )}

      {/* ── Center: Editor ──────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col overflow-hidden bg-bg-primary">
        {/* Mini toolbar */}
        <div className="flex items-center gap-2 px-3 py-1.5 border-b border-white/5 shrink-0 bg-bg-secondary/50">
          <button
            onClick={() => setShowTree(t => !t)}
            title={showTree ? 'Hide file tree' : 'Show file tree'}
            className="p-1 rounded text-accent-muted/40 hover:text-white hover:bg-white/5 transition-colors"
          >
            {showTree ? <ChevronLeft size={13} /> : <Menu size={13} />}
          </button>
          <div className="flex items-center gap-1.5 text-accent-muted/30">
            <FileText size={12} />
            <span className="text-[10px] font-semibold tracking-widest uppercase">Knowledge Base</span>
          </div>
          <div className="flex-1" />
          <button
            onClick={() => setShowGraph(g => !g)}
            title={showGraph ? 'Hide graph' : 'Show graph'}
            className={`p-1 rounded transition-colors text-[10px] flex items-center gap-1 ${
              showGraph ? 'text-accent-green bg-accent-green/5' : 'text-accent-muted/40 hover:text-white hover:bg-white/5'
            }`}
          >
            <GitBranch size={12} />
            <span>Graph</span>
          </button>
        </div>

        {/* Editor fills remaining space */}
        <div className="flex-1 overflow-hidden">
          <NoteEditor
            path={selectedPath}
            onNodeNavigate={handleWikilinkNavigate}
          />
        </div>
      </div>

      {/* ── Right: Graph ─────────────────────────────────────────────────── */}
      {showGraph && (
        <div className="w-80 shrink-0 border-l border-white/5 bg-bg-secondary flex flex-col">
          {/* Graph header */}
          <div className="px-3 py-2 border-b border-white/5 shrink-0">
            <span className="text-[10px] font-semibold tracking-widest uppercase text-accent-muted/40">
              Note Graph
            </span>
            {selectedPath && (
              <span className="ml-2 text-[10px] text-accent-muted/30 truncate">
                — {selectedPath.split('/').pop()?.replace('.md', '')}
              </span>
            )}
          </div>
          <div className="flex-1 overflow-hidden">
            <NoteGraph
              currentPath={selectedPath}
              onNodeClick={handleGraphNodeClick}
            />
          </div>
        </div>
      )}
    </div>
  )
}
