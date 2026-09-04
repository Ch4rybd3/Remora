import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import RegistryExplorer from '../RegistryExplorer'

const hives  = vi.fn()
const info   = vi.fn()
const keys   = vi.fn()
const values = vi.fn()
const value  = vi.fn()
const search = vi.fn()

vi.mock('../../api/registry', () => ({
  registryApi: {
    hives:  (...a: unknown[]) => hives(...a),
    info:   (...a: unknown[]) => info(...a),
    keys:   (...a: unknown[]) => keys(...a),
    values: (...a: unknown[]) => values(...a),
    value:  (...a: unknown[]) => value(...a),
    search: (...a: unknown[]) => search(...a),
  },
}))

vi.mock('../../context/CurrentCaseContext', () => ({
  useCurrentCase: () => ({ currentCase: { id: 'case-1', title: 'Case' } }),
}))

vi.mock('../../components/custody/CustodyActions', () => ({
  CopyableName: ({ value: v }: { value: string }) => <span>{v}</span>,
}))

function hive(overrides = {}) {
  return {
    id: 'hive-1', name: 'SOFTWARE', size_bytes: 4096, sha256: 'a'.repeat(64),
    collection_id: null, state: 'browsable', preserved: false, available: true,
    created_at: null, ...overrides,
  }
}

function hiveInfo(overrides = {}) {
  return {
    ...hive(), internal_name: '\\SOFTWARE', version: 5, dirty: false,
    in_transaction: false, root_name: 'ROOT', subkey_count: 2, value_count: 1,
    limitations: ['Transaction logs are not replayed.', 'Deleted keys are not recovered.'],
    ...overrides,
  }
}

function key(name: string, overrides = {}) {
  return { name, path: name, subkey_count: 0, value_count: 0, last_written: null, ...overrides }
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <RegistryExplorer />
      </QueryClientProvider>
    </MemoryRouter>,
  )
}

describe('RegistryExplorer', () => {
  beforeEach(() => {
    hives.mockReset().mockResolvedValue([hive()])
    info.mockReset().mockResolvedValue(hiveInfo())
    keys.mockReset().mockResolvedValue([key('Microsoft', { subkey_count: 1 }), key('Empty')])
    values.mockReset().mockResolvedValue([])
    value.mockReset()
    search.mockReset()
  })

  it('says why it does not pick the interesting keys for you', async () => {
    // The design decision the whole page rests on. An analyst who does not know
    // Remora made this choice deliberately will read the empty pane as a gap.
    renderPage()
    expect(await screen.findByText(/does not decide which keys matter/)).toBeInTheDocument()
  })

  it('opens a hive and shows the top of its tree', async () => {
    renderPage()
    await userEvent.click(await screen.findByText('SOFTWARE'))

    expect(await screen.findByText('Microsoft')).toBeInTheDocument()
    expect(screen.getByText('Empty')).toBeInTheDocument()
  })

  it('warns before showing values when the hive was collected mid-write', async () => {
    // Warnings first, on purpose: an analyst who reads the values before the
    // warning has already drawn a conclusion from them.
    info.mockResolvedValue(hiveInfo({ dirty: true }))
    renderPage()
    await userEvent.click(await screen.findByText('SOFTWARE'))

    expect(await screen.findByText(/collected while Windows was writing/)).toBeInTheDocument()
    expect(screen.getByText(/most recent values may be missing/)).toBeInTheDocument()
  })

  it('does not warn about a clean hive', async () => {
    renderPage()
    await userEvent.click(await screen.findByText('SOFTWARE'))
    await screen.findByText('Microsoft')

    expect(screen.queryByText(/collected while Windows was writing/)).not.toBeInTheDocument()
  })

  it('lists a key’s values with their registry type, not a number', async () => {
    values.mockResolvedValue([
      { name: 'ProductName', type: 'REG_SZ', size: 28, preview: 'Windows 11 Pro', truncated: false },
      { name: 'Build', type: 'REG_DWORD', size: 4, preview: '22631', truncated: false },
    ])
    renderPage()
    await userEvent.click(await screen.findByText('SOFTWARE'))

    expect(await screen.findByText('ProductName')).toBeInTheDocument()
    expect(screen.getByText('REG_SZ')).toBeInTheDocument()
    expect(screen.getByText('REG_DWORD')).toBeInTheDocument()
  })

  it('shows a value as text and as bytes when one is opened', async () => {
    values.mockResolvedValue([
      { name: 'ProductName', type: 'REG_SZ', size: 28, preview: 'Windows 11 Pro', truncated: false },
    ])
    value.mockResolvedValue({
      name: 'ProductName', type: 'REG_SZ', size: 28,
      text: 'Windows 11 Pro', hex: '57 00 69 00', truncated: false,
    })
    renderPage()
    await userEvent.click(await screen.findByText('SOFTWARE'))
    await userEvent.click(await screen.findByText('ProductName'))

    // Both halves: the text is what it means, the hex is what is stored.
    expect(await screen.findByText('57 00 69 00')).toBeInTheDocument()
    expect(screen.getByText('Bytes')).toBeInTheDocument()
  })

  it('says when a search stopped early instead of passing it off as complete', async () => {
    search.mockResolvedValue({
      query: 'run', exhausted: true, scanned: 200000,
      hits: [{ key_path: 'Microsoft\\Windows', value_name: null, matched: 'key', preview: '' }],
    })
    renderPage()
    await userEvent.click(await screen.findByText('SOFTWARE'))

    const box = await screen.findByPlaceholderText(/Search keys/)
    await userEvent.type(box, 'run{Enter}')

    expect(await screen.findByText(/stopped early/)).toBeInTheDocument()
  })

  it('does not search while the query is still being typed', async () => {
    // Same rule as the Artifact Explorer: typing is inert, Enter runs it. A
    // half-typed query walking a 200 MB hive is a request nobody asked for.
    renderPage()
    await userEvent.click(await screen.findByText('SOFTWARE'))
    await userEvent.type(await screen.findByPlaceholderText(/Search keys/), 'run')

    expect(search).not.toHaveBeenCalled()
  })

  it('marks a hive whose file is gone and refuses to open it', async () => {
    hives.mockResolvedValue([hive({ available: false })])
    renderPage()

    expect(await screen.findByText('file missing')).toBeInTheDocument()
    await userEvent.click(screen.getByText('SOFTWARE'))
    expect(info).not.toHaveBeenCalled()
  })

  it('tells an analyst how a hive gets here, when none has', async () => {
    hives.mockResolvedValue([])
    renderPage()

    expect(await screen.findByText(/Drop one in the case folder/)).toBeInTheDocument()
  })
})
