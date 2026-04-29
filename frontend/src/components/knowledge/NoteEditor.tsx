import { useState, useEffect, useRef, useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Save, Loader2, ImageIcon, AlertCircle } from 'lucide-react'
import { knowledgeApi } from '../../api/knowledge'
import { slugify } from './NoteTOC'

type ViewMode = 'edit' | 'split' | 'preview'

// ── Line-break & blank-line preservation ──────────────────────────────────
// Standard markdown ignores single newlines (merges into same paragraph)
// and collapses multiple blank lines into one.  This preprocessor:
//   • Appends two trailing spaces to every non-blank line outside code blocks
//     → forces a hard line-break (<br>) so every Enter press is visible.
//   • Converts each *extra* blank line into a paragraph containing a
//     non-breaking space (U+00A0) so multiple blank lines stay visible too.
// Fenced code blocks are passed through verbatim — no modifications inside.

function preprocessBlankLines(md: string): string {
  const NBSP   = ' '  // non-breaking space — markdown treats as content
  const lines  = md.split('\n')
  const out:   string[] = []
  let fenceStr = ''         // non-empty while inside a fenced code block
  let blankRun = 0

  const flushBlanks = () => {
    if (blankRun === 0) return
    out.push('')                          // first blank -> normal paragraph break
    for (let i = 1; i < blankRun; i++) { // extra blanks -> visible spacer paras
      out.push(NBSP)
      out.push('')
    }
    blankRun = 0
  }

  for (let idx = 0; idx < lines.length; idx++) {
    const line       = lines[idx]
    const isLast     = idx === lines.length - 1
    const fenceMatch = line.match(/^(`{3,}|~{3,})/)

    if (fenceStr === '') {
      if (fenceMatch) {
        // Opening fence — flush pending blanks, then emit the fence line as-is
        fenceStr = fenceMatch[1]
        flushBlanks()
        out.push(line)
      } else if (line.trim() === '') {
        blankRun++
      } else {
        flushBlanks()
        // Two trailing spaces = markdown hard line-break (rendered as <br>).
        // Skip on the very last line — a trailing break there is meaningless.
        out.push(isLast ? line : line + '  ')
      }
    } else {
      // Inside code block — pass everything verbatim, no trailing spaces
      if (fenceMatch && line.startsWith(fenceStr)) fenceStr = ''
      flushBlanks()   // blankRun should be 0 here, but flush for safety
      out.push(line)
    }
  }

  flushBlanks()
  return out.join('\n')
}

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

// ── Markdown preview panel ─────────────────────────────────────────────────

function MarkdownPreview({
  content, onWikilinkClick, scrollRef,
}: {
  content: string
  onWikilinkClick: (noteName: string) => void
  scrollRef?: React.Ref<HTMLDivElement>
}) {
  const processed = preprocessWikilinks(preprocessBlankLines(content))
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
            p: ({ children, ...props }) => {
              // Paragraphs containing only U+00A0 are blank-line spacers
              // inserted by preprocessBlankLines — render as a slim spacer div
              // instead of a full prose <p> with its top/bottom margins.
              const text = extractChildText(children)
              if (text === ' ') {
                return <div style={{ height: '0.75em' }} aria-hidden />
              }
              return <p {...props}>{children}</p>
            },
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

  // Stable ref for the onContentChange callback
  const onContentChangeRef = useRef(onContentChange)
  onContentChangeRef.current = onContentChange

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
      onContentChangeRef.current?.(fileData.content)
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
    onContentChangeRef.current?.(val)
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

  // ── Scroll to heading when TOC item is clicked ─────────────────────────────
  useEffect(() => {
    if (!scrollRequest) return

    // Preview / split — scroll the rendered preview div
    const pv = previewRef.current
    if (pv && (mode === 'preview' || mode === 'split')) {
      const el = pv.querySelector<HTMLElement>(`[data-heading-slug="${scrollRequest.slug}"]`)
      if (el) {
        // Scroll within the preview container (not window)
        pv.scrollTo({ top: Math.max(0, el.offsetTop - 24), behavior: 'smooth' })
      }
    }

    // Edit / split — position cursor at heading line in textarea
    const ta = textareaRef.current
    if (ta && (mode === 'edit' || mode === 'split')) {
      const lines = contentRef.current.split('\n')
      let charOffset = 0
      for (let i = 0; i < scrollRequest.line && i < lines.length; i++) {
        charOffset += lines[i].length + 1
      }
      ta.focus()
      ta.setSelectionRange(charOffset, charOffset)
      // Approximate scroll: ratio of line index over total lines
      const lineH = ta.scrollHeight / Math.max(lines.length, 1)
      ta.scrollTop = Math.max(0, scrollRequest.line * lineH - ta.clientHeight * 0.2)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollRequest?.tick])   // only fire when tick changes (new click)

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
