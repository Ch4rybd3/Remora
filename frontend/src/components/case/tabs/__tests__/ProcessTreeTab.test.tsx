import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ProcessNode, ProcessTree } from '../../../../api/processTree'
import ProcessTreeTab from '../ProcessTreeTab'

/**
 * A process tree is read as a set of claims. The thing this component must not
 * do is present an edge matched on a reused process id the same way it
 * presents one Sysmon asserted.
 */

const get = vi.fn()

vi.mock('../../../../api/processTree', () => ({
  processTreeApi: { get: (...a: unknown[]) => get(...a) },
}))

vi.mock('../../../custody/CustodyActions', () => ({
  CopyableName: ({ value }: { value: string }) => <span>{value}</span>,
}))

function node(overrides: Partial<ProcessNode> = {}): ProcessNode {
  return {
    key: 'k1', pid: 100, guid: null, image: 'C:\\Windows\\explorer.exe',
    name: 'explorer.exe', command_line: '', user: 'fsali', integrity: '',
    computer: 'WS01', started: '2026-03-01T09:00:00', ended: null,
    parent_key: null, parent_pid: null, parent_image: '', parent_name: '',
    link: 'orphan', sources: ['security:4688'], corroboration: [],
    ...overrides,
  }
}

function tree(nodes: ProcessNode[], stats: Partial<ProcessTree['stats']> = {}): ProcessTree {
  const links = nodes.map((n) => n.link)
  return {
    root: '__root__',
    nodes,
    stats: {
      processes: nodes.length, events: nodes.length,
      asserted: links.filter((l) => l === 'asserted').length,
      inferred: links.filter((l) => l === 'inferred').length,
      orphans: links.filter((l) => l === 'orphan').length,
      from_sysmon: 0, from_security: nodes.length, corroborated: 0,
      truncated: false, ...stats,
    },
  }
}

function renderTab() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <ProcessTreeTab caseId="case-1" />
    </QueryClientProvider>,
  )
}

describe('ProcessTreeTab', () => {
  beforeEach(() => {
    get.mockReset().mockResolvedValue(tree([node()]))
  })

  it('labels every edge with how it was established', async () => {
    // The whole point. A tree built from 4688 alone is a set of guesses matched
    // on reused process ids, and showing it like Sysmon's asserted lineage
    // would overstate what the logs support.
    get.mockResolvedValue(tree([
      node({ key: 'a', name: 'explorer.exe', link: 'orphan' }),
      node({ key: 'b', name: 'cmd.exe', parent_key: 'a', link: 'asserted' }),
      node({ key: 'c', name: 'powershell.exe', parent_key: 'a', link: 'inferred' }),
    ]))
    renderTab()

    expect(await screen.findByText('asserted')).toBeInTheDocument()
    expect(screen.getByText('inferred')).toBeInTheDocument()
    expect(screen.getByText('orphan')).toBeInTheDocument()
  })

  it('counts the inferred and orphaned edges above the tree', async () => {
    // Before reading any edge, an analyst needs to know how many of them are
    // inference.
    get.mockResolvedValue(tree([
      node({ key: 'a', link: 'asserted' }),
      node({ key: 'b', name: 'cmd.exe', link: 'inferred' }),
      node({ key: 'c', name: 'rundll32.exe', link: 'orphan' }),
    ]))
    renderTab()

    expect(await screen.findByText('1 asserted')).toBeInTheDocument()
    expect(screen.getByText('1 inferred')).toBeInTheDocument()
    expect(screen.getByText('1 orphaned')).toBeInTheDocument()
  })

  it('nests a child under its parent', async () => {
    get.mockResolvedValue(tree([
      node({ key: 'a', name: 'explorer.exe' }),
      node({ key: 'b', name: 'cmd.exe', parent_key: 'a', link: 'asserted' }),
    ]))
    renderTab()

    const child = await screen.findByText('cmd.exe')
    const parent = screen.getByText('explorer.exe')
    // The child is indented further than its parent.
    const indent = (el: HTMLElement) =>
      parseInt((el.closest('[style]') as HTMLElement).style.paddingLeft, 10)
    expect(indent(child)).toBeGreaterThan(indent(parent))
  })

  it('collapses a branch without losing it', async () => {
    get.mockResolvedValue(tree([
      node({ key: 'a', name: 'explorer.exe' }),
      node({ key: 'b', name: 'cmd.exe', parent_key: 'a', link: 'asserted' }),
    ]))
    renderTab()

    await userEvent.click(await screen.findByLabelText('Collapse explorer.exe'))
    expect(screen.queryByText('cmd.exe')).not.toBeInTheDocument()

    await userEvent.click(screen.getByLabelText('Expand explorer.exe'))
    expect(screen.getByText('cmd.exe')).toBeInTheDocument()
  })

  it('keeps the ancestors of a match when filtering', async () => {
    // A match shown without its lineage is a match with the answer removed.
    get.mockResolvedValue(tree([
      node({ key: 'a', name: 'explorer.exe' }),
      node({ key: 'b', name: 'powershell.exe', parent_key: 'a', link: 'asserted' }),
      node({ key: 'c', name: 'notepad.exe', parent_key: 'a', link: 'asserted' }),
    ]))
    renderTab()

    await userEvent.type(
      await screen.findByPlaceholderText(/Filter by name/), 'powershell')

    expect(screen.getByText('powershell.exe')).toBeInTheDocument()
    expect(screen.getByText('explorer.exe')).toBeInTheDocument()
    expect(screen.queryByText('notepad.exe')).not.toBeInTheDocument()
  })

  it('opens a process into its detail without leaving the tree', async () => {
    get.mockResolvedValue(tree([node({
      key: 'a', name: 'cmd.exe', command_line: 'cmd.exe /c whoami',
      sources: ['sysmon:1'], link: 'asserted',
    })]))
    renderTab()

    await userEvent.click(await screen.findByText('cmd.exe'))

    // The command line shows twice on purpose - truncated on the row, in full
    // in the detail - so this asserts the detail pane's copy specifically.
    const detail = screen.getByText('Command line').closest('div')!
    expect(within(detail).getByText('cmd.exe /c whoami')).toBeInTheDocument()
    expect(screen.getByText('sysmon:1')).toBeInTheDocument()
  })

  it('says a truncated tree is not the whole tree', async () => {
    get.mockResolvedValue(tree([node()], { truncated: true }))
    renderTab()

    expect(await screen.findByText(/not the\s+whole tree/)).toBeInTheDocument()
  })

  it('explains what is missing when there are no process events', async () => {
    get.mockResolvedValue(tree([]))
    renderTab()

    expect(await screen.findByText(/No process creation events/)).toBeInTheDocument()
    // The thing an analyst cannot infer from an empty screen.
    expect(screen.getByText(/4688 is off by default/)).toBeInTheDocument()
  })

  it('shows corroboration as corroboration, not as lineage', async () => {
    get.mockResolvedValue(tree([
      node({ key: 'a', name: 'evil.exe', corroboration: ['Prefetch'] }),
    ]))
    renderTab()

    const row = (await screen.findByText('evil.exe')).closest('div')!
    expect(within(row).getByText('Prefetch')).toBeInTheDocument()
    // It did not become an edge.
    expect(within(row).getByText('orphan')).toBeInTheDocument()
  })
})
