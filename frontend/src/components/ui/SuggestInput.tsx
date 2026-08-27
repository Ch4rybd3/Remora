import { useState, useRef, useEffect, useCallback } from 'react'

export interface Suggestion {
  value: string       // text inserted into the input
  label: string       // text shown in the list
  sublabel?: string   // info secondaire (type, ip…)
  badge?: string      // coloured badge (e.g. "IOC", "Asset")
  badgeColor?: string // classes tailwind pour le badge
}

interface Props {
  value: string
  onChange: (v: string) => void
  suggestions: Suggestion[]
  placeholder?: string
  className?: string
}

export default function SuggestInput({
  value, onChange, suggestions, placeholder, className = '',
}: Props) {
  const [open, setOpen] = useState(false)
  const [activeIdx, setActiveIdx] = useState(-1)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLUListElement>(null)

  const query = value.trim().toLowerCase()

  const filtered = query.length < 1 ? [] : suggestions.filter(s =>
    s.label.toLowerCase().includes(query) ||
    s.value.toLowerCase().includes(query) ||
    (s.sublabel?.toLowerCase().includes(query) ?? false)
  ).slice(0, 12)

  const showDropdown = open && filtered.length > 0

  const pick = useCallback((s: Suggestion) => {
    onChange(s.value)
    setOpen(false)
    setActiveIdx(-1)
    inputRef.current?.focus()
  }, [onChange])

  useEffect(() => {
    setActiveIdx(-1)
  }, [value])

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!showDropdown) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIdx(i => Math.min(i + 1, filtered.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIdx(i => Math.max(i - 1, 0))
    } else if (e.key === 'Enter' && activeIdx >= 0) {
      e.preventDefault()
      pick(filtered[activeIdx])
    } else if (e.key === 'Escape') {
      setOpen(false)
    }
  }

  // scroll active item into view
  useEffect(() => {
    if (activeIdx >= 0 && listRef.current) {
      const el = listRef.current.children[activeIdx] as HTMLElement
      el?.scrollIntoView({ block: 'nearest' })
    }
  }, [activeIdx])

  return (
    <div className="relative">
      <input
        ref={inputRef}
        className={`input ${className}`}
        placeholder={placeholder}
        value={value}
        onChange={e => { onChange(e.target.value); setOpen(true) }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={onKeyDown}
        autoComplete="off"
      />

      {showDropdown && (
        <ul
          ref={listRef}
          className="absolute z-50 left-0 right-0 mt-1 max-h-56 overflow-y-auto
                     bg-bg-card border border-white/10 rounded-lg shadow-xl py-1"
        >
          {filtered.map((s, i) => (
            <li
              key={s.value + i}
              onMouseDown={() => pick(s)}
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
    </div>
  )
}
