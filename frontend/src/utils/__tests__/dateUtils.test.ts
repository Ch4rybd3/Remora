import { afterEach, describe, expect, it } from 'vitest'

import { fmtDate, fmtDateTime, getTimezone, setTimezone } from '../dateUtils'

afterEach(() => setTimezone('UTC'))

const NOON_UTC = '2026-05-13T14:32:45Z'

describe('timezone state', () => {
  it('defaults to UTC', () => {
    expect(getTimezone()).toBe('UTC')
  })

  it('is readable after being set', () => {
    setTimezone('Europe/Paris')
    expect(getTimezone()).toBe('Europe/Paris')
  })
})

describe('fmtDateTime', () => {
  it('renders a forensic timestamp with an explicit zone', () => {
    expect(fmtDateTime(NOON_UTC)).toBe('2026-05-13 14:32:45 UTC')
  })

  it('shifts the displayed time when the timezone changes', () => {
    setTimezone('Europe/Paris')
    const out = fmtDateTime(NOON_UTC)
    // Paris is UTC+2 in May.
    expect(out).toContain('16:32:45')
    expect(out).not.toContain('UTC')
  })

  it('always labels the zone, so a bare time can never be misread', () => {
    setTimezone('America/New_York')
    expect(fmtDateTime(NOON_UTC)).toMatch(/\d{2}:\d{2}:\d{2}\s+\S+$/)
  })

  it.each([null, undefined, ''])('renders %s as an em dash', (input) => {
    expect(fmtDateTime(input)).toBe('—')
  })

  it('returns unparseable input verbatim rather than inventing a date', () => {
    expect(fmtDateTime('not-a-date')).toBe('not-a-date')
  })
})

describe('fmtDate', () => {
  // Note: fmtDate renders "13 May 2026" while fmtDateTime renders
  // "2026-05-13 14:32:45 UTC". docs/CONVENTIONS.md section 6 requires the ISO
  // form everywhere. The tests below pin current behaviour so the S13 design
  // pass changes it deliberately rather than by accident.
  it('renders a day-precision date', () => {
    expect(fmtDate(NOON_UTC)).toBe('13 May 2026')
  })

  it('can cross a day boundary with the timezone', () => {
    setTimezone('Pacific/Auckland')
    // 14:32 UTC on the 13th is already the 14th in Auckland.
    expect(fmtDate(NOON_UTC)).toBe('14 May 2026')
  })
})
