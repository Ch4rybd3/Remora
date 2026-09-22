/**
 * The shared artifact file list.
 *
 * Two behaviours are worth pinning because getting either wrong is invisible
 * until an analyst is already lost: the full name has to be reachable on
 * hover, and clicking a row has to open it.
 *
 * The second is not hypothetical. The first version of this component reused
 * the Explorer's name-copies-on-click button, and seven Registry Explorer
 * tests went red - correctly, because everywhere else in the product clicking
 * a file name opens the file.
 */
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { ArtifactFileList, type ArtifactFileItem } from '../ArtifactFileList'

const LONG_A = 'Microsoft-Windows-Sysmon%4Operational.evtx'
const LONG_B = 'Microsoft-Windows-SmbClient%4Security.evtx'

const ITEMS: ArtifactFileItem[] = [
  { id: 'a', name: LONG_A, badges: <span>1,204 rows</span>, footnote: '2 hours ago' },
  { id: 'b', name: LONG_B, searchText: 'smb' },
  { id: 'c', name: 'Amcache.hve', unavailable: true },
]

function list(over: Partial<Parameters<typeof ArtifactFileList>[0]> = {}) {
  const onSelect = vi.fn()
  render(
    <ArtifactFileList items={ITEMS} selectedId={null} onSelect={onSelect} {...over} />,
  )
  return { onSelect }
}

const row = (name: string) => screen.getByText(name).closest('div[title]') as HTMLElement

// ─── The name, on hover ───────────────────────────────────────────────────────

describe('reading a truncated name', () => {
  it('carries the full name on the row, not only on the text', () => {
    /*
     * The ask this component exists for. These two names are the same row
     * until you can read them, and they truncate at the same point.
     */
    list()

    expect(row(LONG_A)).toHaveAttribute('title', LONG_A)
    expect(row(LONG_B)).toHaveAttribute('title', LONG_B)
  })

  it('offers a copy control that is not the name itself', async () => {
    list()

    expect(screen.getByRole('button', { name: `Copy ${LONG_A}` })).toBeInTheDocument()
  })
})

// ─── Selection ────────────────────────────────────────────────────────────────

describe('selecting a file', () => {
  it('opens the file when the row is clicked', async () => {
    const { onSelect } = list()

    await userEvent.click(row(LONG_A))

    expect(onSelect).toHaveBeenCalledWith('a')
  })

  it('opens the file when the name is clicked', async () => {
    /* The regression the Registry tests caught: the name is not a button. */
    const { onSelect } = list()

    await userEvent.click(screen.getByText(LONG_A))

    expect(onSelect).toHaveBeenCalledWith('a')
  })

  it('does not open the file when the copy control is clicked', async () => {
    const { onSelect } = list()

    await userEvent.click(screen.getByRole('button', { name: `Copy ${LONG_A}` }))

    expect(onSelect).not.toHaveBeenCalled()
  })

  it('does not open the file when a row action is clicked', async () => {
    const onDelete = vi.fn()
    const onSelect = vi.fn()
    render(
      <ArtifactFileList
        items={[{ id: 'a', name: LONG_A, actions: <button onClick={onDelete}>Delete</button> }]}
        selectedId={null}
        onSelect={onSelect}
      />,
    )

    await userEvent.click(screen.getByRole('button', { name: 'Delete' }))

    expect(onDelete).toHaveBeenCalled()
    expect(onSelect).not.toHaveBeenCalled()
  })
})

// ─── Filtering ────────────────────────────────────────────────────────────────

describe('filtering the list', () => {
  it('matches on the name', async () => {
    list()

    await userEvent.type(screen.getByPlaceholderText(/Filter files/), 'Sysmon')

    expect(screen.getByText(LONG_A)).toBeInTheDocument()
    expect(screen.queryByText(LONG_B)).not.toBeInTheDocument()
  })

  it('matches on the text a page supplies alongside the name', async () => {
    /* "Show me the SMB one" - the artifact label, not the filename. */
    list()

    await userEvent.type(screen.getByPlaceholderText(/Filter files/), 'smb')

    expect(screen.getByText(LONG_B)).toBeInTheDocument()
    expect(screen.queryByText(LONG_A)).not.toBeInTheDocument()
  })

  it('says the filter is the reason nothing is listed', async () => {
    /* Distinct from "this case holds no files", which is a different problem
       with a different fix. */
    list()

    await userEvent.type(screen.getByPlaceholderText(/Filter files/), 'nothing-matches')

    expect(screen.getByText(/No file matches/)).toBeInTheDocument()
  })

  it('shows how many of how many while a filter is on', async () => {
    list()

    await userEvent.type(screen.getByPlaceholderText(/Filter files/), 'Sysmon')

    expect(screen.getByText('1/3')).toBeInTheDocument()
  })

  it('offers no filter box when there is nothing to filter', () => {
    render(<ArtifactFileList items={[]} selectedId={null} onSelect={vi.fn()} />)

    expect(screen.queryByPlaceholderText(/Filter files/)).not.toBeInTheDocument()
  })
})

// ─── States ───────────────────────────────────────────────────────────────────

describe('states', () => {
  it('shows the page its own empty message', () => {
    render(
      <ArtifactFileList
        items={[]} selectedId={null} onSelect={vi.fn()}
        emptyMessage="No capture in this case."
      />,
    )

    expect(screen.getByText('No capture in this case.')).toBeInTheDocument()
  })

  it('lists a file whose bytes are gone rather than hiding it', () => {
    /* The record is real and the analyst needs to see that the file it points
       at is not - a different thing from the artifact never having existed. */
    list()

    expect(screen.getByText('Amcache.hve')).toBeInTheDocument()
  })

  it('shows the count of what the case holds', () => {
    list()

    expect(screen.getByText('3')).toBeInTheDocument()
  })
})
