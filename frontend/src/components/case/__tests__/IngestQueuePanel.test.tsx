import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { IngestedFile } from '../../../api/ingest'
import IngestQueuePanel from '../IngestQueuePanel'

const list      = vi.fn()
const kinds     = vi.fn()
const forceKind = vi.fn()
const retry     = vi.fn()

vi.mock('../../../api/ingest', () => ({
  ingestApi: {
    list:      (...a: unknown[]) => list(...a),
    kinds:     () => kinds(),
    forceKind: (...a: unknown[]) => forceKind(...a),
    retry:     (...a: unknown[]) => retry(...a),
  },
}))

vi.mock('../../custody/CustodyActions', () => ({
  CustodyActions: () => null,
  CopyableName: ({ value }: { value: string }) => <span>{value}</span>,
}))

function file(overrides: Partial<IngestedFile> = {}): IngestedFile {
  return {
    id: 'f1', original_name: 'Security.evtx', size_bytes: 1024,
    origin: 'dropzone', origin_detail: null, sha256: 'a'.repeat(64),
    magic_type: 'Windows Event Log (EVTX)', detected_kind: 'evtx',
    detection_source: 'magic', source_timezone: 'UTC', state: 'routed',
    error: null, routed_to: 'logs', parent_id: null, collection_id: null,
    recoverable: false, evidence_id: null, preserved: false,
    destination_pages: [], created_at: null, ...overrides,
  }
}

function renderPanel() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <IngestQueuePanel caseId="case-1" />
    </QueryClientProvider>,
  )
}

describe('IngestQueuePanel', () => {
  beforeEach(() => {
    list.mockReset().mockResolvedValue({ files: [file()], summary: { routed: 1 } })
    kinds.mockReset().mockResolvedValue({
      kinds: [{ kind: 'evtx', available: true }, { kind: 'registry_hive', available: false }],
    })
    forceKind.mockReset().mockResolvedValue(file())
    retry.mockReset().mockResolvedValue(file())
  })

  it('lists what the pipeline has seen', async () => {
    renderPanel()
    expect(await screen.findByText('Security.evtx')).toBeInTheDocument()
    expect(screen.getByText('routed')).toBeInTheDocument()
  })

  it('only offers state chips the case actually has', async () => {
    renderPanel()
    expect(await screen.findByText('routed 1')).toBeInTheDocument()
    // A row of ten zeroes would bury the two states that matter.
    expect(screen.queryByText(/failed 0/)).not.toBeInTheDocument()
  })

  it('says when a type was guessed rather than read from the bytes', async () => {
    list.mockResolvedValue({
      files: [file({ detection_source: 'extension' })], summary: { routed: 1 },
    })
    renderPanel()
    expect(await screen.findByText('by extension')).toBeInTheDocument()
  })

  it('says nothing extra when the bytes decided', async () => {
    renderPanel()
    await screen.findByText('Security.evtx')
    expect(screen.queryByText(/^by /)).not.toBeInTheDocument()
  })

  it('offers to set a type on an unidentified file', async () => {
    list.mockResolvedValue({
      files: [file({ state: 'unidentified', magic_type: null, detected_kind: 'unknown' })],
      summary: { unidentified: 1 },
    })
    renderPanel()

    await userEvent.click(await screen.findByRole('button', { name: 'Set type' }))
    await userEvent.selectOptions(screen.getByRole('combobox'), 'evtx')

    expect(forceKind).toHaveBeenCalledWith('case-1', 'f1', 'evtx')
  })

  it('marks types whose parser has not shipped', async () => {
    list.mockResolvedValue({
      files: [file({ state: 'unidentified' })], summary: { unidentified: 1 },
    })
    renderPanel()
    await userEvent.click(await screen.findByRole('button', { name: 'Set type' }))

    expect(screen.getByRole('option', { name: 'registry_hive (no parser yet)' }))
      .toBeInTheDocument()
  })

  it('offers a retry only on a failed file', async () => {
    list.mockResolvedValue({ files: [file({ state: 'failed', error: 'parser timed out' })],
                             summary: { failed: 1 } })
    renderPanel()

    await userEvent.click(await screen.findByTitle('Send back through the pipeline'))
    expect(retry).toHaveBeenCalledWith('case-1', 'f1')
  })

  it('shows the error rather than only the state', async () => {
    list.mockResolvedValue({ files: [file({ state: 'failed', error: 'parser timed out' })],
                             summary: { failed: 1 } })
    renderPanel()
    expect(await screen.findByText('parser timed out')).toBeInTheDocument()
  })

  it('says explicitly that a preserved file does not expire', async () => {
    list.mockResolvedValue({
      files: [file({ preserved: true, evidence_id: 'ev-1' })], summary: { indexed: 1 },
    })
    renderPanel()
    expect(await screen.findByText(/does not expire/)).toBeInTheDocument()
  })

  it('explains an empty queue instead of showing nothing', async () => {
    list.mockResolvedValue({ files: [], summary: {} })
    renderPanel()
    expect(await screen.findByText(/Nothing ingested yet/)).toBeInTheDocument()
  })
})
