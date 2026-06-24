import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Save, Loader2, AlertCircle } from 'lucide-react'
import { knowledgeApi } from '../../api/knowledge'
import { LiveEditor } from '../ui/MarkdownEditor'
import { slugify } from './NoteTOC'

// ── Flatten vault tree into note stem names ────────────────────────────────

type TreeNode = { name: string; path: string; is_dir: boolean; children?: TreeNode[] }

function flattenNoteNames(nodes: TreeNode[]): string[] {
  const out: string[] = []
  for (const n of nodes) {
    if (!n.is_dir) {
      out.push(n.name.replace(/\.md$/i, ''))
    } else if (n.children) {
      out.push(...flattenNoteNames(n.children))
    }
  }
  return out
}

type ViewMode = 'live' | 'split' | 'preview'

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

// ── Heading slug helper (for preview IDs) ─────────────────────────────────

function extractChildText(children: React.ReactNode): string {
  if (typeof children === 'string') return children
  if (Array.isArray(children)) return children.map(extractChildText).join('')
  if (children && typeof children === 'object' && 'props' in (children as object)) {
    return extractChildText((children as { props: { children?: React.ReactNode } }).props.children)
  }
  return ''
}

function makeHeadingComponent(tag: 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6') {
  return function HeadingEl({ children, ...props }: { children?: React.ReactNode }) {
    const slug = slugify(extractChildText(children))
    const Tag = tag
    return (
      <Tag data-heading-slug={slug} {...props}>
        {children}
      </Tag>
    )
  }
}

// ── Wikilink-aware markdown preview ───────────────────────────────────────

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
            h1: makeHeadingComponent('h1'),
            h2: makeHeadingComponent('h2'),
            h3: makeHeadingComponent('h3'),
            h4: makeHeadingComponent('h4'),
            h5: makeHeadingComponent('h5'),
            h6: makeHeadingComponent('h6'),
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

export interface ScrollRequest {
  slug: string
  line: number
  tick: number   // increment to re-trigger same heading
}

interface Props {
  path:             string | null
  onNodeNavigate:   (path: string) => void
  onContentChange?: (content: string) => void
  scrollRequest?:   ScrollRequest | null
}

export default function NoteEditor({ path, onNodeNavigate, onContentChange, scrollRequest }: Props) {
  const qc = useQueryClient()
  const [content, setContent]   = useState('')
  const [mode, setMode]         = useState<ViewMode>('live')
  const [dirty, setDirty]       = useState(false)
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [uploading, setUploading] = useState(false)

  // ── Note names for wikilink autocomplete ────────────────────────────────────
  const { data: tree = [] } = useQuery({
    queryKey: ['knowledge-tree'],
    queryFn:  knowledgeApi.tree,
    staleTime: 60_000,
  })
  const noteNames = useMemo(() => flattenNoteNames(tree as TreeNode[]), [tree])

  const previewRef    = useRef<HTMLDivElement>(null)
  const liveEditorRef = useRef<HTMLDivElement>(null)
  const debounceRef   = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Refs to avoid stale closures in async save callbacks
  const pathRef           = useRef<string | null>(path)
  const contentRef        = useRef('')
  const dirtyRef          = useRef(false)
  const saveStateSetterRef = useRef(setSaveState)
  saveStateSetterRef.current = setSaveState

  const onContentChangeRef = useRef(onContentChange)
  onContentChangeRef.current = onContentChange

  useEffect(() => { pathRef.current = path }, [path])

  // Load file content when path changes
  const { data: fileData, isLoading } = useQuery({
    queryKey: ['knowledge-file', path],
    queryFn: () => knowledgeApi.getFile(path!),
    enabled: !!path,
    staleTime: 0,
  })

  useEffect(() => {
    if (fileData) {
      setContent(fileData.content)
      contentRef.current = fileData.content
      setDirty(false)
      dirtyRef.current = false
      setSaveState('idle')
      onContentChangeRef.current?.(fileData.content)
    }
  }, [fileData])

  // Flush pending save on unmount / path change
  useEffect(() => {
    return () => {
      if (debounceRef.current) { clearTimeout(debounceRef.current); debounceRef.current = null }
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

  const doSave = useCallback((val: string, p: string) => {
    saveStateSetterRef.current('saving')
    knowledgeApi.saveFile(p, val)
      .then(() => {
        dirtyRef.current = false
        saveStateSetterRef.current('saved')
        qc.refetchQueries({ queryKey: ['knowledge-graph'] })
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
    onContentChangeRef.current?.(val)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      const p = pathRef.current
      if (p) doSave(val, p)
    }, 1500)
  }, [doSave])

  // ── Image upload handler for live editor (LiveEditor handles insertion via setImage) ──
  const handleUploadImage = useCallback(async (file: Blob | File): Promise<string> => {
    setUploading(true)
    try {
      return await knowledgeApi.uploadImage(file)
    } finally {
      setUploading(false)
    }
  }, [])

  // ── Scroll to heading when TOC item is clicked ─────────────────────────────
  useEffect(() => {
    if (!scrollRequest) return

    // Live mode: query actual DOM headings rendered by TipTap
    if (mode === 'live' && liveEditorRef.current) {
      const headings = liveEditorRef.current.querySelectorAll<HTMLElement>('h1, h2, h3, h4, h5, h6')
      for (const el of headings) {
        if (slugify(el.textContent ?? '') === scrollRequest.slug) {
          el.scrollIntoView({ behavior: 'smooth', block: 'start' })
          break
        }
      }
    }

    // Preview / split: scroll the rendered preview div
    if ((mode === 'preview' || mode === 'split') && previewRef.current) {
      const el = previewRef.current.querySelector<HTMLElement>(`[data-heading-slug="${scrollRequest.slug}"]`)
      if (el) {
        previewRef.current.scrollTo({ top: Math.max(0, el.offsetTop - 24), behavior: 'smooth' })
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollRequest?.tick])

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

  // Shared live editor element
  const liveEl = (
    <div ref={liveEditorRef} className="h-full overflow-auto px-2 py-2">
      <LiveEditor
        value={content}
        onChange={handleChange}
        placeholder={`# ${filename.replace(/\.md$/i, '')}\n\nStart writing…\n\nLink notes with [[Note Name]]`}
        minHeight={400}
        uploadImage={handleUploadImage}
        suggestions={noteNames}
        onWikilinkClick={handleWikilinkClick}
      />
    </div>
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

        {/* Save / upload status */}
        <span className="text-[10px] shrink-0">
          {uploading && (
            <span className="text-accent-muted/50 flex items-center gap-1">
              <Loader2 size={10} className="animate-spin" /> Uploading…
            </span>
          )}
          {!uploading && saveState === 'saving' && (
            <span className="text-accent-muted/50 flex items-center gap-1">
              <Loader2 size={10} className="animate-spin" /> Saving…
            </span>
          )}
          {!uploading && saveState === 'saved'  && <span className="text-accent-green/60">Saved</span>}
          {!uploading && saveState === 'error'  && (
            <span className="text-severity-critical flex items-center gap-1">
              <AlertCircle size={10} /> Save error
            </span>
          )}
          {!uploading && dirty && saveState === 'idle' && <span className="text-accent-muted/40">Unsaved</span>}
        </span>

        {/* Mode toggle */}
        <div className="flex rounded border border-white/10 overflow-hidden shrink-0">
          <ModeBtn active={mode === 'live'}    onClick={() => setMode('live')}    label="Live" />
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
        ) : mode === 'live' ? (
          liveEl
        ) : mode === 'preview' ? (
          previewEl
        ) : (
          /* Split: live editor left + wikilink preview right */
          <div className="flex h-full">
            <div className="flex-1 border-r border-white/5 overflow-hidden flex flex-col">
              <div className="px-4 pt-2 pb-0 shrink-0">
                <span className="text-[9px] text-accent-muted/25 uppercase tracking-widest">Live</span>
              </div>
              {liveEl}
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
