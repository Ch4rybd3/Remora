/**
 * Runtime access to the design tokens.
 *
 * Tailwind covers everything expressed as a class. It cannot reach the places
 * that need a colour as a *value*: ReactFlow node and edge styling, SVG stroke
 * attributes, canvas rendering for the playbook export, inline chart segments.
 * Those were the last holdouts holding literal hex, which meant the graphs
 * stayed dark-themed while the rest of the product switched.
 *
 * `color()` reads the CSS variable off the document element, so it returns
 * whatever the active theme resolves to. Results are cached per theme and the
 * cache is dropped when the theme attribute changes.
 */

type TokenName =
  | '--surface-canvas' | '--surface-panel' | '--surface-overlay' | '--surface-hover'
  | '--text-primary' | '--text-secondary' | '--text-muted' | '--text-inverse'
  | '--accent' | '--accent-hover' | '--accent-contrast'
  | '--border-hairline' | '--border-strong' | '--border-focus'
  | '--severity-critical' | '--severity-high' | '--severity-medium' | '--severity-low' | '--severity-info'
  | '--status-open' | '--status-in-progress' | '--status-closed' | '--status-archived'
  | '--data-1' | '--data-2' | '--data-3' | '--data-4' | '--data-5' | '--data-6'

let cache = new Map<string, string>()
let cachedTheme: string | null = null

function currentTheme(): string {
  if (typeof document === 'undefined') return 'dark'
  return document.documentElement.dataset.theme ?? 'dark'
}

/** Resolved colour for a token, as `rgb(r g b)`. Optional alpha 0–1. */
export function color(name: TokenName, alpha?: number): string {
  const theme = currentTheme()
  if (theme !== cachedTheme) {
    cache = new Map()
    cachedTheme = theme
  }
  const key = `${name}|${alpha ?? 1}`
  const hit = cache.get(key)
  if (hit) return hit

  let channels = ''
  if (typeof document !== 'undefined') {
    channels = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  }
  // A missing variable must not paint an invisible element: fall back to the
  // dark palette rather than to `transparent`.
  if (!channels) channels = FALLBACK[name]

  const value = alpha === undefined ? `rgb(${channels})` : `rgb(${channels} / ${alpha})`
  cache.set(key, value)
  return value
}

/** Drop the cache — called by the theme provider after switching. */
export function resetColorCache(): void {
  cache = new Map()
  cachedTheme = null
}

/** Semantic shorthands, so call sites read as intent rather than as tokens. */
export const palette = {
  canvas:    () => color('--surface-canvas'),
  panel:     () => color('--surface-panel'),
  overlay:   () => color('--surface-overlay'),
  fg:        () => color('--text-primary'),
  fgMuted:   () => color('--text-muted'),
  accent:    () => color('--accent'),
  hairline:  () => color('--border-hairline'),
  severity: {
    critical: () => color('--severity-critical'),
    high:     () => color('--severity-high'),
    medium:   () => color('--severity-medium'),
    low:      () => color('--severity-low'),
    info:     () => color('--severity-info'),
  },
  status: {
    open:         () => color('--status-open'),
    in_progress:  () => color('--status-in-progress'),
    closed:       () => color('--status-closed'),
    archived:     () => color('--status-archived'),
  },
  /** Categorical encoding — kinds, not ranks. Wraps at six. */
  data: (index: number) =>
    color(`--data-${(Math.abs(index) % 6) + 1}` as TokenName),
} as const

const FALLBACK: Record<string, string> = {
  '--surface-canvas': '11 18 31',
  '--surface-panel': '14 22 34',
  '--surface-overlay': '19 28 43',
  '--surface-hover': '20 30 46',
  '--text-primary': '230 237 245',
  '--text-secondary': '163 179 188',
  '--text-muted': '107 124 137',
  '--text-inverse': '4 18 26',
  '--accent': '45 212 191',
  '--accent-hover': '34 181 162',
  '--accent-contrast': '4 18 26',
  '--border-hairline': '27 38 53',
  '--border-strong': '42 54 72',
  '--border-focus': '45 212 191',
  '--severity-critical': '255 62 62',
  '--severity-high': '255 140 0',
  '--severity-medium': '255 215 0',
  '--severity-low': '0 191 255',
  '--severity-info': '163 179 188',
  '--status-open': '45 212 191',
  '--status-in-progress': '255 215 0',
  '--status-closed': '163 179 188',
  '--status-archived': '107 114 128',
  '--data-1': '122 162 247',
  '--data-2': '187 154 247',
  '--data-3': '247 118 142',
  '--data-4': '224 175 104',
  '--data-5': '125 207 255',
  '--data-6': '158 206 106',
}
