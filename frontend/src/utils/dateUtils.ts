/**
 * Centralised date/time formatting for Remora.
 *
 * All display functions respect the globally selected timezone (default UTC).
 * Call setTimezone() from TimezoneContext to change it across the whole app.
 *
 * UTC is strongly recommended for forensic work — non-UTC display is supported
 * but labelled with a warning in the UI.
 */
import { formatDistanceToNow } from 'date-fns'

// ── Module-level timezone state ───────────────────────────────────────────────
// Mutated by TimezoneContext; all helpers below read _tz at call time.

let _tz = 'UTC'

export function setTimezone(tz: string): void { _tz = tz }
export function getTimezone(): string         { return _tz }

// ── Internal helpers ──────────────────────────────────────────────────────────

type Parts = Record<string, string>

function dtParts(d: Date, extra: Intl.DateTimeFormatOptions = {}): Parts {
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone:  _tz,
    hourCycle: 'h23',
    ...extra,
  })
  return Object.fromEntries(fmt.formatToParts(d).map(({ type, value }) => [type, value]))
}

/** Short timezone abbreviation for the current date (e.g. "UTC", "CET", "EST"). */
function tzLabel(d: Date): string {
  if (_tz === 'UTC') return 'UTC'
  try {
    const parts = new Intl.DateTimeFormat('en', {
      timeZone:    _tz,
      timeZoneName: 'short',
    }).formatToParts(d)
    return parts.find(p => p.type === 'timeZoneName')?.value ?? _tz
  } catch {
    return _tz
  }
}

function safe<T>(fn: () => T, fallback: T): T {
  try { return fn() } catch { return fallback }
}

// ── Display helpers ───────────────────────────────────────────────────────────

/** Full forensic timestamp: 2026-05-13 14:32:45 UTC */
export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return String(iso)
  return safe(() => {
    const p = dtParts(d, {
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    })
    return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second} ${tzLabel(d)}`
  }, String(iso))
}

/** Short human-readable datetime: 13 May 2026 14:32 UTC */
export function fmtDateTimeShort(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return String(iso)
  return safe(() => {
    const p = dtParts(d, {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    })
    return `${p.day} ${p.month} ${p.year} ${p.hour}:${p.minute} ${tzLabel(d)}`
  }, String(iso))
}

/** Date only (no time, no tz): 13 May 2026 */
export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return String(iso)
  return safe(() => {
    const p = dtParts(d, { day: '2-digit', month: 'short', year: 'numeric' })
    return `${p.day} ${p.month} ${p.year}`
  }, String(iso))
}

/** Compact for dense artifact tables (no year, no tz label): 05-13 14:32:45 */
export function fmtCompact(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return String(iso)
  return safe(() => {
    const p = dtParts(d, {
      month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    })
    return `${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`
  }, String(iso))
}

/** Compact without seconds: 05-13 14:32 */
export function fmtCompactShort(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return String(iso)
  return safe(() => {
    const p = dtParts(d, {
      month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit',
    })
    return `${p.month}-${p.day} ${p.hour}:${p.minute}`
  }, String(iso))
}

/** Compact with milliseconds for high-precision logs: 05-13 14:32:45.123
 *  Milliseconds are timezone-independent (offsets are always whole minutes). */
export function fmtCompactMs(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return String(iso)
  const ms = String(d.getUTCMilliseconds()).padStart(3, '0')
  return `${fmtCompact(iso)}.${ms}`
}

/** Relative time: "5 minutes ago" — always timezone-independent. */
export function fmtRelative(iso: string | null | undefined): string {
  if (!iso) return '—'
  try { return formatDistanceToNow(new Date(iso), { addSuffix: true }) } catch { return String(iso) }
}

/** Time only (HH:mm) in the selected timezone — for dashboard last-updated. */
export function fmtTimeOnly(ts: string | number | null | undefined): string {
  if (ts == null) return '—'
  const d = new Date(ts as string | number)
  if (isNaN(d.getTime())) return '—'
  return safe(() => {
    const p = dtParts(d, { hour: '2-digit', minute: '2-digit' })
    return `${p.hour}:${p.minute}`
  }, '—')
}

// ── File-name helpers (always UTC regardless of display timezone) ─────────────

/** ISO date-stamp for file names: "20260513" — always UTC. */
export function fmtDateStamp(iso?: string | null): string {
  const d = new Date(iso ?? Date.now())
  if (isNaN(d.getTime())) return ''
  return [
    String(d.getUTCFullYear()).padStart(4, '0'),
    String(d.getUTCMonth() + 1).padStart(2, '0'),
    String(d.getUTCDate()).padStart(2, '0'),
  ].join('')
}

// ── Artifact timestamp parsing ────────────────────────────────────────────────

/**
 * Parse a raw artifact timestamp string (e.g. "2024-07-15 14:30:00") that is in
 * `sourceTz` and return the equivalent UTC ISO string.
 *
 * If `sourceTz` is null/undefined/"UTC", treats the string as already UTC.
 * If the string already contains timezone info (Z / +HH:mm), uses it as-is.
 *
 * The algorithm avoids external deps by using Intl.DateTimeFormat to resolve the
 * UTC offset at the given approximate time, then correcting the initial UTC guess.
 */
export function parseArtifactTimestamp(raw: string, sourceTz?: string | null): string {
  if (!raw) return new Date().toISOString()

  // Normalize separators, then expand a bare hour offset to a full one:
  // DuckDB renders real TIMESTAMPTZ columns as "2025-07-31 22:13:20+00",
  // which Date() rejects. Without this the value silently became "now".
  const normalized = raw.trim()
    .replace(' ', 'T')
    .replace(/([+-]\d{2})$/, '$1:00')

  // Check if the string already carries timezone info
  const hasOffset = /Z$|[+-]\d{2}:?\d{2}$/.test(normalized)

  if (hasOffset || !sourceTz || sourceTz === 'UTC') {
    try {
      const d = new Date(hasOffset ? normalized : normalized + 'Z')
      if (!isNaN(d.getTime())) return d.toISOString()
    } catch { /* fall through */ }
    return new Date().toISOString()
  }

  // Parse the local timestamp as if it were UTC (our initial guess)
  const asUtcMs = (() => {
    try {
      const d = new Date(normalized + 'Z')
      return isNaN(d.getTime()) ? null : d.getTime()
    } catch { return null }
  })()
  if (asUtcMs === null) return new Date().toISOString()

  // Format our UTC guess in the source timezone to get the local-time representation
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: sourceTz,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hour12: false,
    }).formatToParts(new Date(asUtcMs))

    const p: Record<string, string> = {}
    parts.forEach(part => { p[part.type] = part.value })

    // What UTC ms corresponds to the local-time display of our guess?
    const tzLocalMs = Date.UTC(
      parseInt(p.year), parseInt(p.month) - 1, parseInt(p.day),
      parseInt(p.hour === '24' ? '0' : p.hour), parseInt(p.minute), parseInt(p.second)
    )

    // offset = asUtcMs - tzLocalMs  (negative when tz is ahead of UTC, e.g. UTC+2 → -2h)
    const offsetMs = asUtcMs - tzLocalMs

    // True UTC = treat-as-UTC guess adjusted by offset
    return new Date(asUtcMs + offsetMs).toISOString()
  } catch {
    return new Date(asUtcMs).toISOString()
  }
}

// ── Form helpers ──────────────────────────────────────────────────────────────

/**
 * Convert an ISO UTC string to the value expected by <input type="datetime-local">.
 * Always uses UTC so that form values stay unambiguous regardless of display timezone.
 */
export function toInputValue(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  return d.toISOString().slice(0, 16)   // "YYYY-MM-DDTHH:mm" in UTC
}

/**
 * Convert a datetime-local input value (treated as UTC) back to an ISO string.
 */
export function inputToIso(localVal: string): string {
  if (!localVal) return new Date().toISOString()
  return `${localVal}:00.000Z`
}
