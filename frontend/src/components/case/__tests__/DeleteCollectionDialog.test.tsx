import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { DeletionPlan } from '../../../api/collectionImport'
import DeleteCollectionDialog from '../DeleteCollectionDialog'

const deletionPlan = vi.fn()

vi.mock('../../../api/collectionImport', () => ({
  collectionImportApi: {
    deletionPlan: (...a: unknown[]) => deletionPlan(...a),
  },
}))

function plan(overrides: Partial<DeletionPlan> = {}): DeletionPlan {
  return {
    tables: 0, event_logs: 0, emails: 0, memory_dumps: 0,
    files: 0, preserved: 0, bytes_on_disk: 0, preserved_names: [],
    ...overrides,
  }
}

function renderDialog(props: Partial<React.ComponentProps<typeof DeleteCollectionDialog>> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const onConfirm = vi.fn()
  const onClose = vi.fn()
  render(
    <QueryClientProvider client={client}>
      <DeleteCollectionDialog
        open onClose={onClose} onConfirm={onConfirm}
        caseId="case-1" collectionIds={['col-1']} name="triage.zip"
        {...props}
      />
    </QueryClientProvider>,
  )
  return { onConfirm, onClose }
}

describe('DeleteCollectionDialog', () => {
  beforeEach(() => {
    deletionPlan.mockReset().mockResolvedValue(plan())
  })

  it('says what deletion will remove from the other pages', async () => {
    // The reason this dialog exists. Deleting a collection removes records in
    // modules the analyst is not looking at, and a plain "are you sure?" asked
    // them to guess at all of it.
    deletionPlan.mockResolvedValue(plan({
      files: 2058, tables: 12, event_logs: 312, bytes_on_disk: 429_496_729,
    }))
    renderDialog()

    expect(await screen.findByText(/tables in the Artifact Explorer/)).toBeInTheDocument()
    expect(screen.getByText('12')).toBeInTheDocument()
    expect(screen.getByText(/event logs, with their events/)).toBeInTheDocument()
    expect(screen.getByText('312')).toBeInTheDocument()
    expect(screen.getByText(/409\.6 MB on disk/)).toBeInTheDocument()
  })

  it('names what is being kept, so the analyst can check the list is right', async () => {
    deletionPlan.mockResolvedValue(plan({
      files: 3, tables: 1, preserved: 2,
      preserved_names: ['Security.evtx', 'MFT.csv'],
    }))
    renderDialog()

    expect(await screen.findByText(/2 items kept/)).toBeInTheDocument()
    expect(screen.getByText(/Security\.evtx, MFT\.csv/)).toBeInTheDocument()
    expect(screen.getByText(/chain of custody/)).toBeInTheDocument()
  })

  it('sums the batches when a session was uploaded in parts', async () => {
    deletionPlan
      .mockResolvedValueOnce(plan({ files: 10, tables: 2 }))
      .mockResolvedValueOnce(plan({ files: 5, tables: 3 }))
    renderDialog({ collectionIds: ['col-1', 'col-2'] })

    expect(await screen.findByText('5')).toBeInTheDocument()      // 2 + 3 tables
    expect(screen.getByText('15')).toBeInTheDocument()             // 10 + 5 files
    expect(screen.getByText(/ingested files/)).toBeInTheDocument()
  })

  it('still lets the deletion through when the plan cannot be read', async () => {
    // The plan is an explanation, not a gate. Refusing to delete because the
    // preview failed would leave a bad import stuck in the case.
    deletionPlan.mockRejectedValue(new Error('boom'))
    const { onConfirm } = renderDialog()

    expect(await screen.findByText(/without the list/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }))
    expect(onConfirm).toHaveBeenCalled()
  })

  it('does not ask the backend anything while it is closed', () => {
    renderDialog({ open: false })
    expect(deletionPlan).not.toHaveBeenCalled()
  })
})
