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

import {
  CellContextMenu, parseProcessId, pivotRange, pivotRql, processFocus,
  type CellTarget,
} from '../CellContextMenu'

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

// ─── Lineage ──────────────────────────────────────────────────────────────────
// The process tree stopped being a case tab and became a question asked of a
// row. What has to be right is reading the process id out of that row: event
// logs disagree about how they write one, and reading hex as decimal gives a
// number that is entirely plausible and entirely wrong.

describe('parseProcessId', () => {
  it('reads the base the log wrote', () => {
    expect(parseProcessId('0x1a2c')).toBe(6700)   // Security 4688
    expect(parseProcessId('6700')).toBe(6700)     // Sysmon
    expect(parseProcessId('0X1A2C')).toBe(6700)
  })

  it('refuses anything that is not a process id', () => {
    for (const value of ['', '   ', 'nonsense', '12ab', '-4']) {
      expect(parseProcessId(value)).toBeNull()
    }
  })
})

describe('processFocus', () => {
  const ROW = {
    TimeCreated: '2026-01-01 10:00:00',
    NewProcessId: '0xc8',
    NewProcessName: 'C:\\Windows\\System32\\cmd.exe',
    ProcessGuid: '{B}',
  }

  const at = (column: string, value: string) =>
    AT({ column, value, row: ROW, dateColumn: 'TimeCreated' })

  it('identifies a process by GUID when the log wrote one', () => {
    expect(processFocus(at('ProcessGuid', '{B}'))).toEqual({ guid: '{B}' })
  })

  it('identifies a process by id, dated by the row it sits in', () => {
    /* The date is what tells two processes that reused a PID apart. */
    expect(processFocus(at('NewProcessId', '0xc8'))).toEqual({
      pid: 200,
      at: '2026-01-01 10:00:00',
      image: 'C:\\Windows\\System32\\cmd.exe',
    })
  })

  it('offers nothing on a column that does not name a process', () => {
    expect(processFocus(at('Computer', 'WS01'))).toBeNull()
  })

  it('offers nothing when the cell holds no usable id', () => {
    expect(processFocus(at('NewProcessId', '-'))).toBeNull()
    expect(processFocus(at('ProcessGuid', '  '))).toBeNull()
  })

  it('works on a parent column too', () => {
    /* "What started this" is asked as often as "what is this". */
    expect(processFocus(at('ParentProcessId', '0x64'))).toMatchObject({ pid: 100 })
  })
})

describe('the lineage menu item', () => {
  const ROW = { TimeCreated: '2026-01-01 10:00:00', ProcessGuid: '{B}' }

  it('is offered on a process column when the page can open a tree', () => {
    const onProcessTree = vi.fn()
    render(
      <CellContextMenu
        target={AT({ column: 'ProcessGuid', value: '{B}', row: ROW })}
        onFilter={vi.fn()} onPivot={vi.fn()} onProcessTree={onProcessTree}
        onClose={() => {}}
      />,
    )

    expect(screen.getByRole('menuitem', { name: /Process tree around this/ }))
      .toBeInTheDocument()
  })

  it('is absent on a column that names no process', () => {
    render(
      <CellContextMenu
        target={AT({ column: 'Computer', value: 'WS01' })}
        onFilter={vi.fn()} onPivot={vi.fn()} onProcessTree={vi.fn()}
        onClose={() => {}}
      />,
    )

    expect(screen.queryByText(/Process tree/)).not.toBeInTheDocument()
  })

  it('hands back the focus, not the raw cell', async () => {
    const onProcessTree = vi.fn()
    render(
      <CellContextMenu
        target={AT({ column: 'ProcessGuid', value: '{B}', row: ROW })}
        onFilter={vi.fn()} onPivot={vi.fn()} onProcessTree={onProcessTree}
        onClose={() => {}}
      />,
    )

    await userEvent.click(screen.getByRole('menuitem', { name: /Process tree around this/ }))

    expect(onProcessTree).toHaveBeenCalledWith({ guid: '{B}' })
  })
})
