import { useMemo } from 'react'
import { AlignLeft } from '../../ui/icons'

// ── Types ──────────────────────────────────────────────────────────────────────

export interface Heading {
  level: number   // 1–6
  text:  string   // plain text (inline markdown stripped)
  slug:  string   // url-safe id matching what MarkdownPreview adds
  line:  number   // 0-based line index in the raw markdown
}

// ── Slug helpers (must stay in sync with NoteEditor's renderer) ────────────────

function stripInlineMarkdown(raw: string): string {
  return raw
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/__(.+?)__/g, '$1')
    .replace(/_(.+?)_/g, '$1')
    .replace(/`(.+?)`/g, '$1')
    .replace(/\[(.+?)\]\(.+?\)/g, '$1')
    .trim()
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .trim()
}

export function parseHeadings(content: string): Heading[] {
  return content
    .split('\n')
    .map((line, i) => {
      const m = line.match(/^(#{1,6})\s+(.+)$/)
      if (!m) return null
      const text = stripInlineMarkdown(m[2])
      return { level: m[1].length, text, slug: slugify(text), line: i }
    })
    .filter(Boolean) as Heading[]
}

// ── Visual helpers ─────────────────────────────────────────────────────────────

function labelColor(level: number): string {
  if (level === 1) return 'text-white/85 font-semibold'
  if (level === 2) return 'text-white/70 font-medium'
  if (level === 3) return 'text-white/55'
  return 'text-white/35'
}

// ── Component ──────────────────────────────────────────────────────────────────

interface Props {
  content:        string
  selectedPath:   string | null
  onHeadingClick: (slug: string, line: number) => void
}

export default function NoteTOC({ content, selectedPath, onHeadingClick }: Props) {
  const headings = useMemo(() => parseHeadings(content), [content])

  // ── Header ───────────────────────────────────────────────────────────────────
  const header = (
    <div className="px-3 py-2 border-b border-white/5 shrink-0 flex items-center gap-2">
      <AlignLeft size={11} className="text-accent-muted/40 shrink-0" />
      <span className="text-[10px] font-semibold tracking-widest uppercase text-accent-muted/40">
        Outline
      </span>
      {headings.length > 0 && (
        <span className="ml-auto text-[9px] font-mono text-accent-muted/25">
          {headings.length}
        </span>
      )}
    </div>
  )

  // ── Empty states ──────────────────────────────────────────────────────────────
  if (!selectedPath) {
    return (
      <div className="flex flex-col flex-1 overflow-hidden">
        {header}
        <div className="flex-1 flex items-center justify-center p-4">
          <p className="text-[10px] text-accent-muted/20 italic text-center">
            Select a note to see its outline
          </p>
        </div>
      </div>
    )
  }

  if (headings.length === 0) {
    return (
      <div className="flex flex-col flex-1 overflow-hidden">
        {header}
        <div className="flex-1 flex items-center justify-center p-4">
          <p className="text-[10px] text-accent-muted/20 italic text-center">
            No headings in this note.<br />
            <span className="text-[9px]">Use # H1, ## H2 … to add structure.</span>
          </p>
        </div>
      </div>
    )
  }

  // ── Tree list ─────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      {header}
      <div className="flex-1 overflow-y-auto py-1 px-1">
        {headings.map((h, i) => {
          const indent = (h.level - 1) * 12
          const isH1 = h.level === 1

          return (
            <button
              key={i}
              onClick={() => onHeadingClick(h.slug, h.line)}
              title={h.text}
              className="w-full text-left flex items-start gap-1 py-0.5 pr-2 rounded hover:bg-white/5 transition-colors group"
              style={{ paddingLeft: `${6 + indent}px` }}
            >
              {/* Connector line for nested headings */}
              {!isH1 && (
                <span className="shrink-0 text-accent-muted/20 text-[9px] font-mono leading-[1.6] select-none">
                  {'─'}
                </span>
              )}

              {/* Heading level badge */}
              <span className="shrink-0 text-[8px] font-mono text-accent-muted/25 group-hover:text-accent-green/40 leading-[1.8] select-none transition-colors">
                {'#'.repeat(h.level)}
              </span>

              {/* Label */}
              <span className={`flex-1 text-[11px] truncate leading-snug py-px ${labelColor(h.level)}`}>
                {h.text}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
