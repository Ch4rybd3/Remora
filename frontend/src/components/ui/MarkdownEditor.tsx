import { useRef, useState, useCallback, useEffect } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { ImageIcon, Loader2 } from 'lucide-react'
import { noteImagesApi } from '../../api/noteImages'

type ViewMode = 'edit' | 'split' | 'preview'

interface Props {
  value: string
  onChange: (v: string) => void
  caseId?: string
  uploadImage?: (file: File | Blob) => Promise<string>
  placeholder?: string
  minHeight?: number
  withToggle?: boolean
  defaultMode?: ViewMode
  autoResize?: boolean   // textarea grows to fit content (no scroll)
  // controlled mode (optional — lifts state to parent)
  mode?: ViewMode
  onModeChange?: (m: ViewMode) => void
}

// ── Shared markdown renderer ───────────────────────────────────────────────

function MarkdownBody({ value, empty }: { value: string; empty?: string }) {
  return value.trim() ? (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        img: ({ src, alt }) => (
          <img
            src={src}
            alt={alt ?? ''}
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
    <span className="italic opacity-30">{empty ?? 'Aucune note…'}</span>
  )
}

// ── Tab button ─────────────────────────────────────────────────────────────

function ModeBtn({
  active, onClick, children,
}: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-[10px] px-2.5 py-1 transition-colors ${
        active ? 'bg-accent-green/10 text-accent-green' : 'text-accent-muted hover:text-white'
      }`}
    >
      {children}
    </button>
  )
}

// ── Main component ─────────────────────────────────────────────────────────

export default function MarkdownEditor({
  value, onChange,
  caseId,
  uploadImage,
  placeholder = 'Notes in markdown…',
  minHeight = 120,
  withToggle = true,
  defaultMode = 'split',
  autoResize = false,
  mode: modeProp,
  onModeChange,
}: Props) {
  const ref = useRef<HTMLTextAreaElement>(null)
  const previewRef = useRef<HTMLDivElement>(null)
  const [uploading, setUploading] = useState(false)
  const [modeInternal, setModeInternal] = useState<ViewMode>(defaultMode)

  // If parent controls mode, use that; otherwise use internal state
  const mode = modeProp ?? modeInternal
  const setMode = (m: ViewMode) => {
    setModeInternal(m)
    onModeChange?.(m)
  }

  // Auto-resize: grow textarea to fit its content
  useEffect(() => {
    if (!autoResize || !ref.current) return
    const ta = ref.current
    ta.style.height = 'auto'
    ta.style.height = `${Math.max(ta.scrollHeight, minHeight)}px`
  }, [value, mode, autoResize, minHeight])

  // Insert text at cursor position
  const insertAt = useCallback((text: string) => {
    const ta = ref.current
    if (!ta) { onChange(value + text); return }
    const s = ta.selectionStart
    const e = ta.selectionEnd
    const next = value.slice(0, s) + text + value.slice(e)
    onChange(next)
    requestAnimationFrame(() => {
      ta.selectionStart = ta.selectionEnd = s + text.length
      ta.focus()
    })
  }, [value, onChange])

  // Upload dispatcher — uses custom fn or falls back to noteImagesApi
  const doUpload = useCallback(async (blob: File | Blob): Promise<string> => {
    if (uploadImage) return uploadImage(blob)
    if (!caseId) throw new Error('No caseId or uploadImage provided')
    return noteImagesApi.upload(caseId, blob)
  }, [uploadImage, caseId])

  const handlePaste = async (ev: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = Array.from(ev.clipboardData.items)
    const imageItem = items.find(i => i.type.startsWith('image/'))
    if (!imageItem) return
    ev.preventDefault()
    const blob = imageItem.getAsFile()
    if (!blob) return
    setUploading(true)
    try {
      const url = await doUpload(blob)
      insertAt(`![screenshot](${url})`)
    } catch {
      insertAt('![image upload failed]()')
    } finally {
      setUploading(false)
    }
  }

  const handleDrop = async (ev: React.DragEvent<HTMLTextAreaElement>) => {
    const file = Array.from(ev.dataTransfer.files).find(f => f.type.startsWith('image/'))
    if (!file) return
    ev.preventDefault()
    setUploading(true)
    try {
      const url = await doUpload(file)
      insertAt(`![${file.name}](${url})`)
    } catch {
      insertAt('![image upload failed]()')
    } finally {
      setUploading(false)
    }
  }

  // Sync textarea scroll → preview scroll
  const handleScroll = () => {
    const ta = ref.current
    const pv = previewRef.current
    if (!ta || !pv) return
    const ratio = ta.scrollTop / Math.max(ta.scrollHeight - ta.clientHeight, 1)
    pv.scrollTop = ratio * (pv.scrollHeight - pv.clientHeight)
  }

  const textareaEl = (
    <textarea
      ref={ref}
      className="input font-mono text-xs leading-relaxed resize-none w-full"
      style={{
        minHeight,
        height: autoResize ? 'auto' : (mode === 'split' ? '100%' : undefined),
        overflowY: autoResize ? 'hidden' : undefined,
      }}
      placeholder={placeholder}
      value={value}
      onChange={e => onChange(e.target.value)}
      onPaste={handlePaste}
      onDrop={handleDrop}
      onDragOver={e => e.preventDefault()}
      onScroll={mode === 'split' ? handleScroll : undefined}
    />
  )

  const previewEl = (
    <div
      ref={previewRef}
      className="prose prose-invert prose-sm max-w-none px-3 py-2.5 rounded-lg bg-white/[0.02] border border-white/8 text-xs text-white/80 overflow-auto"
      style={{ minHeight }}
    >
      <MarkdownBody value={value} />
    </div>
  )

  return (
    <div className="flex flex-col gap-1.5">
      {withToggle && (
        <div className="flex items-center gap-2">
          <div className="flex rounded border border-white/10 overflow-hidden">
            <ModeBtn active={mode === 'edit'}    onClick={() => setMode('edit')}>Edit</ModeBtn>
            <ModeBtn active={mode === 'split'}   onClick={() => setMode('split')}>Split</ModeBtn>
            <ModeBtn active={mode === 'preview'} onClick={() => setMode('preview')}>Preview</ModeBtn>
          </div>
          {uploading
            ? <span className="flex items-center gap-1 text-[10px] text-accent-muted"><Loader2 size={10} className="animate-spin" /> Upload…</span>
            : <span className="text-[9px] text-accent-muted/30 flex items-center gap-1"><ImageIcon size={9} /> Ctrl+V pour coller une image</span>
          }
        </div>
      )}

      {mode === 'edit' && textareaEl}
      {mode === 'preview' && previewEl}
      {mode === 'split' && (
        <div className="grid grid-cols-2 gap-2" style={{ minHeight }}>
          <div className="flex flex-col">
            <span className="text-[9px] text-accent-muted/30 mb-1 px-0.5">Markdown</span>
            {textareaEl}
          </div>
          <div className="flex flex-col">
            <span className="text-[9px] text-accent-muted/30 mb-1 px-0.5">Preview</span>
            {previewEl}
          </div>
        </div>
      )}
    </div>
  )
}
