import { useState } from 'react'

import { THEMES, useTheme } from '../../context/ThemeContext'
import { Check, ChevronDown, Palette } from '../../ui/icons'

export function ThemeSelector() {
  const { theme, setTheme } = useTheme()
  const [open, setOpen] = useState(false)
  const current = THEMES.find((t) => t.value === theme)

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 w-full px-2 py-1.5 rounded-control text-label
                   text-fg-secondary hover:text-fg hover:bg-hover transition-colors"
        title="Theme"
      >
        <Palette size={13} className="shrink-0" />
        <span className="flex-1 text-left truncate font-mono">{current?.label ?? theme}</span>
        <ChevronDown size={11} className={`shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute bottom-full left-0 right-0 mb-1 z-50 overlay-surface py-1">
            {THEMES.map((option) => (
              <button
                key={option.value}
                onClick={() => {
                  setTheme(option.value)
                  setOpen(false)
                }}
                className="flex items-start gap-2 w-full px-2.5 py-1.5 text-left hover:bg-hover transition-colors"
                title={option.hint}
              >
                <Check
                  size={11}
                  className={`mt-0.5 shrink-0 ${option.value === theme ? 'text-accent' : 'opacity-0'}`}
                />
                <span className="min-w-0">
                  <span className="block text-label text-fg truncate">{option.label}</span>
                  <span className="block text-label text-fg-muted truncate">{option.hint}</span>
                </span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
