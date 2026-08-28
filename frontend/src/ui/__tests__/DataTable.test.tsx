import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { DataTable, type Column } from '../DataTable'

interface Row { id: string; host: string; severity: string }

const ROWS: Row[] = [
  { id: '1', host: 'DC-01',        severity: 'critical' },
  { id: '2', host: 'WORKSTATION',  severity: 'low' },
]

const COLUMNS: Column<Row>[] = [
  { key: 'host',     header: 'Host',     render: (r) => r.host, sortable: true },
  { key: 'severity', header: 'Severity', render: (r) => r.severity },
]

const table = (props: Partial<React.ComponentProps<typeof DataTable<Row>>> = {}) =>
  render(<DataTable rows={ROWS} columns={COLUMNS} rowKey={(r) => r.id} {...props} />)

describe('DataTable', () => {
  it('renders a header per column and a row per record', () => {
    table()
    expect(screen.getByText('Host')).toBeInTheDocument()
    expect(screen.getByText('Severity')).toBeInTheDocument()
    expect(screen.getByText('DC-01')).toBeInTheDocument()
    expect(screen.getByText('WORKSTATION')).toBeInTheDocument()
  })

  it('shows the empty message rather than an empty frame', () => {
    render(<DataTable rows={[]} columns={COLUMNS} rowKey={(r: Row) => r.id} empty="No event" />)
    expect(screen.getByText('No event')).toBeInTheDocument()
  })

  it('renders skeleton rows while loading, not a text placeholder', () => {
    const { container } = table({ loading: true })
    expect(screen.queryByText('DC-01')).not.toBeInTheDocument()
    expect(screen.queryByText(/loading/i)).not.toBeInTheDocument()
    expect(container.querySelectorAll('tbody tr').length).toBeGreaterThan(1)
  })

  it('calls back when a row is clicked', async () => {
    const onRowClick = vi.fn()
    table({ onRowClick })
    await userEvent.click(screen.getByText('DC-01'))
    expect(onRowClick).toHaveBeenCalledWith(ROWS[0])
  })

  it('marks the selected row for assistive technology', () => {
    table({ isRowSelected: (r) => r.id === '2' })
    const selected = screen.getByText('WORKSTATION').closest('tr')
    expect(selected).toHaveAttribute('aria-selected', 'true')
  })
})

describe('DataTable — the pin column', () => {
  // docs/UI_PATTERNS.md: the pin is the first, leftmost column of every
  // forensic table, and clicking it must never open the row it sits on.
  const leading = { render: (r: Row) => <button>pin {r.host}</button> }

  it('renders the pin as the first cell of the row', () => {
    const { container } = table({ leading })
    const firstRow = container.querySelectorAll('tbody tr')[0]
    const firstCell = within(firstRow as HTMLElement).getAllByRole('cell')[0]
    expect(within(firstCell).getByText('pin DC-01')).toBeInTheDocument()
  })

  it('does not open the row when the pin is clicked', async () => {
    const onRowClick = vi.fn()
    table({ leading, onRowClick })
    await userEvent.click(screen.getByText('pin DC-01'))
    expect(onRowClick).not.toHaveBeenCalled()
  })

  it('still opens the row when a normal cell is clicked', async () => {
    const onRowClick = vi.fn()
    table({ leading, onRowClick })
    await userEvent.click(screen.getByText('DC-01'))
    expect(onRowClick).toHaveBeenCalledTimes(1)
  })
})

describe('DataTable — trailing actions', () => {
  const trailing = { render: (r: Row) => <button>delete {r.host}</button> }

  it('does not open the row when an action is clicked', async () => {
    const onRowClick = vi.fn()
    table({ trailing, onRowClick })
    await userEvent.click(screen.getByText('delete DC-01'))
    expect(onRowClick).not.toHaveBeenCalled()
  })
})

describe('DataTable — sorting', () => {
  it('reports the sorted column and its direction', () => {
    table({ sort: { key: 'host', dir: 'asc' }, onSortChange: vi.fn() })
    expect(screen.getByText('Host').closest('th')).toHaveAttribute('aria-sort', 'ascending')
  })

  it('advertises a sortable column that is not currently sorted', () => {
    table({ sort: { key: 'severity', dir: 'asc' }, onSortChange: vi.fn() })
    expect(screen.getByText('Host').closest('th')).toHaveAttribute('aria-sort', 'none')
  })

  it('does not advertise sortability on a column that has none', () => {
    // aria-sort on a header that cannot be sorted tells a screen reader an
    // interaction exists when it does not.
    table({ sort: { key: 'host', dir: 'asc' }, onSortChange: vi.fn() })
    expect(screen.getByText('Severity').closest('th')).not.toHaveAttribute('aria-sort')
  })

  it('sorts ascending on first click', async () => {
    const onSortChange = vi.fn()
    table({ sort: null, onSortChange })
    await userEvent.click(screen.getByText('Host'))
    expect(onSortChange).toHaveBeenCalledWith({ key: 'host', dir: 'asc' })
  })

  it('flips the direction when the sorted column is clicked again', async () => {
    const onSortChange = vi.fn()
    table({ sort: { key: 'host', dir: 'asc' }, onSortChange })
    await userEvent.click(screen.getByText('Host'))
    expect(onSortChange).toHaveBeenCalledWith({ key: 'host', dir: 'desc' })
  })

  it('leaves non-sortable headers inert', async () => {
    const onSortChange = vi.fn()
    table({ onSortChange })
    await userEvent.click(screen.getByText('Severity'))
    expect(onSortChange).not.toHaveBeenCalled()
  })
})

describe('DataTable — expanded rows', () => {
  it('renders detail beneath its own row, spanning every column', () => {
    const { container } = table({
      renderExpanded: (r) => (r.id === '1' ? <p>raw record</p> : null),
      leading: { render: () => <span>pin</span> },
    })
    expect(screen.getByText('raw record')).toBeInTheDocument()

    const detailCell = screen.getByText('raw record').closest('td')
    // leading + 2 columns
    expect(detailCell).toHaveAttribute('colspan', '3')

    const rows = container.querySelectorAll('tbody tr')
    expect(rows[1]).toContainElement(screen.getByText('raw record'))
  })

  it('renders nothing extra when no row is expanded', () => {
    const { container } = table({ renderExpanded: () => null })
    expect(container.querySelectorAll('tbody tr')).toHaveLength(ROWS.length)
  })
})

describe('DataTable — responsive', () => {
  it('drops a column below its breakpoint instead of squeezing every column', () => {
    render(
      <DataTable
        rows={ROWS}
        columns={[{ key: 'host', header: 'Host', render: (r: Row) => r.host, hideBelow: 'lg' }]}
        rowKey={(r: Row) => r.id}
      />,
    )
    expect(screen.getByText('Host').closest('th')?.className).toContain('lg:table-cell')
  })
})
