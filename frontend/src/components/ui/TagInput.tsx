import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { X } from '../../ui/icons'
import type { Suggestion } from './SuggestInput'

export interface InputTag {
  value: string
  badgeColor: string
}

interface Props {
  tags: InputTag[]
  onChange: (tags: InputTag[]) => void
  suggestions: Suggestion[]
  placeholder?: string
}

export default function TagInput({ tags, onChange, suggestions, placeholder }: Props) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [activeIdx, setActiveIdx] = useState(-1)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLUListElement>(null)

  const existing = useMemo(() => new Set(tags.map(t => t.value.toLowerCase())), [tags])

  const filtered = query.trim().length < 1 ? [] : suggestions
    .filter(s =>
      !existing.has(s.value.toLowerCase()) && (
        s.label.toLowerCase().includes(query.toLowerCase()) ||
        s.value.toLowerCase().includes(query.toLowerCase()) ||
        (s.sublabel?.toLowerCase().includes(query.toLowerCase()) ?? false)
      )
    )
    .slice(0, 10)

  const showDropdown = open && filtered.length > 0

  const addTag = useCallback((tag: InputTag) => {
    if (!tag.value.trim() || existing.has(tag.value.toLowerCase())) return
    onChange([...tags, tag])
    setQuery('')
    setActiveIdx(-1)
    inputRef.current?.focus()
  }, [tags, onChange, existing])

  const removeTag = useCallback((idx: number) => {
    onChange(tags.filter((_, i) => i !== idx))
  }, [tags, onChange])

  const commitQuery = useCallback(() => {
    const v = query.trim()
    if (!v) return
    addTag({ value: v, badgeColor: 'bg-white/5 text-accent-muted border-white/10' })
  }, [query, addTag])

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      if (showDropdown && activeIdx >= 0) {
        const s = filtered[activeIdx]
        addTag({ value: s.value, badgeColor: s.badgeColor ?? 'bg-white/5 text-accent-muted border-white/10' })
      } else {
        commitQuery()
      }
    } else if (e.key === 'Backspace' && !query && tags.length > 0) {
      removeTag(tags.length - 1)
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIdx(i => Math.min(i + 1, filtered.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIdx(i => Math.max(i - 1, 0))
    } else if (e.key === 'Escape') {
      setOpen(false)
    }
  }

  useEffect(() => {
    setActiveIdx(-1)
  }, [query])

  useEffect(() => {
    if (activeIdx >= 0 && listRef.current) {
      const el = listRef.current.children[activeIdx] as HTMLElement
      el?.scrollIntoView({ block: 'nearest' })
    }
  }, [activeIdx])

  return (
    <div className="relative">
      <div
        className="input flex flex-wrap gap-1.5 min-h-[38px] h-auto py-1.5 cursor-text"
        onClick={() => inputRef.current?.focus()}
      >
        {tags.map((tag, i) => (
          <span
            key={tag.value + i}
            className={`inline-flex items-center gap-1 text-xs font-mono px-2 py-0.5 rounded border ${tag.badgeColor}`}
          >
            {tag.value}
            <button
              type="button"
              onMouseDown={e => { e.preventDefault(); removeTag(i) }}
              className="opacity-60 hover:opacity-100 transition-opacity ml-0.5"
            >
              <X size={10} />
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          className="bg-transparent outline-none text-sm text-white placeholder-accent-muted/50 min-w-[120px] flex-1"
          value={query}
          placeholder={tags.length === 0 ? placeholder : ''}
          onChange={e => { setQuery(e.target.value); setOpen(true) }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={onKeyDown}
          autoComplete="off"
        />
      </div>

      {showDropdown && (
        <ul
          ref={listRef}
          className="absolute z-50 left-0 right-0 mt-1 max-h-52 overflow-y-auto
                     bg-bg-card border border-white/10 rounded-lg shadow-xl py-1"
        >
          {filtered.map((s, i) => (
            <li
              key={s.value + i}
              onMouseDown={() => addTag({
                value: s.value,
                badgeColor: s.badgeColor ?? 'bg-white/5 text-accent-muted border-white/10',
              })}
              className={`flex items-center gap-3 px-3 py-2 cursor-pointer transition-colors ${
                i === activeIdx ? 'bg-accent-green/10' : 'hover:bg-white/5'
              }`}
            >
              {s.badge && (
                <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded border shrink-0 ${s.badgeColor ?? 'bg-white/5 text-accent-muted border-white/10'}`}>
                  {s.badge}
                </span>
              )}
              <div className="flex-1 min-w-0">
                <p className="text-sm text-white truncate font-mono">{s.label}</p>
                {s.sublabel && (
                  <p className="text-xs text-accent-muted/60 truncate">{s.sublabel}</p>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      <p className="text-xs text-accent-muted/40 mt-1">
        Enter or comma to confirm - Backspace to remove
      </p>
    </div>
  )
}
