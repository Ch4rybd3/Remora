import { useState, useEffect, useRef, useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Save, Loader2, ImageIcon, AlertCircle } from 'lucide-react'
import { knowledgeApi } from '../../api/knowledge'

type ViewMode = 'edit' | 'split' | 'preview'

// ── Wikilink preprocessing ─────────────────────────────────────────────────

function preprocessWikilinks(content: string): string {
  return content.replace(
    /\[\[([^\]|#]+?)(?:#[^\]|]*)?(?:\|([^\]]+))?\]\]/g,
    (_, target, alias) => {
      const display = alias?.trim() || target.trim()
      return `[${display}](kb:${encodeURIComponent(target.trim())})`
    },
  )
}

// ── Markdown preview panel ─────────────────────────────────────────────────

function MarkdownPreview({
  content, onWikilinkClick, scrollRef,
}: {
  content: string
  onWikilinkClick: (noteName: string) => void
  scrollRef?: React.Ref<HTMLDivElement>
}) {
  const processed = preprocessWikilinks(content)
  return (
    <div
      ref={scrollRef}
      className="prose prose-invert prose-sm max-w-none h-full overflow-auto px-6 py-5 text-white/80"
    >
      {content.trim() ? (
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            a: ({ href, children, ...props }) => {
              if (href?.startsWith('kb:')) {
                const note = decodeURIComponent(href.slice(3))
                return (
                  <button
                    onClick={() => onWikilinkClick(note)}
                    className="text-accent-green underline underline-offset-2 hover:text-accent-green/70 transition-colors cursor-pointer bg-transparent border-0 p-0 font-inherit text-inherit"
                  >
                    {children}
                  </button>
                )
              }
              return <a href={href} target="_blank" rel="noopener noreferrer" {...props}>{children}</a>
            },
            img: ({ src, alt }) => (
              <img
                src={src} alt={alt ?? ''}
                className="max-w-full rounded border border-white/10 my-2 block"
                style={{ maxHeight: 500 }}
              />
            ),
            code: ({ children, className }) =>
              className ? (
                <code className={className}>{children}</code>
              ) : (
                <code className="bg-white/10 px-1 py-0.5 rounded text-[11px] font-mono text-accent-green/80">
                  {children}
                </code>
              ),
          }}
        >
          {processed}
        </ReactMarkdown>
      ) : (
        <p className="text-accent-muted/30 italic text-sm">Start writing to see the preview…</p>
      )}
    </div>
  )
}

// ── Mode button ────────────────────────────────────────────────────────────

function ModeBtn({
  active, onClick, label,
}: {
  active: boolean
  onClick: () => void
  label: string
}) {
  return (
    <button
      onClick={onClick}
      className={`text-[10px] px-2.5 py-1 transition-colors ${
        active ? 'bg-accent-green/10 text-accent-green' : 'text-accent-muted hover:text-white'
      }`}
    >
      {label}
    </button>
  )
}

// ── Main editor ────────────────────────────────────────────────────────────

interface Props {
  path: string | null
  onNodeNavigate: (path: string) => void
}

export default function NoteEditor({ path, onNodeNavigate }: Props) {
  const qc = useQueryClient()
  const [content, setContent] = useState('')
  const [mode, setMode] = useState<ViewMode>('split')
  const [dirty, setDirty] = useState(false)
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [uploading, setUploading] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const previewRef = useRef<HTMLDivElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Refs to avoid stale closures in async save callbacks
  const pathRef = useRef<string | null>(path)
  const contentRef = useRef('')
  const dirtyRef = useRef(false)
  const saveStateSetterRef = useRef(setSaveState)
  saveStateSetterRef.current = setSaveState

  // Keep pathRef in sync with prop
  useEffect(() => { pathRef.current = path }, [path])

  // Load file content when path changes
  const { data: fileData, isLoading } = useQuery({
    queryKey: ['knowledge-file', path],
    queryFn: () => knowledgeApi.getFile(path!),
    enabled: !!path,
    // Don't cache stale data to avoid showing old content briefly
    staleTime: 0,
  })

  useEffect(() => {
    if (fileData) {
      setContent(fileData.content)
      contentRef.current = fileData.content
      setDirty(false)
      dirtyRef.current = false
      setSaveState('idle')
    }
  }, [fileData])

  // Flush any pending save when path changes (cleanup runs before next effect)
  useEffect(() => {
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current)
        debounceRef.current = null
      }
      const p = pathRef.current
      const c = contentRef.current
      const d = dirtyRef.current
      if (d && p) {
        dirtyRef.current = false
        knowledgeApi.saveFile(p, c)
          .then(() => qc.invalidateQueries({ queryKey: ['knowledge-graph'] }))
          .catch(() => {})
      }
    }
  }, [path, qc])

  // Direct save function (no closure issues — reads from refs/params)
  const doSave = useCallback((val: string, p: string) => {
    saveStateSetterRef.current('saving')
    knowledgeApi.saveFile(p, val)
      .then(() => {
        dirtyRef.current = false
        saveStateSetterRef.current('saved')
        qc.invalidateQueries({ queryKey: ['knowledge-graph'] })
        setTimeout(() => saveStateSetterRef.current('idle'), 2000)
      })
      .catch(() => {
        saveStateSetterRef.current('error')
        setTimeout(() => saveStateSetterRef.current('idle'), 3000)
      })
  }, [qc])

  const handleChange = useCallback((val: string) => {
    setContent(val)
    contentRef.current = val
    dirtyRef.current = true
    setDirty(true)
    setSaveState('idle')
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      const p = pathRef.current
      if (p) doSave(val, p)
    }, 1500)
  }, [doSave])

  // Insert text at cursor
  const insertAt = useCallback((text: string) => {
    const ta = textareaRef.current
    if (!ta) { handleChange(content + text); return }
    const s = ta.selectionStart, e = ta.selectionEnd
    const next = content.slice(0, s) + text + content.slice(e)
    handleChange(next)
    requestAnimationFrame(() => {
      ta.selectionStart = ta.selectionEnd = s + text.length
      ta.focus()
    })
  }, [content, handleChange])

  // Image paste
  const handlePaste = async (ev: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const img = Array.from(ev.clipboardData.items).find(i => i.type.startsWith('image/'))
    if (!img) return
    ev.preventDefault()
    const blob = img.getAsFile()
    if (!blob) return
    setUploading(true)
    try {
      const url = await knowledgeApi.uploadImage(blob)
      insertAt(`![screenshot](${url})`)
    } catch {
      insertAt('![upload failed]()')
    } finally {
      setUploading(false)
    }
  }

  // Image drop
  const handleDrop = async (ev: React.DragEvent<HTMLTextAreaElement>) => {
    const file = Array.from(ev.dataTransfer.files).find(f => f.type.startsWith('image/'))
    if (!file) return
    ev.preventDefault()
    setUploading(true)
    try {
      const url = await knowledgeApi.uploadImage(file)
      insertAt(`![${file.name}](${url})`)
    } catch {
      insertAt('![upload failed]()')
    } finally {
      setUploading(false)
    }
  }

  // Proportional scroll sync textarea → preview
  const handleScroll = () => {
    const ta = textareaRef.current
    const pv = previewRef.current
    if (!ta || !pv) return
    const ratio = ta.scrollTop / Math.max(ta.scrollHeight - ta.clientHeight, 1)
    pv.scrollTop = ratio * (pv.scrollHeight - pv.clientHeight)
  }

  // Wikilink navigation
  const handleWikilinkClick = useCallback((noteName: string) => {
    const treeData = qc.getQueryData<{ name: string; path: string; is_dir: boolean }[]>(['knowledge-tree'])
    const found = findByName(treeData ?? [], noteName)
    if (found) onNodeNavigate(found)
  }, [qc, onNodeNavigate])

  // ── Empty state ────────────────────────────────────────────────────────────
  if (!path) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-3 text-center px-8">
        <div className="text-5xl opacity-10">📝</div>
        <p className="text-sm text-accent-muted/50">Select a note to start editing</p>
        <p className="text-xs text-accent-muted/30">
          Use <code className="bg-white/5 px-1 rounded">[[Note Name]]</code> to link between notes
        </p>
      </div>
    )
  }

  const filename = path.split('/').pop() ?? path

  // Shared textarea element
  const textareaEl = (
    <textarea
      ref={textareaRef}
      value={content}
      onChange={e => handleChange(e.target.value)}
      onPaste={handlePaste}
      onDrop={handleDrop}
      onDragOver={e => e.preventDefault()}
      onScroll={mode === 'split' ? handleScroll : undefined}
      className="w-full h-full bg-transparent resize-none outline-none font-mono text-xs leading-relaxed text-white/75 p-6 placeholder:text-white/20"
      placeholder={`# ${filename.replace(/\.md$/i, '')}\n\nStart writing…\n\nLink notes with [[Note Name]]`}
      spellCheck={false}
    />
  )

  const previewEl = (
    <MarkdownPreview
      content={content}
      onWikilinkClick={handleWikilinkClick}
      scrollRef={previewRef}
    />
  )

  return (
    <div className="flex flex-col h-full">
      {/* ── Toolbar ─────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 px-4 py-2 border-b border-white/5 shrink-0">
        <span className="flex-1 text-sm font-medium text-white/80 truncate">{filename}</span>

        {/* Save status */}
        <span className="text-[10px] shrink-0">
          {saveState === 'saving' && (
            <span className="text-accent-muted/50 flex items-center gap-1">
              <Loader2 size={10} className="animate-spin" /> Saving…
            </span>
          )}
          {saveState === 'saved' && <span className="text-accent-green/60">Saved</span>}
          {saveState === 'error' && (
            <span className="text-severity-critical flex items-center gap-1">
              <AlertCircle size={10} /> Save error
            </span>
          )}
          {dirty && saveState === 'idle' && <span className="text-accent-muted/40">Unsaved</span>}
        </span>

        {uploading && (
          <span className="flex items-center gap-1 text-[10px] text-accent-muted shrink-0">
            <Loader2 size={10} className="animate-spin" /> Uploading…
          </span>
        )}
        {!uploading && mode !== 'preview' && (
          <span className="text-[9px] text-accent-muted/25 flex items-center gap-1 shrink-0">
            <ImageIcon size={9} /> Ctrl+V to paste image
          </span>
        )}

        {/* Mode toggle */}
        <div className="flex rounded border border-white/10 overflow-hidden shrink-0">
          <ModeBtn active={mode === 'edit'}    onClick={() => setMode('edit')}    label="Edit" />
          <ModeBtn active={mode === 'split'}   onClick={() => setMode('split')}   label="Split" />
          <ModeBtn active={mode === 'preview'} onClick={() => setMode('preview')} label="Preview" />
        </div>

        {/* Manual save */}
        <button
          onClick={() => {
            if (debounceRef.current) { clearTimeout(debounceRef.current); debounceRef.current = null }
            const p = pathRef.current
            if (p) doSave(content, p)
          }}
          disabled={!dirty || saveState === 'saving'}
          title="Save (auto-saves after 1.5s)"
          className="p-1.5 rounded text-accent-muted/50 hover:text-accent-green hover:bg-accent-green/5 transition-colors disabled:opacity-30"
        >
          <Save size={13} />
        </button>
      </div>

      {/* ── Content area ─────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-hidden">
        {isLoading ? (
          <div className="h-full flex items-center justify-center">
            <Loader2 size={20} className="animate-spin text-accent-muted/30" />
          </div>
        ) : mode === 'edit' ? (
          textareaEl
        ) : mode === 'preview' ? (
          previewEl
        ) : (
          /* Split view */
          <div className="flex h-full">
            <div className="flex-1 border-r border-white/5 overflow-hidden flex flex-col">
              <div className="px-4 pt-2 pb-0 shrink-0">
                <span className="text-[9px] text-accent-muted/25 uppercase tracking-widest">Markdown</span>
              </div>
              {textareaEl}
            </div>
            <div className="flex-1 overflow-hidden flex flex-col">
              <div className="px-6 pt-2 pb-0 shrink-0">
                <span className="text-[9px] text-accent-muted/25 uppercase tracking-widest">Preview</span>
              </div>
              {previewEl}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// Recursively find a file by stem name
function findByName(
  nodes: { name: string; path: string; is_dir: boolean; children?: { name: string; path: string; is_dir: boolean }[] }[],
  name: string,
): string | null {
  const lower = name.toLowerCase()
  for (const n of nodes) {
    if (!n.is_dir) {
      const stem = n.name.replace(/\.md$/i, '').toLowerCase()
      if (stem === lower) return n.path
    }
    if (n.is_dir && n.children) {
      const found = findByName(n.children as typeof nodes, name)
      if (found) return found
    }
  }
  return null
}
