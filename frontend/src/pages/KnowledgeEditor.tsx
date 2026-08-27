/**
 * Knowledge Editor — Obsidian-style markdown editor for ZIP vaults.
 *
 * Accessed via /knowledge/editor when an Obsidian vault is selected
 * in the Vault Browser (/knowledge).
 *
 * Layout:
 *   Left   — FileTree (vault file browser)
 *   Center — NoteEditor (markdown reader + wikilink navigation)
 *   Right  — NoteGraph (inter-note links) + NoteTOC (outline)
 */

import { useState, useCallback } from 'react'
import { useQuery } from '@tanstack/react-query'
import { FileText, GitBranch, ChevronLeft, Menu, ArrowLeft } from '../ui/icons'
import { useNavigate } from 'react-router-dom'
import { knowledgeApi } from '../api/knowledge'
import FileTree from '../components/knowledge/FileTree'
import NoteEditor, { type ScrollRequest } from '../components/knowledge/NoteEditor'
import NoteGraph from '../components/knowledge/NoteGraph'
import NoteTOC from '../components/knowledge/NoteTOC'

export default function KnowledgeEditor() {
  const navigate = useNavigate()
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [showTree, setShowTree]         = useState(true)
  const [showGraph, setShowGraph]       = useState(true)
  const [noteContent, setNoteContent]   = useState('')
  const [scrollRequest, setScrollRequest] = useState<ScrollRequest | null>(null)

  const handleHeadingClick = useCallback((slug: string, line: number) => {
    setScrollRequest(prev => ({ slug, line, tick: (prev?.tick ?? 0) + 1 }))
  }, [])

  const { data: tree = [] } = useQuery({
    queryKey: ['knowledge-tree'],
    queryFn: knowledgeApi.tree,
  })

  const handleWikilinkNavigate = (path: string) => setSelectedPath(path)
  const handleGraphNodeClick   = (path: string) => setSelectedPath(path)

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
            onClick={() => navigate('/knowledge')}
            title="Back to vaults"
            className="p-1 rounded text-accent-muted/40 hover:text-white hover:bg-white/5 transition-colors"
          >
            <ArrowLeft size={13} />
          </button>
          <button
            onClick={() => setShowTree(t => !t)}
            title={showTree ? 'Masquer l\'arborescence' : 'Afficher l\'arborescence'}
            className="p-1 rounded text-accent-muted/40 hover:text-white hover:bg-white/5 transition-colors"
          >
            {showTree ? <ChevronLeft size={13} /> : <Menu size={13} />}
          </button>
          <div className="flex items-center gap-1.5 text-accent-muted/30">
            <FileText size={12} />
            <span className="text-[10px] font-semibold tracking-widest uppercase">Knowledge Editor</span>
          </div>
          <div className="flex-1" />
          <button
            onClick={() => setShowGraph(g => !g)}
            title={showGraph ? 'Masquer le graphe' : 'Afficher le graphe'}
            className={`p-1 rounded transition-colors text-[10px] flex items-center gap-1 ${
              showGraph
                ? 'text-accent-green bg-accent-green/5'
                : 'text-accent-muted/40 hover:text-white hover:bg-white/5'
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

          {/* Note graph (square) */}
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

          <div className="border-t border-white/5 shrink-0" />

          {/* Note outline (TOC) */}
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
