import { useState, useRef, useEffect } from 'react'
import { useQueryClient, useMutation } from '@tanstack/react-query'
import {
  Folder, FolderOpen, FileText, ChevronRight, ChevronDown,
  Plus, Trash2, Edit2, Check, X, ChevronsUpDown,
} from 'lucide-react'
import { knowledgeApi, type FileNode } from '../../api/knowledge'

interface Props {
  nodes: FileNode[]
  selected: string | null
  onSelect: (path: string) => void
}

function NewItemInput({
  onConfirm, onCancel, placeholder,
}: { onConfirm: (name: string) => void; onCancel: () => void; placeholder: string }) {
  const [val, setVal] = useState('')
  return (
    <div className="flex items-center gap-1 px-2 py-0.5">
      <input
        autoFocus
        value={val}
        onChange={e => setVal(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter' && val.trim()) onConfirm(val.trim())
          if (e.key === 'Escape') onCancel()
        }}
        placeholder={placeholder}
        className="flex-1 bg-white/5 border border-white/10 rounded px-1.5 py-0.5 text-[11px] text-white outline-none focus:border-accent-green/40"
      />
      <button onClick={() => val.trim() && onConfirm(val.trim())} className="text-accent-green hover:text-accent-green/70">
        <Check size={11} />
      </button>
      <button onClick={onCancel} className="text-accent-muted/60 hover:text-white">
        <X size={11} />
      </button>
    </div>
  )
}

function TreeNode({
  node, selected, onSelect, depth, parentPath,
  onDelete, onRename, foldSignal,
}: {
  node: FileNode
  selected: string | null
  onSelect: (path: string) => void
  depth: number
  parentPath: string
  onDelete: (path: string) => void
  onRename: (path: string) => void
  foldSignal: { tick: number; open: boolean }
}) {
  const [open, setOpen] = useState(depth === 0)

  useEffect(() => {
    if (foldSignal.tick > 0) setOpen(foldSignal.open)
  }, [foldSignal.tick])  
  const [creating, setCreating] = useState<'file' | 'folder' | null>(null)
  const [hovered, setHovered] = useState(false)
  const qc = useQueryClient()

  const createFile = useMutation({
    mutationFn: (name: string) => {
      const p = node.is_dir ? `${node.path}/${name}` : `${parentPath}/${name}`
      return knowledgeApi.createFile(p.endsWith('.md') ? p : `${p}.md`)
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['knowledge-tree'] })
      onSelect(data.path)
      setCreating(null)
    },
  })

  const createFolder = useMutation({
    mutationFn: (name: string) => {
      const p = node.is_dir ? `${node.path}/${name}` : `${parentPath}/${name}`
      return knowledgeApi.createFolder(p)
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['knowledge-tree'] }); setCreating(null) },
  })

  const isActive = selected === node.path
  const indent = depth * 12

  if (node.is_dir) {
    return (
      <div>
        <div
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
          className="group flex items-center gap-1.5 py-0.5 pr-2 rounded cursor-pointer hover:bg-white/5 transition-colors"
          style={{ paddingLeft: `${indent + 8}px` }}
          onClick={() => setOpen(o => !o)}
        >
          <span className="shrink-0 text-accent-muted/60">
            {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          </span>
          <span className="shrink-0 text-accent-muted/70">
            {open ? <FolderOpen size={13} /> : <Folder size={13} />}
          </span>
          <span className="flex-1 text-[11px] text-white/70 truncate">{node.name}</span>
          {hovered && (
            <span className="flex items-center gap-0.5 shrink-0" onClick={e => e.stopPropagation()}>
              <button
                onClick={() => { setOpen(true); setCreating('file') }}
                className="p-0.5 rounded text-accent-muted/40 hover:text-accent-green transition-colors"
                title="New note"
              ><Plus size={10} /></button>
              <button
                onClick={() => { setOpen(true); setCreating('folder') }}
                className="p-0.5 rounded text-accent-muted/40 hover:text-accent-green transition-colors"
                title="New folder"
              ><Folder size={10} /></button>
              <button
                onClick={() => onDelete(node.path)}
                className="p-0.5 rounded text-accent-muted/40 hover:text-severity-critical transition-colors"
                title="Delete folder"
              ><Trash2 size={10} /></button>
            </span>
          )}
        </div>
        {open && (
          <div>
            {creating === 'file' && (
              <div style={{ paddingLeft: `${indent + 20}px` }}>
                <NewItemInput
                  placeholder="note-name.md"
                  onConfirm={name => createFile.mutate(name)}
                  onCancel={() => setCreating(null)}
                />
              </div>
            )}
            {creating === 'folder' && (
              <div style={{ paddingLeft: `${indent + 20}px` }}>
                <NewItemInput
                  placeholder="folder-name"
                  onConfirm={name => createFolder.mutate(name)}
                  onCancel={() => setCreating(null)}
                />
              </div>
            )}
            {node.children.map(child => (
              <TreeNode
                key={child.path}
                node={child}
                selected={selected}
                onSelect={onSelect}
                depth={depth + 1}
                parentPath={node.path}
                onDelete={onDelete}
                onRename={onRename}
                foldSignal={foldSignal}
              />
            ))}
          </div>
        )}
      </div>
    )
  }

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={() => onSelect(node.path)}
      className={`group flex items-center gap-1.5 py-0.5 pr-2 rounded cursor-pointer transition-colors ${
        isActive
          ? 'bg-accent-green/10 text-accent-green'
          : 'hover:bg-white/5 text-white/60 hover:text-white/80'
      }`}
      style={{ paddingLeft: `${indent + 8}px` }}
    >
      <FileText size={12} className="shrink-0 opacity-60" />
      <span className="flex-1 text-[11px] truncate">{node.name}</span>
      {hovered && (
        <span className="flex items-center gap-0.5 shrink-0" onClick={e => e.stopPropagation()}>
          <button
            onClick={() => onRename(node.path)}
            className="p-0.5 rounded text-accent-muted/40 hover:text-accent-green transition-colors"
            title="Rename"
          ><Edit2 size={10} /></button>
          <button
            onClick={() => onDelete(node.path)}
            className="p-0.5 rounded text-accent-muted/40 hover:text-severity-critical transition-colors"
            title="Delete"
          ><Trash2 size={10} /></button>
        </span>
      )}
    </div>
  )
}

export default function FileTree({ nodes, selected, onSelect }: Props) {
  const qc = useQueryClient()
  const [creatingRoot, setCreatingRoot] = useState<'file' | 'folder' | null>(null)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [foldSignal, setFoldSignal] = useState<{ tick: number; open: boolean }>({ tick: 0, open: false })
  // allOpen tracks what the NEXT click should do (starts true so first click collapses)
  const [allOpen, setAllOpen] = useState(true)
  const fileRef = useRef<HTMLInputElement>(null)

  const createFile = useMutation({
    mutationFn: (name: string) => knowledgeApi.createFile(name.endsWith('.md') ? name : `${name}.md`),
    onSuccess: (data) => { qc.invalidateQueries({ queryKey: ['knowledge-tree'] }); onSelect(data.path); setCreatingRoot(null) },
  })

  const createFolder = useMutation({
    mutationFn: (name: string) => knowledgeApi.createFolder(name),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['knowledge-tree'] }); setCreatingRoot(null) },
  })

  const deleteItem = useMutation({
    mutationFn: (path: string) => knowledgeApi.deleteFile(path),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['knowledge-tree'] }),
  })

  const renameItem = useMutation({
    mutationFn: ({ old_path, new_path }: { old_path: string; new_path: string }) =>
      knowledgeApi.rename(old_path, new_path),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['knowledge-tree'] }); setRenaming(null) },
  })

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    await knowledgeApi.importVault(file)
    qc.invalidateQueries({ queryKey: ['knowledge-tree'] })
    qc.invalidateQueries({ queryKey: ['knowledge-graph'] })
  }

  const handleDelete = (path: string) => {
    if (confirm(`Delete "${path.split('/').pop()}"?`)) deleteItem.mutate(path)
  }

  const handleRename = (path: string) => setRenaming(path)

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-3 py-2.5 border-b border-white/5 flex items-center justify-between shrink-0">
        <span className="text-[10px] font-semibold tracking-widest uppercase text-accent-muted/50">Vault</span>
        <div className="flex items-center gap-1">
          <button
            onClick={() => {
              const next = !allOpen
              setAllOpen(next)
              setFoldSignal(s => ({ tick: s.tick + 1, open: next }))
            }}
            title={allOpen ? 'Collapse all folders' : 'Expand all folders'}
            className="p-1 rounded text-accent-muted/50 hover:text-white hover:bg-white/5 transition-colors"
          ><ChevronsUpDown size={13} /></button>
          <button
            onClick={() => setCreatingRoot('file')}
            title="New note"
            className="p-1 rounded text-accent-muted/50 hover:text-accent-green hover:bg-accent-green/5 transition-colors"
          ><Plus size={13} /></button>
          <button
            onClick={() => setCreatingRoot('folder')}
            title="New folder"
            className="p-1 rounded text-accent-muted/50 hover:text-accent-green hover:bg-accent-green/5 transition-colors"
          ><Folder size={13} /></button>
          <button
            onClick={() => fileRef.current?.click()}
            title="Import vault (.zip)"
            className="p-1 rounded text-accent-muted/50 hover:text-accent-green hover:bg-accent-green/5 transition-colors text-[10px] font-mono"
          >ZIP</button>
          <input ref={fileRef} type="file" accept=".zip" className="sr-only" onChange={handleImport} />
        </div>
      </div>

      {/* Tree */}
      <div className="flex-1 overflow-y-auto py-1 px-1">
        {creatingRoot === 'file' && (
          <NewItemInput
            placeholder="new-note.md"
            onConfirm={name => createFile.mutate(name)}
            onCancel={() => setCreatingRoot(null)}
          />
        )}
        {creatingRoot === 'folder' && (
          <NewItemInput
            placeholder="new-folder"
            onConfirm={name => createFolder.mutate(name)}
            onCancel={() => setCreatingRoot(null)}
          />
        )}

        {/* Rename input overlay */}
        {renaming && (
          <NewItemInput
            placeholder={renaming.split('/').pop() ?? ''}
            onConfirm={name => {
              const dir = renaming.includes('/') ? renaming.substring(0, renaming.lastIndexOf('/') + 1) : ''
              renameItem.mutate({ old_path: renaming, new_path: `${dir}${name}` })
            }}
            onCancel={() => setRenaming(null)}
          />
        )}

        {nodes.length === 0 ? (
          <div className="px-3 py-8 text-center">
            <p className="text-[11px] text-accent-muted/40 italic">Vault is empty.</p>
            <p className="text-[10px] text-accent-muted/30 mt-1">Import a .zip or create a note.</p>
          </div>
        ) : (
          nodes.map(node => (
            <TreeNode
              key={node.path}
              node={node}
              selected={selected}
              onSelect={onSelect}
              depth={0}
              parentPath=""
              onDelete={handleDelete}
              onRename={handleRename}
              foldSignal={foldSignal}
            />
          ))
        )}
      </div>
    </div>
  )
}
