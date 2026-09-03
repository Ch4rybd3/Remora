import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import CollectionImportTab from '../CollectionImportTab'

/**
 * A failed upload has to say so.
 *
 * Reported as "rien ne se passe": a KAPE archive was dropped on the Collection
 * tab and the page did not change. The upload path goes through `fetch` rather
 * than the axios instance, so the 401 interceptor never sees it either - an
 * expired session, a refused type and a server error were indistinguishable
 * from nothing at all.
 */

const list = vi.fn()
const upload = vi.fn()

vi.mock('../../../../api/collectionImport', () => ({
  collectionImportApi: {
    list:   (...a: unknown[]) => list(...a),
    upload: (...a: unknown[]) => upload(...a),
    delete: vi.fn(),
    deletionPlan: vi.fn(),
    markEvidence: vi.fn(),
    setFileTimezone: vi.fn(),
  },
}))

vi.mock('../../DropFolderPanel', () => ({ default: () => null }))
vi.mock('../../IngestQueuePanel', () => ({ default: () => null }))
vi.mock('../../../custody/CustodyPanel', () => ({ default: () => null }))
vi.mock('../../../custody/CustodyActions', () => ({
  CustodyActions: () => null,
  CopyableName: ({ value }: { value: string }) => <span>{value}</span>,
}))

function renderTab() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <CollectionImportTab caseId="case-1" />
      </QueryClientProvider>
    </MemoryRouter>,
  )
}

/** Drop an archive on the page's drop zone. */
async function dropArchive(name = 'kapetriage2.zip') {
  const file = new File(['x'], name, { type: 'application/zip' })
  const zone = await screen.findByText('Drop files here')
  const target = zone.closest('div')!
  const dataTransfer = { files: [file], types: ['Files'] }
  const { fireEvent } = await import('@testing-library/react')
  fireEvent.drop(target, { dataTransfer })
}

describe('Collection upload failures', () => {
  beforeEach(() => {
    list.mockReset().mockResolvedValue([])
    upload.mockReset()
  })

  it('shows what the server said instead of staying silent', async () => {
    upload.mockRejectedValue(new Error(JSON.stringify({ detail: 'Invalid ZIP file' })))
    renderTab()
    await dropArchive()

    expect(await screen.findByText('Upload failed')).toBeInTheDocument()
    expect(screen.getByText('Invalid ZIP file')).toBeInTheDocument()
  })

  it('names an expired session, because nothing else will work until it is fixed', async () => {
    upload.mockRejectedValue(new Error(JSON.stringify({ detail: 'Not authenticated' })))
    renderTab()
    await dropArchive()

    expect(await screen.findByText(/session has expired/i)).toBeInTheDocument()
  })

  it('distinguishes a network failure from an answer', async () => {
    upload.mockRejectedValue(new TypeError('Failed to fetch'))
    renderTab()
    await dropArchive()

    expect(await screen.findByText(/did not reach the server/i)).toBeInTheDocument()
  })

  it('clears the message once the analyst has seen it', async () => {
    upload.mockRejectedValue(new Error(JSON.stringify({ detail: 'Invalid ZIP file' })))
    renderTab()
    await dropArchive()
    await userEvent.click(await screen.findByLabelText('Dismiss'))

    expect(screen.queryByText('Upload failed')).not.toBeInTheDocument()
  })

  it('says nothing when the upload works', async () => {
    upload.mockResolvedValue({ id: 'c1' })
    renderTab()
    await dropArchive()

    expect(screen.queryByText('Upload failed')).not.toBeInTheDocument()
  })

  it('refuses more than one archive at a time, in English', async () => {
    const alerted = vi.fn()
    vi.stubGlobal('alert', alerted)
    renderTab()

    const zone = await screen.findByText('Drop files here')
    const { fireEvent } = await import('@testing-library/react')
    fireEvent.drop(zone.closest('div')!, {
      dataTransfer: {
        files: [new File(['a'], 'one.zip'), new File(['b'], 'two.zip')],
        types: ['Files'],
      },
    })

    expect(alerted).toHaveBeenCalledWith('Only one archive per upload')
  })
})
