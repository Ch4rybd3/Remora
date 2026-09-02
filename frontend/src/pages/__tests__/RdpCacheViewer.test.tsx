import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import RdpCacheViewer from '../RdpCacheViewer'

const list = vi.fn()
const sheetObjectUrl = vi.fn()

vi.mock('../../api/rdpCache', () => ({
  rdpCacheApi: {
    list: (...a: unknown[]) => list(...a),
    sheetObjectUrl: (...a: unknown[]) => sheetObjectUrl(...a),
  },
}))

vi.mock('../../context/CurrentCaseContext', () => ({
  useCurrentCase: () => ({ currentCase: { id: 'case-1', title: 'Case' } }),
}))

vi.mock('../../components/custody/CustodyActions', () => ({
  CopyableName: ({ value }: { value: string }) => <span>{value}</span>,
}))

const SOURCE = 'C/Users/fsali/AppData/Local/Microsoft/Terminal Server Client/Cache/Cache0000.bin'

function cache(overrides = {}) {
  return {
    artifact_id: 'art-1', available: true, tiles: 2048, uploaded_at: null,
    sources: [{
      source: SOURCE,
      sheets: [{ sheet: 'a_sheet000.png', tiles: 1024 },
               { sheet: 'a_sheet001.png', tiles: 1024 }],
    }],
    ...overrides,
  }
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <RdpCacheViewer />
      </QueryClientProvider>
    </MemoryRouter>,
  )
}

describe('RdpCacheViewer', () => {
  beforeEach(() => {
    list.mockReset().mockResolvedValue([cache()])
    sheetObjectUrl.mockReset().mockResolvedValue('blob:fake')
    vi.stubGlobal('URL', { ...URL, createObjectURL: vi.fn(), revokeObjectURL: vi.fn() })
  })

  it('names the profile a cache came from, not just the filename', async () => {
    // A triage holds Cache0000.bin once per user profile and once more under
    // Windows.old. The filename alone cannot tell them apart.
    renderPage()
    expect(await screen.findByText(/fsali — Cache0000\.bin/)).toBeInTheDocument()
  })

  it('reports the tile count so an empty cache is distinguishable', async () => {
    renderPage()
    // React renders the count and the label as separate text nodes, so match
    // on the element's combined text rather than on one node.
    const label = await screen.findByText(
      (_, element) => element?.textContent === '2,048 tiles · 2 sheets',
    )
    expect(label).toBeInTheDocument()
  })

  it('loads no sheet until one is asked for', async () => {
    // Forty sheets of a megabyte each. Fetching them all on arrival would cost
    // the tab for a page the analyst may only be glancing at.
    renderPage()
    await screen.findByText(/fsali — Cache0000\.bin/)
    expect(sheetObjectUrl).not.toHaveBeenCalled()
  })

  it('fetches the sheets when a source is expanded', async () => {
    renderPage()
    await userEvent.click(await screen.findByText(/fsali — Cache0000\.bin/))

    expect(await screen.findByAltText(/sheet a_sheet000\.png/)).toBeInTheDocument()
    expect(sheetObjectUrl).toHaveBeenCalledWith('case-1', 'art-1', 'a_sheet000.png')
  })

  it('says a sheet failed rather than showing a broken image', async () => {
    sheetObjectUrl.mockRejectedValue(new Error('403'))
    renderPage()
    await userEvent.click(await screen.findByText(/fsali — Cache0000\.bin/))

    // Both sheets fail, and each says so on its own.
    expect(await screen.findAllByText(/could not be loaded/)).toHaveLength(2)
  })

  it('flags an index whose file is gone', async () => {
    list.mockResolvedValue([cache({ available: false })])
    renderPage()
    expect(await screen.findByText(/removed with the collection/)).toBeInTheDocument()
  })

  it('explains where the artifact comes from when there is none', async () => {
    list.mockResolvedValue([])
    renderPage()
    expect(await screen.findByText(/Terminal Server Client/)).toBeInTheDocument()
    expect(screen.getByText(/what an operator saw rather than what ran/)).toBeInTheDocument()
  })

  it('zooms the sheets', async () => {
    renderPage()
    await userEvent.click(await screen.findByText(/fsali — Cache0000\.bin/))
    await userEvent.click(screen.getByLabelText('Zoom in'))

    expect(screen.getByText('125%')).toBeInTheDocument()
  })
})
