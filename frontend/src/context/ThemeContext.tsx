import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'

import { resetColorCache } from '../styles/tokens'

export const THEMES = [
  { value: 'dark',          label: 'Remora dark',  hint: 'The default. Deep blue-black, single teal accent.' },
  { value: 'light',         label: 'Remora light', hint: 'Re-derived rather than inverted; the accent darkens for contrast.' },
  { value: 'github-dark',   label: 'GitHub dark',  hint: "GitHub's palette mapped onto the same tokens." },
  { value: 'github-light',  label: 'GitHub light', hint: 'Same, on a white canvas.' },
] as const

export type Theme = (typeof THEMES)[number]['value']

const STORAGE_KEY = 'remora_theme'
const DEFAULT: Theme = 'dark'

interface ThemeContextValue {
  theme: Theme
  setTheme: (t: Theme) => void
}

const ThemeContext = createContext<ThemeContextValue>({ theme: DEFAULT, setTheme: () => {} })

function isTheme(value: unknown): value is Theme {
  return THEMES.some((t) => t.value === value)
}

/**
 * Applies the theme by stamping `data-theme` on the document element, which is
 * what every token in tokens.css keys off. Persistence is local for now;
 * per-user storage on the server is S17 work, alongside the other preferences.
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY)
      if (isTheme(stored)) return stored
    } catch {
      // Private windows and blocked site data both throw here. Not a reason
      // to render an unthemed application.
    }
    return DEFAULT
  })

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    // Canvas and SVG read their colours through the runtime API, which caches
    // per theme — the cache has to go before anything repaints.
    resetColorCache()
  }, [theme])

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next)
    try {
      localStorage.setItem(STORAGE_KEY, next)
    } catch {
      // Preference is lost on reload; the application still works.
    }
  }, [])

  const value = useMemo(() => ({ theme, setTheme }), [theme, setTheme])
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme() {
  return useContext(ThemeContext)
}
