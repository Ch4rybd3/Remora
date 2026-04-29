import { useState, useCallback } from 'react'
import { useQuery } from '@tanstack/react-query'
import { FileText, GitBranch, ChevronLeft, Menu } from 'lucide-react'
import { knowledgeApi } from '../api/knowledge'
import FileTree from '../components/knowledge/FileTree'
import NoteEditor, { type ScrollRequest } from '../components/knowledge/NoteEditor'
import NoteGraph from '../components/knowledge/NoteGraph'
import NoteTOC from '../components/knowledge/NoteTOC'

export default function KnowledgeBase() {
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [showTree, setShowTree] = useState(true)
  const [showGraph, setShowGraph] = useState(true)
  const [noteContent, setNoteContent] = useState('')
  const [scrollRequest, setScrollRequest] = useState<ScrollRequest | null>(null)

  const handleHeadingClick = useCallback((slug: string, line: number) => {
    setScrollRequest(prev => ({ slug, line, tick: (prev?.tick ?? 0) + 1 }))
  }, [])

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
            onContentChange={setNoteContent}
            scrollRequest={scrollRequest}
          />
        </div>
      </div>

      {/* ── Right sidebar ─────────────────────────────────────────────────── */}
      {showGraph && (
        <div className="w-80 shrink-0 border-l border-white/5 bg-bg-secondary flex flex-col">

          {/* ── Top: graph, square (height = sidebar width) ───────────────── */}
          <div className="w-full aspect-square shrink-0 flex flex-col">
            <div className="px-3 py-2 border-b border-white/5 shrink-0 flex items-center gap-2">
              <span className="text-[10px] font-semibold tracking-widest uppercase text-accent-muted/40">
                Note Graph
              </span>
              {selectedPath && (
                <span className="text-[10px] text-accent-muted/25 truncate">
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

          {/* ── Divider ───────────────────────────────────────────────────── */}
          <div className="border-t border-white/5 shrink-0" />

          {/* ── Bottom: note outline (TOC) ─────────────────────────────────── */}
          <div className="flex-1 flex flex-col overflow-hidden">
            <NoteTOC
              content={noteContent}
              selectedPath={selectedPath}
              onHeadingClick={handleHeadingClick}
            />
          </div>

        </div>
      )}
    </div>
  )
}
