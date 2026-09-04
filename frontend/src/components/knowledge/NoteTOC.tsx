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
  if (level === 1) return 'text-fg/85 font-semibold'
  if (level === 2) return 'text-fg/70 font-medium'
  if (level === 3) return 'text-fg/55'
  return 'text-fg/35'
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
    <div className="px-3 py-2 border-b border-hairline shrink-0 flex items-center gap-2">
      <AlignLeft size={11} className="text-fg-secondary/40 shrink-0" />
      <span className="text-label font-semibold tracking-widest uppercase text-fg-secondary/40">
        Outline
      </span>
      {headings.length > 0 && (
        <span className="ml-auto text-label font-mono text-fg-secondary/25">
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
          <p className="text-label text-fg-secondary/20 italic text-center">
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
          <p className="text-label text-fg-secondary/20 italic text-center">
            No headings in this note.<br />
            <span className="text-label">Use # H1, ## H2 … to add structure.</span>
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
              className="w-full text-left flex items-start gap-1 py-0.5 pr-2 rounded-control hover:bg-fg/5 transition-colors group"
              style={{ paddingLeft: `${6 + indent}px` }}
            >
              {/* Connector line for nested headings */}
              {!isH1 && (
                <span className="shrink-0 text-fg-secondary/20 text-label font-mono leading-[1.6] select-none">
                  {'─'}
                </span>
              )}

              {/* Heading level badge */}
              <span className="shrink-0 text-label font-mono text-fg-secondary/25 group-hover:text-accent/40 leading-[1.8] select-none transition-colors">
                {'#'.repeat(h.level)}
              </span>

              {/* Label */}
              <span className={`flex-1 text-label truncate leading-snug py-px ${labelColor(h.level)}`}>
                {h.text}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
