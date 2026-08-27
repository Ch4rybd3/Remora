/**
 * MarkdownEditor — WYSIWYG-first markdown editor.
 *
 * Modes:
 *   'live'    (default) — TipTap rich editor, renders formatting/images inline as you type
 *   'source'            — raw textarea for direct markdown editing
 *   'preview'           — read-only rendered view
 *
 * Storage format is always plain markdown.
 * Resized images serialise as <img src="…" width="NNN" /> so dimensions
 * survive database round-trips.  Non-resized images stay as ![alt](src).
 */

import React, { useRef, useState, useCallback, useEffect } from 'react'
import { useEditor, EditorContent, NodeViewWrapper } from '@tiptap/react'
import { ReactNodeViewRenderer }                      from '@tiptap/react'
import type { NodeViewProps }                         from '@tiptap/react'
import { Extension }                                  from '@tiptap/core'
import StarterKit                                     from '@tiptap/starter-kit'
import ImageBase                                      from '@tiptap/extension-image'
import Link                                           from '@tiptap/extension-link'
import Placeholder                                    from '@tiptap/extension-placeholder'
import { Markdown }                                   from 'tiptap-markdown'
import { Plugin }                                     from '@tiptap/pm/state'
import { Decoration, DecorationSet }                  from '@tiptap/pm/view'
import ReactMarkdown                                  from 'react-markdown'
import remarkGfm                                      from 'remark-gfm'
import { ImageIcon, Loader2 }                         from 'lucide-react'
import { noteImagesApi }                              from '../../api/noteImages'

// ── Wikilink highlight extension ──────────────────────────────────────────────
// Finds all [[Note Name]] patterns in the document text and applies an inline
// decoration (green style + cursor:pointer). Clicks are handled by handleClick.

const WIKILINK_DECO_RE = /\[\[([^\][\n]+)\]\]/g

function buildWikilinkExtension(onNavigate: ((name: string) => void) | undefined) {
  return Extension.create({
    name: 'wikilinkHighlight',
    addProseMirrorPlugins() {
      return [
        new Plugin({
          props: {
            decorations(state) {
              if (!onNavigate) return DecorationSet.empty
              const decorations: Decoration[] = []
              state.doc.descendants((node, pos) => {
                if (!node.isText) return
                const text = node.text ?? ''
                WIKILINK_DECO_RE.lastIndex = 0
                let m: RegExpExecArray | null
                while ((m = WIKILINK_DECO_RE.exec(text)) !== null) {
                  decorations.push(
                    Decoration.inline(pos + m.index, pos + m.index + m[0].length, {
                      class: 'wikilink',
                      'data-wikilink': m[1],
                    })
                  )
                }
              })
              return DecorationSet.create(state.doc, decorations)
            },
            handleClick(view, _pos, event) {
              if (!onNavigate) return false
              const el = (event.target as HTMLElement).closest('[data-wikilink]') as HTMLElement | null
              if (!el) return false
              const name = el.dataset.wikilink
              if (name) { onNavigate(name); return true }
              return false
            },
          },
        }),
      ]
    },
  })
}

type ViewMode = 'live' | 'source' | 'preview'

interface Props {
  value:         string
  onChange:      (v: string) => void
  caseId?:       string
  uploadImage?:  (file: File | Blob) => Promise<string>
  placeholder?:  string
  minHeight?:    number
  withToggle?:   boolean
  defaultMode?:  ViewMode
  autoResize?:   boolean
  // controlled mode
  mode?:         ViewMode
  onModeChange?: (m: ViewMode) => void
}

// ── Resizable image NodeView ───────────────────────────────────────────────────

const HANDLE = 9   // handle size in px

function ResizableImageView({ node, updateAttributes, selected }: NodeViewProps) {
  const imgRef     = useRef<HTMLImageElement>(null)
  const ratioRef   = useRef<number>(1)        // aspect ratio, filled on load

  const onLoad = () => {
    const img = imgRef.current
    if (img && img.naturalWidth && img.naturalHeight) {
      ratioRef.current = img.naturalWidth / img.naturalHeight
    }
  }

  const startResize = useCallback((e: React.MouseEvent, corner: string) => {
    e.preventDefault()
    e.stopPropagation()

    const startX   = e.clientX
    const baseW    = (node.attrs.width as number | null) ?? imgRef.current?.offsetWidth ?? 300
    const ratio    = ratioRef.current

    const onMove = (ev: MouseEvent) => {
      const dx       = ev.clientX - startX
      const newW     = Math.max(80, corner.includes('e') ? baseW + dx : baseW - dx)
      const newH     = Math.round(newW / ratio)
      updateAttributes({ width: Math.round(newW), height: newH })
    }
    const onUp = () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup',   onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup',   onUp)
  }, [node.attrs.width, updateAttributes])

  const w = node.attrs.width as number | null

  const corners = ['nw', 'ne', 'sw', 'se'] as const
  const cursorMap: Record<string, string> = {
    nw: 'nwse-resize', ne: 'nesw-resize',
    sw: 'nesw-resize', se: 'nwse-resize',
  }
  const pos = (c: string): React.CSSProperties => ({
    position:  'absolute',
    width:     HANDLE,
    height:    HANDLE,
    background:'#2DD4BF',
    border:    '2px solid #0a0f1a',
    borderRadius: 2,
    cursor:    cursorMap[c],
    zIndex:    10,
    ...(c.includes('n') ? { top:    -HANDLE / 2 } : { bottom: -HANDLE / 2 }),
    ...(c.includes('w') ? { left:   -HANDLE / 2 } : { right:  -HANDLE / 2 }),
  })

  return (
    <NodeViewWrapper style={{ display: 'block', margin: '0.5rem 0', lineHeight: 0 }}>
      <div style={{ position: 'relative', display: 'inline-block', maxWidth: '100%' }}>
        <img
          ref={imgRef}
          src={node.attrs.src}
          alt={node.attrs.alt ?? ''}
          onLoad={onLoad}
          onError={e => { (e.target as HTMLImageElement).style.opacity = '0.3' }}
          style={{
            display:   'block',
            width:     w ? `${w}px` : '100%',
            maxWidth:  '100%',
            height:    'auto',
            borderRadius: 6,
            border:    selected ? '2px solid #2DD4BF' : '1px solid rgba(255,255,255,0.10)',
            transition:'border-color 0.1s',
          }}
        />
        {selected && corners.map(c => (
          <div key={c} style={pos(c)} onMouseDown={e => startResize(e, c)} />
        ))}
      </div>
    </NodeViewWrapper>
  )
}

// ── ResizableImage TipTap extension ───────────────────────────────────────────

const ResizableImage = ImageBase.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      width: {
        default: null,
        parseHTML: el =>
          el.getAttribute('width')
            ? parseInt(el.getAttribute('width')!, 10)
            : el.style.width
            ? parseInt(el.style.width, 10)
            : null,
        renderHTML: attrs => (attrs.width ? { width: attrs.width } : {}),
      },
      height: {
        default: null,
        parseHTML: el =>
          el.getAttribute('height')
            ? parseInt(el.getAttribute('height')!, 10)
            : null,
        renderHTML: attrs => (attrs.height ? { height: attrs.height } : {}),
      },
    }
  },

  // tiptap-markdown reads storage.markdown.serialize to override serialisation
  addStorage() {
    return {
      markdown: {
        serialize(state: any, node: any) {
          const src   = node.attrs.src  ?? ''
          const alt   = node.attrs.alt  ?? ''
          const title = node.attrs.title ? ` "${node.attrs.title}"` : ''
          if (node.attrs.width) {
            state.write(`<img src="${src}" alt="${alt}" width="${node.attrs.width}" />`)
          } else {
            state.write(`![${alt}](${src}${title})`)
          }
        },
        parse: { /* handled by markdown-it + parseHTML above */ },
      },
    }
  },

  addNodeView() {
    return ReactNodeViewRenderer(ResizableImageView)
  },
})

// ── Static preview renderer ────────────────────────────────────────────────────

function MarkdownBody({ value, empty }: { value: string; empty?: string }) {
  return value.trim() ? (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        img: ({ src, alt }) => (
          <img src={src} alt={alt ?? ''}
            className="max-w-full rounded border border-white/10 my-2 block"
            style={{ maxHeight: 480 }}
            onError={e => { (e.target as HTMLImageElement).style.opacity = '0.3' }}
          />
        ),
        a: ({ href, children }) => (
          <a href={href} target="_blank" rel="noopener noreferrer" className="text-accent-green underline">
            {children}
          </a>
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
      {value}
    </ReactMarkdown>
  ) : (
    <span className="italic opacity-30">{empty ?? 'No note...'}</span>
  )
}

// ── Mode toggle ────────────────────────────────────────────────────────────────

function ModeBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick}
      className={`text-[10px] px-2.5 py-1 transition-colors ${
        active ? 'bg-accent-green/10 text-accent-green' : 'text-accent-muted hover:text-white'
      }`}
    >
      {children}
    </button>
  )
}

// ── Wikilink suggestion state ─────────────────────────────────────────────────

interface WikiSuggestion {
  query:       string    // text typed after [[
  startPos:    number    // doc position of the first [ of [[
  items:       string[]  // filtered note names
  activeIndex: number    // keyboard-highlighted row
  left:        number    // viewport px (position: fixed)
  top:         number    // viewport px
}

const WIKILINK_RE = /\[\[([^\][\n]*)$/   // matches [[anything up to cursor

function filterNotes(all: string[], query: string): string[] {
  const q = query.toLowerCase()
  if (!q) return all.slice(0, 8)
  const startsWith = all.filter(n => n.toLowerCase().startsWith(q))
  const contains   = all.filter(n => !n.toLowerCase().startsWith(q) && n.toLowerCase().includes(q))
  return [...startsWith, ...contains].slice(0, 8)
}

// ── Live TipTap editor ─────────────────────────────────────────────────────────

export interface LiveEditorProps {
  value:             string
  onChange:          (v: string) => void
  placeholder:       string
  minHeight:         number
  /** Upload handler: returns the URL for the stored image. */
  uploadImage?:      (blob: Blob | File) => Promise<string>
  /** Called when an upload starts/ends so the parent can show a spinner. */
  onUploadStart?:    () => void
  onUploadEnd?:      () => void
  /** Optional list of note names for [[wikilink]] autocomplete */
  suggestions?:      string[]
  /** Called when the user clicks a [[wikilink]] in the live editor */
  onWikilinkClick?:  (name: string) => void
}

export function LiveEditor({
  value, onChange, placeholder, minHeight,
  uploadImage, onUploadStart, onUploadEnd,
  suggestions = [], onWikilinkClick,
}: LiveEditorProps) {
  const lastEmitted    = useRef<string>(value)
  const suggestRef     = useRef<WikiSuggestion | null>(null)
  const suggestionsRef = useRef<string[]>(suggestions)
  const [suggest, setSuggest] = useState<WikiSuggestion | null>(null)
  suggestRef.current     = suggest
  suggestionsRef.current = suggestions

  // ── Confirm a wikilink selection (mouse click path — editor available in closure) ──
  const confirmSuggestEditor = useCallback((ed: NonNullable<ReturnType<typeof useEditor>>, name: string, startPos: number) => {
    const { from } = ed.state.selection
    ed.chain().focus().deleteRange({ from: startPos, to: from }).insertContent(`[[${name}]]`).run()
    setSuggest(null)
  }, [])

  // Stable ref so the wikilink extension always calls the latest callback
  const onWikilinkClickRef  = useRef(onWikilinkClick)
  useEffect(() => { onWikilinkClickRef.current = onWikilinkClick }, [onWikilinkClick])

  // Stable refs for image-upload callbacks (captured in editorProps closures)
  const uploadImageRef   = useRef(uploadImage)
  const onUploadStartRef = useRef(onUploadStart)
  const onUploadEndRef   = useRef(onUploadEnd)
  useEffect(() => { uploadImageRef.current   = uploadImage   }, [uploadImage])
  useEffect(() => { onUploadStartRef.current = onUploadStart }, [onUploadStart])
  useEffect(() => { onUploadEndRef.current   = onUploadEnd   }, [onUploadEnd])

  // Editor ref — needed because editorProps closures are created before useEditor returns
   
  const editorRef = useRef<any>(null)

  const editor = useEditor({
    extensions: [
      StarterKit,
      ResizableImage.configure({ inline: false, allowBase64: true }),
      Link.configure({ openOnClick: false }),
      Placeholder.configure({ placeholder }),
      Markdown.configure({
        html:               true,
        transformCopiedText: true,
        transformPastedText: true,
      }),
      buildWikilinkExtension(onWikilinkClick
        ? (name) => onWikilinkClickRef.current?.(name)
        : undefined
      ),
    ],
    content: value,
    onUpdate({ editor }) {
      let md = (editor.storage as any).markdown.getMarkdown()
      // prosemirror-markdown escapes [ and ] in text nodes, which breaks
      // Obsidian-style [[wikilinks]] saved to disk.
      // The esc() function turns [[Note Name]] into \[\[Note Name\]\].
      // We reverse that specifically for [[...]] patterns.
      // Regex breakdown: \\\[ matches literal \[, ([^\\\]]*) captures the note
      // name (no backslash or bracket chars), \\\] matches literal \].
      md = md.replace(/\\\[\\\[([^\\\]]*)\\\]\\\]/g, '[[$1]]')
      lastEmitted.current = md
      onChange(md)

      // ── Wikilink autocomplete detection ───────────────────────────────────
      if (suggestionsRef.current.length === 0) return
      const { from } = editor.state.selection
      const textBefore = editor.state.doc.textBetween(Math.max(0, from - 200), from, '\n')
      const match = WIKILINK_RE.exec(textBefore)
      if (match) {
        const query    = match[1]
        const startPos = from - match[0].length  // position of the opening [
        const items    = filterNotes(suggestionsRef.current, query)
        const coords   = editor.view.coordsAtPos(from)
        setSuggest(s => ({
          query, startPos, items,
          activeIndex: s?.query === query ? s.activeIndex : 0,
          left: coords.left,
          top:  coords.bottom + 6,
        }))
      } else {
        setSuggest(null)
      }
    },
    editorProps: {
      handleKeyDown(view, event) {
        const s = suggestRef.current
        if (!s || s.items.length === 0) return false
        if (event.key === 'ArrowDown') {
          setSuggest(prev => prev ? { ...prev, activeIndex: (prev.activeIndex + 1) % prev.items.length } : prev)
          return true
        }
        if (event.key === 'ArrowUp') {
          setSuggest(prev => prev ? { ...prev, activeIndex: (prev.activeIndex - 1 + prev.items.length) % prev.items.length } : prev)
          return true
        }
        if (event.key === 'Enter' || event.key === 'Tab') {
          const name = s.items[s.activeIndex]
          if (name) {
            // Use ProseMirror view directly (editor not available in this closure)
            const { from } = view.state.selection
            const tr = view.state.tr.delete(s.startPos, from).insertText(`[[${name}]]`, s.startPos)
            view.dispatch(tr)
            setSuggest(null)
            return true
          }
        }
        if (event.key === 'Escape') {
          setSuggest(null)
          return true
        }
        return false
      },
      handlePaste(_, event) {
        const upload = uploadImageRef.current
        const items  = Array.from(event.clipboardData?.items ?? [])
        const img    = items.find(i => i.type.startsWith('image/'))
        if (!img || !upload) return false
        event.preventDefault()
        const blob = img.getAsFile()
        if (!blob) return true
        onUploadStartRef.current?.()
        upload(blob)
          .then(url => {
            editorRef.current?.chain().focus().setImage({ src: url, alt: 'screenshot' }).run()
          })
          .catch(() => {})
          .finally(() => onUploadEndRef.current?.())
        return true
      },
      handleDrop(_, event) {
        const upload = uploadImageRef.current
        const file   = Array.from(event.dataTransfer?.files ?? [])
          .find(f => f.type.startsWith('image/'))
        if (!file || !upload) return false
        event.preventDefault()
        onUploadStartRef.current?.()
        upload(file)
          .then(url => {
            editorRef.current?.chain().focus().setImage({ src: url, alt: file.name }).run()
          })
          .catch(() => {})
          .finally(() => onUploadEndRef.current?.())
        return true
      },
    },
  })

  // Keep editorRef in sync so image-upload closures always have the live editor
  useEffect(() => {
    if (editor) editorRef.current = editor
  }, [editor])

  // Sync external value changes without clobbering cursor.
  // Also normalise any \[\[...\]\] that legacy saves may have written to disk
  // so they display correctly and re-save as clean [[...]].
  useEffect(() => {
    if (!editor || editor.isDestroyed) return
    const normalised = value.replace(/\\\[\\\[([^\\\]]*)\\\]\\\]/g, '[[$1]]')
    if (normalised !== lastEmitted.current) {
      lastEmitted.current = normalised
      editor.commands.setContent(normalised)
    }
  }, [value, editor])

  // Close suggestion on click outside
  useEffect(() => {
    if (!suggest) return
    const close = () => setSuggest(null)
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [suggest])

  return (
    <div style={{ position: 'relative' }}>
      <EditorContent editor={editor} className="live-editor" style={{ minHeight }} />

      {/* ── Wikilink suggestion dropdown ─────────────────────────────────── */}
      {suggest && suggest.items.length > 0 && (
        <div
          style={{
            position:  'fixed',
            left:      suggest.left,
            top:       suggest.top,
            zIndex:    9999,
            minWidth:  220,
            maxWidth:  360,
          }}
          onMouseDown={e => e.preventDefault()}  // prevent blur that dismisses
          className="bg-bg-secondary border border-white/15 rounded-lg shadow-2xl overflow-hidden py-1"
        >
          {/* header */}
          <div className="px-3 py-1 border-b border-white/5 flex items-center gap-1.5">
            <span className="text-[9px] font-mono text-accent-green/60 tracking-widest">[[</span>
            <span className="text-[10px] text-accent-muted/50">
              {suggest.query ? `"${suggest.query}"` : 'all notes'}
            </span>
          </div>

          {suggest.items.map((name, i) => (
            <button
              key={name}
              className={`w-full text-left px-3 py-1.5 text-xs flex items-center gap-2 transition-colors ${
                i === suggest.activeIndex
                  ? 'bg-accent-green/10 text-white'
                  : 'text-white/70 hover:bg-white/5 hover:text-white'
              }`}
              onMouseDown={e => {
                e.preventDefault()
                if (editor) confirmSuggestEditor(editor, name, suggest.startPos)
              }}
            >
              <span className="text-accent-green/40 font-mono text-[9px] shrink-0">[[</span>
              <span className="flex-1 truncate">{name}</span>
              <span className="text-accent-green/40 font-mono text-[9px] shrink-0">]]</span>
            </button>
          ))}

          <div className="px-3 py-1 border-t border-white/5 flex items-center gap-3 text-[9px] text-accent-muted/30">
            <span>↑↓ naviguer</span>
            <span>Enter to insert</span>
            <span>Esc annuler</span>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function MarkdownEditor({
  value, onChange,
  caseId,
  uploadImage,
  placeholder    = 'Notes en markdown…',
  minHeight      = 120,
  withToggle     = true,
  defaultMode    = 'live',
  autoResize     = false,
  mode:  modeProp,
  onModeChange,
}: Props) {
  const ref = useRef<HTMLTextAreaElement>(null)
  const [uploading, setUploading]       = useState(false)
  const [modeInternal, setModeInternal] = useState<ViewMode>(defaultMode)

  const mode    = modeProp ?? modeInternal
  const setMode = (m: ViewMode) => { setModeInternal(m); onModeChange?.(m) }

  // Auto-resize source textarea
  useEffect(() => {
    if (!autoResize || !ref.current || mode !== 'source') return
    const ta  = ref.current
    ta.style.height = 'auto'
    ta.style.height = `${Math.max(ta.scrollHeight, minHeight)}px`
  }, [value, mode, autoResize, minHeight])

  const doUpload = useCallback(async (blob: File | Blob): Promise<string> => {
    if (uploadImage) return uploadImage(blob)
    if (!caseId) throw new Error('No caseId or uploadImage provided')
    return noteImagesApi.upload(caseId, blob)
  }, [uploadImage, caseId])

  // Source mode — paste image → insert markdown syntax
  const handleSourcePaste = async (ev: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const imageItem = Array.from(ev.clipboardData.items).find(i => i.type.startsWith('image/'))
    if (!imageItem) return
    ev.preventDefault()
    const blob = imageItem.getAsFile()
    if (!blob) return
    setUploading(true)
    try {
      const url = await doUpload(blob)
      const ta  = ref.current!
      const s   = ta.selectionStart
      const ins = `![screenshot](${url})`
      onChange(value.slice(0, s) + ins + value.slice(ta.selectionEnd))
      requestAnimationFrame(() => { ta.selectionStart = ta.selectionEnd = s + ins.length; ta.focus() })
    } catch { onChange(value + '\n![image upload failed]()') }
    finally  { setUploading(false) }
  }

  const handleSourceDrop = async (ev: React.DragEvent<HTMLTextAreaElement>) => {
    const file = Array.from(ev.dataTransfer.files).find(f => f.type.startsWith('image/'))
    if (!file) return
    ev.preventDefault()
    setUploading(true)
    try {
      const url = await doUpload(file)
      onChange(value + `\n![${file.name}](${url})`)
    } catch { onChange(value + '\n![image upload failed]()') }
    finally  { setUploading(false) }
  }

  const hasUpload = !!(uploadImage || caseId)

  return (
    <div className="flex flex-col gap-1.5">
      {withToggle && (
        <div className="flex items-center gap-2">
          <div className="flex rounded border border-white/10 overflow-hidden">
            <ModeBtn active={mode === 'live'}    onClick={() => setMode('live')}>Live</ModeBtn>
            <ModeBtn active={mode === 'source'}  onClick={() => setMode('source')}>Source</ModeBtn>
            <ModeBtn active={mode === 'preview'} onClick={() => setMode('preview')}>Preview</ModeBtn>
          </div>
          {uploading
            ? <span className="flex items-center gap-1 text-[10px] text-accent-muted"><Loader2 size={10} className="animate-spin" /> Upload…</span>
            : <span className="text-[9px] text-accent-muted/30 flex items-center gap-1"><ImageIcon size={9} /> Ctrl+V to paste an image</span>
          }
        </div>
      )}

      {mode === 'live' && (
        <LiveEditor
          value={value}
          onChange={onChange}
          placeholder={placeholder}
          minHeight={minHeight}
          uploadImage={hasUpload ? doUpload : undefined}
          onUploadStart={() => setUploading(true)}
          onUploadEnd={()   => setUploading(false)}
        />
      )}

      {mode === 'source' && (
        <textarea
          ref={ref}
          className="input font-mono text-xs leading-relaxed resize-none w-full"
          style={{ minHeight, overflowY: autoResize ? 'hidden' : undefined }}
          placeholder={placeholder}
          value={value}
          onChange={e => onChange(e.target.value)}
          onPaste={handleSourcePaste}
          onDrop={handleSourceDrop}
          onDragOver={e => e.preventDefault()}
        />
      )}

      {mode === 'preview' && (
        <div
          className="md-preview prose prose-invert prose-sm max-w-none min-w-0 px-3 py-2.5 rounded-lg bg-white/[0.02] border border-white/8 text-xs text-white/80 overflow-auto"
          style={{ minHeight }}
        >
          <MarkdownBody value={value} />
        </div>
      )}
    </div>
  )
}
