/**
 * The right-click pivot.
 *
 * The arithmetic is what matters here. A menu item that silently computes the
 * wrong window returns a plausible set of rows around the wrong instant, and
 * an analyst reading "±15 seconds" has no way to notice - which is the failure
 * mode worth testing rather than the rendering.
 */
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { CellContextMenu, pivotRange, pivotRql, type CellTarget } from '../CellContextMenu'

const AT = (over: Partial<CellTarget> = {}): CellTarget => ({
  x: 10, y: 10, column: 'Process', value: 'cmd.exe', isDate: false, ...over,
})

function open(target: CellTarget) {
  const onFilter = vi.fn()
  const onPivot  = vi.fn()
  render(
    <CellContextMenu target={target} onFilter={onFilter} onPivot={onPivot} onClose={() => {}} />,
  )
  return { onFilter, onPivot }
}

// ─── The window ───────────────────────────────────────────────────────────────

describe('pivotRange', () => {
  it('widens a timestamp by the same amount either side', () => {
    expect(pivotRange('2026-01-01 10:00:00', 15))
      .toEqual(['2026-01-01 09:59:45', '2026-01-01 10:00:15'])
  })

  it('crosses a minute, an hour and a day correctly', () => {
    expect(pivotRange('2026-01-01 00:00:05', 15))
      .toEqual(['2025-12-31 23:59:50', '2026-01-01 00:00:20'])
  })

  it('reads a bare timestamp as UTC', () => {
    /*
     * The store converts an artifact that declares a source timezone before
     * the value ever reaches the table, so what is on screen is already UTC.
     * Reading it as browser-local would shift every pivot by the analyst's own
     * offset - invisibly, and differently for each analyst.
     */
    expect(pivotRange('2026-06-01 12:00:00', 60))
      .toEqual(['2026-06-01 11:59:00', '2026-06-01 12:01:00'])
  })

  it('accepts the ISO form as well as the spaced one', () => {
    expect(pivotRange('2026-01-01T10:00:00', 15))
      .toEqual(pivotRange('2026-01-01 10:00:00', 15))
  })

  it('honours an explicit zone when the value carries one', () => {
    expect(pivotRange('2026-01-01T11:00:00+01:00', 0))
      .toEqual(['2026-01-01 10:00:00', '2026-01-01 10:00:00'])
  })

  it('refuses a value that is not a timestamp', () => {
    /* A date column in a real collection is only mostly dates. */
    expect(pivotRange('not a timestamp', 15)).toBeNull()
    expect(pivotRange('', 15)).toBeNull()
  })
})

describe('pivotRql', () => {
  it('quotes the bounds, because a timestamp holds a space', () => {
    expect(pivotRql('Timestamp', ['2026-01-01 09:59:45', '2026-01-01 10:00:15']))
      .toBe('Timestamp BETWEEN "2026-01-01 09:59:45" AND "2026-01-01 10:00:15"')
  })
})

// ─── The menu ─────────────────────────────────────────────────────────────────

describe('CellContextMenu', () => {
  it('offers the four filter modes on any cell', async () => {
    open(AT())

    for (const label of ['Equals', 'Does not equal', 'Contains', 'Does not contain']) {
      expect(screen.getByRole('menuitem', { name: new RegExp(label) })).toBeInTheDocument()
    }
  })

  it('files the clicked value under the clicked column', async () => {
    const { onFilter } = open(AT({ column: 'CommandLine', value: 'powershell -enc' }))

    await userEvent.click(screen.getByRole('menuitem', { name: /Does not contain/ }))

    expect(onFilter).toHaveBeenCalledWith('CommandLine', '!contains', 'powershell -enc')
  })

  it('offers no time pivot on a column that is not the event time', () => {
    open(AT())

    expect(screen.queryByText(/Around this moment/)).not.toBeInTheDocument()
  })

  it('offers the pivots on the event-time column', () => {
    open(AT({ column: 'Timestamp', value: '2026-01-01 10:00:00', isDate: true }))

    expect(screen.getByRole('menuitem', { name: /15 seconds/ })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: /15 minutes/ })).toBeInTheDocument()
  })

  it('hands back a range, not a raw timestamp', async () => {
    const { onPivot } = open(
      AT({ column: 'Timestamp', value: '2026-01-01 10:00:00', isDate: true }))

    await userEvent.click(screen.getByRole('menuitem', { name: /15 seconds/ }))

    expect(onPivot).toHaveBeenCalledWith(
      'Timestamp BETWEEN "2026-01-01 09:59:45" AND "2026-01-01 10:00:15"')
  })

  it('offers no pivot when the date cell does not parse', () => {
    /* Better than a range around an invented instant. */
    open(AT({ column: 'Timestamp', value: 'malformed', isDate: true }))

    expect(screen.queryByText(/Around this moment/)).not.toBeInTheDocument()
  })

  it('says so rather than offering a filter on nothing', () => {
    open(AT({ value: '   ' }))

    expect(screen.getByText(/Nothing to filter on/)).toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: /Equals/ })).not.toBeInTheDocument()
  })
})
