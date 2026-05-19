/**
 * Shared formatting utilities for file sizes and durations.
 * Centralises helpers that were previously duplicated across multiple components.
 */

/** Format a byte count as a human-readable string (B / KB / MB / GB). */
export function fmtBytes(n: number | null | undefined): string {
  if (n == null) return '—'
  if (n === 0)   return '0 B'
  if (n < 1_024)           return `${n} B`
  if (n < 1_024 ** 2)      return `${(n / 1_024).toFixed(1)} KB`
  if (n < 1_024 ** 3)      return `${(n / 1_024 ** 2).toFixed(1)} MB`
  return `${(n / 1_024 ** 3).toFixed(2)} GB`
}

/** Format a duration in seconds as a compact string (e.g. "3s", "2m 14s", "5m"). */
export function fmtDuration(s: number): string {
  if (s < 60) return `${s}s`
  const m   = Math.floor(s / 60)
  const rem = s % 60
  return rem > 0 ? `${m}m ${rem}s` : `${m}m`
}

/**
 * Build and trigger a CSV download in the browser.
 * Values are double-quoted and inner quotes are escaped (RFC 4180).
 */
export function exportCsv(filename: string, headers: string[], rows: (string | number | boolean | null | undefined)[][]): void {
  const esc = (v: string | number | boolean | null | undefined): string => {
    const s = v == null ? '' : String(v)
    return `"${s.replace(/"/g, '""')}"`
  }
  const lines = [
    headers.map(esc).join(','),
    ...rows.map(r => r.map(esc).join(',')),
  ]
  const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' })
  const url  = URL.createObjectURL(blob)
  const a    = Object.assign(document.createElement('a'), { href: url, download: filename })
  a.click()
  URL.revokeObjectURL(url)
}

/**
 * Defang an IOC value for safe sharing (DFIR convention).
 *  - ip     : 192.168.1.1   → 192[.]168[.]1[.]1
 *  - domain : evil.com       → evil[.]com
 *  - url    : http://evil.com/path → hxxp://evil[.]com/path
 * Other types are returned unchanged.
 */
export function defang(value: string, type: string): string {
  const dotReplace = (s: string) => s.replace(/\./g, '[.]')
  if (type === 'ip' || type === 'domain') return dotReplace(value)
  if (type === 'url') {
    return value
      .replace(/^https/i, 'hxxps')
      .replace(/^http/i,  'hxxp')
      .replace(/\./g, '[.]')
  }
  return value
}
